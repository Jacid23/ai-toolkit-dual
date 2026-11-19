"""DUAL BUILD: point every job's model paths at the models\\hf layout.

Hugging Face models now live in MODELS_PATH\\hf\\<org>\\<repo> (toolkit/hf_local.py). Jobs written
before the move still carry absolute paths into folders that are gone or duplicated. This rewrites
them once, in the database, instead of teaching the loaders the old places:

    model.assistant_lora_path          ...\\models\\K2adapter\\krea2_turbo_training_adapter_v1.safetensors
                                       (any install: AI-Toolkit-Dual-v2 or this one)
        -> MODELS_PATH\\hf\\ostris\\krea2_turbo_training_adapter\\krea2_turbo_training_adapter_v1.safetensors
    model.model_kwargs.text_encoder_path   ...\\models\\text_encoders\\Qwen3-VL-4b-Heretic
        -> MODELS_PATH\\hf\\Qwen\\Qwen3-VL-4b-Heretic

and sets Settings → Text Encoders Folder (TEXT_ENCODERS_FOLDER) to MODELS_PATH\\hf\\Qwen.
Running jobs are left alone. Each job folder's config.yaml / .job_config.json is written again
from the database when the job next starts, so only the database changes.

    python scripts\\repoint_model_paths.py [--dry-run]

The database is backed up first (aitk_db.backup-<time>-repoint.db).
"""

import argparse
import json
import ntpath
import os
import sqlite3
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get('AITK_DB_PATH') or os.path.join(ROOT, 'aitk_db.db')
MODELS_PATH = os.environ.get('MODELS_PATH', '').strip() or os.path.join(ROOT, 'models')
HF = os.path.join(MODELS_PATH, 'hf')

ADAPTER_FILE = 'krea2_turbo_training_adapter_v1.safetensors'
NEW_ADAPTER = os.path.join(HF, 'ostris', 'krea2_turbo_training_adapter', ADAPTER_FILE)
TE_NAME = 'Qwen3-VL-4b-Heretic'
NEW_TE = os.path.join(HF, 'Qwen', TE_NAME)
NEW_TE_FOLDER = os.path.join(HF, 'Qwen')


def _parts(p):
    return [x.lower() for x in ntpath.normpath(p).split('\\') if x]


def new_adapter_path(p):
    """the hf path for an old ...\\models\\K2adapter\\<adapter> path, else None"""
    if not isinstance(p, str) or not p.strip():
        return None
    parts = _parts(p)
    if parts[-3:] == ['models', 'k2adapter', ADAPTER_FILE.lower()]:
        return NEW_ADAPTER
    return None


def new_te_path(p):
    """the hf path for an old ...\\models\\text_encoders\\<encoder> path, else None"""
    if not isinstance(p, str) or not p.strip():
        return None
    parts = _parts(p)
    if parts[-3:] == ['models', 'text_encoders', TE_NAME.lower()]:
        return NEW_TE
    return None


def repoint(cfg):
    """rewrite the paths in one parsed job_config; returns a list of (field, old, new)"""
    changes = []
    for proc in (cfg.get('config') or {}).get('process') or []:
        model = proc.get('model') if isinstance(proc, dict) else None
        if not isinstance(model, dict):
            continue
        new = new_adapter_path(model.get('assistant_lora_path'))
        if new and model['assistant_lora_path'] != new:
            changes.append(('assistant_lora_path', model['assistant_lora_path'], new))
            model['assistant_lora_path'] = new
        kwargs = model.get('model_kwargs')
        if isinstance(kwargs, dict):
            new = new_te_path(kwargs.get('text_encoder_path'))
            if new and kwargs['text_encoder_path'] != new:
                changes.append(('text_encoder_path', kwargs['text_encoder_path'], new))
                kwargs['text_encoder_path'] = new
    return changes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true', help='print what would change, change nothing')
    args = ap.parse_args()

    for p in (NEW_ADAPTER, NEW_TE):
        if not os.path.exists(p):
            raise SystemExit(f'missing {p}: put the model there first')

    db = sqlite3.connect(DB_PATH)
    if not args.dry_run:
        backup = os.path.splitext(DB_PATH)[0] + time.strftime('.backup-%Y%m%d-%H%M%S-repoint.db')
        with sqlite3.connect(backup) as out:
            db.backup(out)
        print(f'database backed up to {backup}')

    counts = {'assistant_lora_path': 0, 'text_encoder_path': 0}
    jobs = 0
    for job_id, name, status, raw in db.execute('SELECT id, name, status, job_config FROM Job').fetchall():
        try:
            cfg = json.loads(raw)
        except Exception:
            print(f'  skipped {name}: job_config is not JSON')
            continue
        changes = repoint(cfg)
        if not changes:
            continue
        if status == 'running':
            print(f'  skipped {name}: running (run this again once it stops)')
            continue
        jobs += 1
        for field, old, new in changes:
            counts[field] += 1
            print(f'  {name}: {field}\n      {old}\n   -> {new}')
        if not args.dry_run:
            # keep the stored style: \\u escapes only if the original had no raw non-ASCII
            ascii_only = all(ord(ch) < 128 for ch in raw)
            db.execute('UPDATE Job SET job_config = ? WHERE id = ?',
                       (json.dumps(cfg, ensure_ascii=ascii_only), job_id))

    row = db.execute("SELECT value FROM Settings WHERE key = 'TEXT_ENCODERS_FOLDER'").fetchone()
    if row is None or row[0] != NEW_TE_FOLDER:
        print(f'  TEXT_ENCODERS_FOLDER: {row[0] if row else "(unset)"} -> {NEW_TE_FOLDER}')
        if not args.dry_run:
            if row is None:
                db.execute("INSERT INTO Settings (key, value) VALUES ('TEXT_ENCODERS_FOLDER', ?)", (NEW_TE_FOLDER,))
            else:
                db.execute("UPDATE Settings SET value = ? WHERE key = 'TEXT_ENCODERS_FOLDER'", (NEW_TE_FOLDER,))

    if not args.dry_run:
        db.commit()
    db.close()
    verb = 'would change' if args.dry_run else 'changed'
    print(f'{verb} {jobs} jobs: {counts["assistant_lora_path"]} turbo adapter paths, '
          f'{counts["text_encoder_path"]} text encoder paths')


if __name__ == '__main__':
    main()
