# DUAL BUILD: a training's thumbnails. Every LoRA in the job folder gets the sample of one prompt
# (the job's sample.thumbnail_prompt, default the first) at its step beside it as a .webp:
#   <name>_<step>.safetensors -> <name>_<step>.webp, <name>.safetensors -> <name>.webp (last step)
# Samples are read from <job folder>\config\samples (<time>__<step>_<prompt #>.<ext>, newest wins).
# Picking another prompt rewrites them all. Run by the trainer at the end of a job, by the UI's
# "Set as thumbnail" and after a late (ComfyUI) sample of the thumbnail prompt is saved.
#
#   python toolkit/job_thumbnails.py <job folder> <prompt #> [<final step>]
import os
import re
import shutil
import sys

SAMPLE_RE = re.compile(r'^(\d+)__(\d+)_(\d+)\.(webp|png|jpe?g)$', re.I)


def _newest_samples(samples_dir, prompt_idx):
    by_step = {}
    for f in os.listdir(samples_dir) if os.path.isdir(samples_dir) else []:
        m = SAMPLE_RE.match(f)
        if not m or int(m.group(3)) != prompt_idx:
            continue
        ts, step = int(m.group(1)), int(m.group(2))
        if step not in by_step or ts > by_step[step][0]:
            by_step[step] = (ts, os.path.join(samples_dir, f))
    return {step: p for step, (_, p) in by_step.items()}


def _write_webp(src, dest):
    tmp = dest + '.tmp'
    if src.lower().endswith('.webp'):
        shutil.copyfile(src, tmp)
    else:
        from PIL import Image
        with Image.open(src) as im:
            im.save(tmp, 'WEBP', quality=92)
    os.replace(tmp, dest)


def write_thumbnails(job_folder, prompt_idx=0, final_step=None):
    """Rewrite the job folder's thumbnails from prompt `prompt_idx`; returns how many were written."""
    name = os.path.basename(os.path.normpath(job_folder))
    samples = _newest_samples(os.path.join(job_folder, 'config', 'samples'), int(prompt_idx))
    ckpt_re = re.compile(r'^' + re.escape(name) + r'(?:_(\d+))?\.safetensors$')
    thumb_re = re.compile(r'^' + re.escape(name) + r'(?:_\d+)?\.webp$')
    files = os.listdir(job_folder)
    # the old prompt's thumbnails go, so the folder never mixes two prompts
    for f in files:
        if thumb_re.match(f):
            os.remove(os.path.join(job_folder, f))
    written = 0
    for f in files:
        m = ckpt_re.match(f)
        if not m:
            continue
        if m.group(1) is not None:
            step = int(m.group(1))
        else:
            # the final LoRA: the job's last step, else the newest sampled step
            step = final_step if final_step in samples else (max(samples) if samples else None)
        if step is None or step not in samples:
            continue
        _write_webp(samples[step], os.path.join(job_folder, f[: -len('.safetensors')] + '.webp'))
        written += 1
    return written


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__ or 'usage: job_thumbnails.py <job folder> <prompt #> [<final step>]')
        sys.exit(2)
    final = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None
    n = write_thumbnails(sys.argv[1], int(sys.argv[2]), final)
    print(f'{n} thumbnail(s) written')
