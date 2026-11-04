"""DUAL BUILD: convert training folders to the layout AITK uses, and link each to its job.

    <folder>\\<name>\\
      <name>.safetensors, <name>_<step 9 digits>.safetensors      LoRAs
      <name>.webp, <name>_<step>.webp                             thumbnails
      <lora>.metadata.json                                        LoRA Manager's, left as they are
      config\\  .job_config.json, config.yaml, log.txt, logs\\, loss_log.db, optimizer.pt, notes.md,
               samples\\<time>__<step>_<prompt #>.<ext>, and everything else that was in the folder

Handles both old layouts:
  - AITK's own (everything loose in the folder, samples\\ beside the LoRAs)
  - AItoolLoraMaster.ps1's (config\\<name>_job_config.json, config\\samples\\sample_<#>\\<name>_<step>.png
    + .preview.jpeg/.thumb.jpg, <name>_<step>.png previews beside the LoRAs, grids, batch_config.txt)
Script extras (previews, thumbs, grids, batch_config, the .ps1, prune50_safety.txt) go to config\\legacy.
Nothing is deleted.

The folder's name is the training's name. Its job in AITK (found by the aitk_job_id in its
job_config, else by name) is pointed at the folder (Save Location = the folder it's in) and renamed
to match; a training with no job left in AITK is added back as a completed job.

    python scripts\\convert_training_folder.py <folder> [<folder> ...] [--recursive] [--dry-run]
        [--history <older install>\\aitk_db.db]

<folder> is a training folder, or with --recursive any folder above trainings (every folder below
it holding .safetensors is converted). Run it with AITK's python while the job isn't running.
--history: a training with no job here gets its job back from that older install's database, with
its dates, status, steps and config. Two folders from the same job: the first keeps it, the other
gets a job of its own. The database is backed up first (aitk_db.backup-<time>-convert.db).
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import time
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from toolkit.job_thumbnails import write_thumbnails  # noqa: E402

DB_PATH = os.environ.get('AITK_DB_PATH') or os.path.join(ROOT, 'aitk_db.db')
META = 'config'
# AITK's own files that belong in config\ under their own names
AITK_META = {
    '.job_config.json', 'config.yaml', 'log.txt', 'loss_log.db', 'loss_log.db-wal', 'loss_log.db-shm',
    'optimizer.pt', 'pid.txt', '.job_pid', '.pending_updates.json', 'notes.md', 'plugin.html',
    'learnable_snr.json', 'README.md', 'samples.zip',
}
SCRIPT_EXTRAS = re.compile(r'(\.preview\.jpeg|\.thumb\.jpg|_grid_P\d+\.(png|jpe?g|webp)|^batch_config\.txt|^prune50_safety\.txt|\.ps1)$', re.I)
AITK_SAMPLE = re.compile(r'^\d+__\d+_\d+\.(webp|png|jpe?g|mp4|mp3|wav|flac|ogg|txt)$', re.I)


class Plan:
    def __init__(self, folder, dry):
        self.folder, self.dry, self.lines = folder, dry, []

    def log(self, msg):
        self.lines.append(msg)
        print(('[dry] ' if self.dry else '') + msg)

    def move(self, src, dest):
        if os.path.abspath(src) == os.path.abspath(dest):
            return
        if os.path.exists(dest):
            base, ext = os.path.splitext(dest)
            n = 1
            while os.path.exists(f'{base} ({n}){ext}'):
                n += 1
            dest = f'{base} ({n}){ext}'
        self.log(f'move  {os.path.relpath(src, self.folder)} -> {os.path.relpath(dest, self.folder)}')
        if not self.dry:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.move(src, dest)


def training_folders(paths, recursive):
    for p in paths:
        p = os.path.abspath(p)
        if not os.path.isdir(p):
            print(f'not a folder: {p}')
            continue
        if not recursive:
            yield p
            continue
        for dirpath, dirnames, filenames in os.walk(p):
            dirnames[:] = [d for d in dirnames if d.lower() not in (META, 'samples', 'legacy') and not d.startswith(('.', '$'))]
            if any(f.lower().endswith('.safetensors') for f in filenames):
                yield dirpath
                dirnames[:] = []


def read_job_config(meta):
    for f in sorted(os.listdir(meta)) if os.path.isdir(meta) else []:
        if f == '.job_config.json' or f.endswith('_job_config.json'):
            try:
                with open(os.path.join(meta, f), encoding='utf-8') as fh:
                    return f, json.load(fh)
            except Exception:
                pass
    return None, None


def convert_files(folder, plan):
    name = os.path.basename(folder)
    meta = os.path.join(folder, META)
    legacy = os.path.join(meta, 'legacy')
    ckpt = re.compile(r'^' + re.escape(name) + r'_(\d+)\.safetensors$')
    own_thumb = re.compile(r'^' + re.escape(name) + r'(?:_\d{9})?\.webp$')
    if not os.path.isdir(meta):
        plan.log('mkdir config')
        if not plan.dry:
            os.makedirs(meta)

    # old runs' logs first, so they keep their order in config\logs\<n>_log.txt
    def next_log():
        logs = os.path.join(meta, 'logs')
        taken = {int(m.group(1)) for x in (os.listdir(logs) if os.path.isdir(logs) else [])
                 for m in [re.match(r'^(\d+)_log\.txt$', x)] if m}
        n = 0
        while n in taken or n in plan.claimed:
            n += 1
        plan.claimed.add(n)
        return os.path.join(logs, f'{n}_log.txt')

    plan.claimed = set()
    old_logs = os.path.join(folder, 'logs')
    if os.path.isdir(old_logs):
        numbered = sorted(os.listdir(old_logs), key=lambda x: (int(x.split('_')[0]) if x.split('_')[0].isdigit() else 1 << 30, x))
        for x in numbered:
            plan.move(os.path.join(old_logs, x), next_log())
        if not plan.dry and not os.listdir(old_logs):
            os.rmdir(old_logs)

    # an AITK file that config\ already has (a run made there since): the newer one stays, the
    # older goes to config\logs (a log) or config\legacy (anything else), nothing is overwritten
    def put_meta(p, f):
        dest = os.path.join(meta, f)
        if not os.path.exists(dest):
            plan.move(p, dest)
            return
        older, newer = (p, dest) if os.path.getmtime(p) <= os.path.getmtime(dest) else (dest, p)
        if older == dest:
            plan.move(dest, next_log() if f == 'log.txt' else os.path.join(legacy, f))
            plan.move(p, dest)
        else:
            plan.move(p, next_log() if f == 'log.txt' else os.path.join(legacy, f))

    # the folder itself: LoRAs stay (steps padded to AITK's 9 digits), the rest goes to config\
    for f in sorted(os.listdir(folder)):
        p = os.path.join(folder, f)
        if f == META or f == 'logs' and os.path.isdir(p):
            continue  # logs\ was merged above
        if f in AITK_META and os.path.isfile(p):
            put_meta(p, f)
            continue
        if os.path.isdir(p):
            if f == 'samples':
                for s in sorted(os.listdir(p)):
                    plan.move(os.path.join(p, s), os.path.join(meta, 'samples', s))
                if not plan.dry and not os.listdir(p):
                    os.rmdir(p)
            else:
                plan.move(p, os.path.join(meta, f))
            continue
        m = ckpt.match(f)
        if m:
            padded = f'{name}_{int(m.group(1)):09d}.safetensors'
            if padded != f:
                plan.move(p, os.path.join(folder, padded))
                # LoRA Manager's file for it follows the new name
                meta_json = p[: -len('.safetensors')] + '.metadata.json'
                if os.path.exists(meta_json):
                    plan.move(meta_json, os.path.join(folder, padded[: -len('.safetensors')] + '.metadata.json'))
            continue
        # LoRA Manager's <lora>.metadata.json stay beside their LoRAs (wherever they are now)
        if f.lower().endswith(('.safetensors', '.metadata.json')) or own_thumb.match(f):
            continue
        if SCRIPT_EXTRAS.search(f) or re.match(r'^' + re.escape(name) + r'_\d+\.(png|jpe?g)$', f):
            plan.move(p, os.path.join(legacy, f))  # a sample_0 copy the script put beside the LoRA
        else:
            plan.move(p, os.path.join(meta, f))

    if not os.path.isdir(meta):
        return
    # config\: the script's renamed job_config / config.yaml back to AITK's names, extras to legacy
    for f in sorted(os.listdir(meta)):
        p = os.path.join(meta, f)
        if os.path.isdir(p):
            continue
        if f.endswith('_job_config.json') and not os.path.exists(os.path.join(meta, '.job_config.json')):
            plan.move(p, os.path.join(meta, '.job_config.json'))
        elif f == f'{name}_config.yaml' and not os.path.exists(os.path.join(meta, 'config.yaml')):
            plan.move(p, os.path.join(meta, 'config.yaml'))
        elif SCRIPT_EXTRAS.search(f):
            plan.move(p, os.path.join(legacy, f))

    # config\samples\sample_<#>\<name>_<step>.<ext> -> config\samples\<time>__<step>_<#>.<ext>
    samples = os.path.join(meta, 'samples')
    for d in sorted(os.listdir(samples)) if os.path.isdir(samples) else []:
        dm = re.match(r'^sample_(\d+)$', d)
        if not dm or not os.path.isdir(os.path.join(samples, d)):
            continue
        idx = int(dm.group(1))
        sub = os.path.join(samples, d)
        for f in sorted(os.listdir(sub)):
            p = os.path.join(sub, f)
            sm = re.match(r'^.*_(\d+)\.(png|jpe?g|webp)$', f, re.I)
            if SCRIPT_EXTRAS.search(f) or not sm:
                plan.move(p, os.path.join(legacy, 'samples', d, f))
                continue
            ts = int(os.path.getmtime(p) * 1000) + idx
            plan.move(p, os.path.join(samples, f'{ts}__{int(sm.group(1)):09d}_{idx}.{sm.group(2).lower()}'))
        if not plan.dry and os.path.isdir(sub) and not os.listdir(sub):
            os.rmdir(sub)


def job_config_of(folder):
    """The training's job_config, wherever it is now (config\\, or loose in the folder)."""
    for d in (os.path.join(folder, META), folder):
        f, cfg = read_job_config(d)
        if cfg is not None:
            return cfg
    return None


JOB_COLS = 'id, name, status, job_config'


def _training_root(db):
    row = db.execute("SELECT value FROM Settings WHERE key='TRAINING_FOLDER'").fetchone()
    return os.path.abspath(row[0]) if row and row[0] else ''


def _job_folder(db, job_config, name):
    """Where AITK looks for that job now: <save location or Training Folder>\\<name>."""
    try:
        loc = (json.loads(job_config)['config']['process'][0].get('save_location') or '').strip()
    except Exception:
        loc = ''
    return os.path.join(loc if os.path.isabs(loc) else _training_root(db), name)


def find_job(folder, cfg, db, history, claimed):
    """Its job: in AITK (by the job id in its job_config, the folder's name, the job_config's name),
    else in an older install's database (history). A job another folder already has (claimed this
    run, or its own folder still holds LoRAs) isn't taken: that folder gets a job of its own.
    Returns ('aitk' | 'history', row, history db) or None; refuses a running job."""
    name = os.path.basename(folder)
    keys = [('id', cfg.get('aitk_job_id'))] + [('name', n) for n in (name, (cfg.get('config') or {}).get('name'))]

    def lookup(conn, check_folder):
        for col, v in keys:
            if not v:
                continue
            row = conn.execute(f'SELECT {JOB_COLS} FROM Job WHERE {col}=?', (v,)).fetchone()
            if not row or row[0] in claimed:
                continue
            if check_folder:
                other = _job_folder(db, row[3], row[1])
                if os.path.normcase(os.path.abspath(other)) != os.path.normcase(folder) and os.path.isdir(other) and any(
                        f.lower().endswith('.safetensors') for f in os.listdir(other)):
                    continue  # it's that folder's job
            return row
        return None

    row = lookup(db, True)
    if row:
        if row[2] in ('running', 'queued', 'stopping'):
            raise RuntimeError(f'job "{row[1]}" is {row[2]}: stop it first')
        claimed.add(row[0])
        return 'aitk', row, None
    for h in history:
        row = lookup(h, False)
        if row:
            claimed.add(row[0])
            return 'history', row, h
    return None


def link_job(folder, plan, db, found):
    """Point the folder's AITK job at it (or add one back); returns (thumbnail prompt, last step)."""
    name = os.path.basename(folder)
    parent = os.path.dirname(folder)
    meta = os.path.join(folder, META)
    cfg_file, cfg = read_job_config(meta)
    if cfg is None:
        plan.log('no job_config in config\\: not linked to a job')
        return 0, None
    row = db.execute("SELECT value FROM Settings WHERE key='TRAINING_FOLDER'").fetchone()
    training_folder = os.path.normcase(os.path.abspath(row[0])) if row and row[0] else ''
    save_location = '' if os.path.normcase(parent) == training_folder else parent

    def place(c):
        c.setdefault('config', {})['name'] = name
        proc = c['config'].setdefault('process', [{}])[0]
        if save_location:
            proc['save_location'] = save_location
        else:
            proc.pop('save_location', None)
        return c

    kind, row, hdb = found if found else (None, None, None)
    if kind == 'aitk':
        jid, jname, status, jcfg = row
        if jname != name and db.execute('SELECT 1 FROM Job WHERE name=? AND id<>?', (name, jid)).fetchone():
            raise RuntimeError(f'another job is already named "{name}"')
        new_cfg = place(json.loads(jcfg))
        plan.log(f'job   "{jname}" -> name "{name}", save location {save_location or "(Training Folder)"}')
        if not plan.dry:
            # its dates are its history: left as they are
            db.execute('UPDATE Job SET name=?, job_config=? WHERE id=?', (name, json.dumps(new_cfg), jid))
    elif kind == 'history':
        # the older install's job, with its own history (dates, status, steps, info, config)
        if db.execute('SELECT 1 FROM Job WHERE name=?', (name,)).fetchone():
            raise RuntimeError(f'another job is already named "{name}"')
        cols = [r[1] for r in db.execute('PRAGMA table_info(Job)')]
        hcols = [r[1] for r in hdb.execute('PRAGMA table_info(Job)')]
        both = [c for c in cols if c in hcols]
        vals = dict(zip(both, hdb.execute(f'SELECT {", ".join(both)} FROM Job WHERE id=?', (row[0],)).fetchone()))
        jid = vals['id'] if not db.execute('SELECT 1 FROM Job WHERE id=?', (vals['id'],)).fetchone() else str(uuid.uuid4())
        new_cfg = place(json.loads(vals['job_config']))
        old_name = vals['name']
        vals.update(id=jid, name=name, job_config=json.dumps(new_cfg), pid=None, stop=0, return_to_queue=0,
                    save_now=0, sample_now=0, stop_at_checkpoint=0, queue_position=0)
        if vals.get('status') in ('running', 'queued', 'stopping'):
            vals['status'] = 'stopped'
        vals = {k: v for k, v in vals.items() if k in cols}
        plan.log(f'job   from history "{old_name}" ({vals.get("status")}, step {vals.get("step")}) -> "{name}", '
                 f'save location {save_location or "(Training Folder)"}')
        if not plan.dry:
            db.execute(f'INSERT INTO Job ({", ".join(vals)}) VALUES ({", ".join("?" for _ in vals)})', list(vals.values()))
    else:
        if db.execute('SELECT 1 FROM Job WHERE name=?', (name,)).fetchone():
            raise RuntimeError(f'another job is already named "{name}"')
        jid = str(uuid.uuid4())
        new_cfg = place({k: v for k, v in cfg.items() if k != 'aitk_job_id'})
        steps = [int(m.group(1)) for f in os.listdir(folder)
                 for m in [re.match(r'^' + re.escape(name) + r'_(\d+)\.safetensors$', f)] if m]
        step = max(steps) if steps else 0
        total = ((new_cfg['config']['process'][0].get('train') or {}).get('steps')) or step
        plan.log(f'job   added "{name}" (completed, step {step}), save location {save_location or "(Training Folder)"}')
        if not plan.dry:
            # dated by its LoRAs: made with the first, last changed with the newest
            times = [os.path.getmtime(os.path.join(folder, f)) for f in os.listdir(folder) if f.endswith('.safetensors')]
            now = int(time.time() * 1000)
            first, newest = (int(min(times) * 1000), int(max(times) * 1000)) if times else (now, now)
            db.execute(
                'INSERT INTO Job (id, name, gpu_ids, job_config, created_at, updated_at, status, step, total_steps, info, job_type) '
                "VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, 'Added by convert_training_folder', 'train')",
                (jid, name, str(cfg.get('gpu_ids') or '0'), json.dumps(new_cfg), first, newest, step, int(total)))

    # the folder's job_config carries its job id from now on
    cfg['aitk_job_id'] = jid
    if not plan.dry:
        with open(os.path.join(meta, cfg_file), 'w', encoding='utf-8') as fh:
            json.dump(place(cfg), fh, indent=2)
    proc = new_cfg['config']['process'][0]
    try:
        prompt = int((proc.get('sample') or {}).get('thumbnail_prompt', 0) or 0)
    except Exception:
        prompt = 0
    try:
        last = int((proc.get('train') or {}).get('steps') or 0) or None
    except Exception:
        last = None
    return prompt, last


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folders', nargs='+')
    ap.add_argument('--recursive', action='store_true', help='convert every training folder below these')
    ap.add_argument('--dry-run', action='store_true', help='print what would change, change nothing')
    ap.add_argument('--history', action='append', default=[], metavar='DB',
                    help="an older AITK install's aitk_db.db: a training AITK has no job for gets that job back "
                         'with its history (repeatable)')
    args = ap.parse_args()

    db = sqlite3.connect(DB_PATH, timeout=30)
    db.isolation_level = None
    history = [sqlite3.connect(f'file:{h}?mode=ro', uri=True) for h in args.history]
    if not args.dry_run:
        backup = os.path.splitext(DB_PATH)[0] + time.strftime('.backup-%Y%m%d-%H%M%S-convert.db')
        with sqlite3.connect(backup) as out:
            db.backup(out)
        print(f'database backed up to {backup}')
    claimed = set()
    failed = 0
    for folder in training_folders(args.folders, args.recursive):
        print(f'\n== {folder}')
        plan = Plan(folder, args.dry_run)
        try:
            cfg = job_config_of(folder)
            found = find_job(folder, cfg, db, history, claimed) if cfg is not None else None
            convert_files(folder, plan)
            db.execute('BEGIN IMMEDIATE')
            try:
                prompt, last = link_job(folder, plan, db, found)
                db.execute('ROLLBACK' if args.dry_run else 'COMMIT')
            except Exception:
                db.execute('ROLLBACK')
                raise
            if not args.dry_run:
                n = write_thumbnails(folder, prompt, last)
                plan.log(f'thumbnails: {n} from sample prompt {prompt + 1}')
                with open(os.path.join(folder, META, 'convert_log.txt'), 'a', encoding='utf-8') as fh:
                    fh.write(time.strftime('%Y-%m-%d %H:%M:%S') + '\n' + '\n'.join(plan.lines) + '\n\n')
        except Exception as e:
            failed += 1
            print(f'FAILED: {e}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
