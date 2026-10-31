"""DUAL BUILD: download exactly the files a model folder lists (its files.json).

Run by each models/hf/<org>/<repo>/download.bat and by the New Job page's
"Download model" button:

    python toolkit/model_fetch.py <files.json> [<files.json> ...]

Each item is {repo, file, dest, size}: `file` is the repo path, `dest` the
place under the models folder aitk loads it from (models/hf/<org>/<repo>/...
for hub-style models, the ComfyUI layout for comfy weights). Files already
there with the right size are skipped. Standalone on purpose (no toolkit
import), so it runs from any interpreter that has huggingface_hub.
"""

import json
import os
import shutil
import sqlite3
import sys

TOOLKIT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def hf_token():
    token = os.environ.get("HF_TOKEN", "").strip()
    if token:
        return token
    try:
        conn = sqlite3.connect(os.path.join(TOOLKIT_ROOT, "aitk_db.db"))
        row = conn.execute("SELECT value FROM Settings WHERE key = 'HF_TOKEN'").fetchone()
        conn.close()
        if row and row[0] and row[0].strip():
            return row[0].strip()
    except Exception:
        pass
    return None  # huggingface_hub falls back to `hf auth login`


def from_hf_cache(repo_id, rel, dest):
    """reuse a file the old HF cache already holds (copied, so the cache can be deleted after)"""
    try:
        from huggingface_hub import try_to_load_from_cache

        cached = try_to_load_from_cache(repo_id, rel)
        if isinstance(cached, str) and os.path.isfile(cached):
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copyfile(cached, dest + ".aitk_copy")
            os.replace(dest + ".aitk_copy", dest)
            return True
    except Exception:
        pass
    return False


def fmt_size(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.2f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024


def fetch(manifest_path, token):
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    models_root = manifest.get("models_root") or os.path.join(TOOLKIT_ROOT, "models")
    items = manifest.get("items", [])
    print(f"== {manifest.get('title', manifest_path)}: {len(items)} file(s), {fmt_size(sum(i.get('size') or 0 for i in items))}")

    from huggingface_hub import hf_hub_download

    failed = 0
    for n, item in enumerate(items, 1):
        dest = os.path.join(models_root, *item["dest"].split("/"))
        size = item.get("size")
        if os.path.isfile(dest) and (not size or os.path.getsize(dest) == size):
            print(f"[{n}/{len(items)}] have {item['dest']}")
            continue
        if from_hf_cache(item["repo"], item["file"], dest):
            print(f"[{n}/{len(items)}] copied from the HF cache: {item['dest']}", flush=True)
            continue
        print(f"[{n}/{len(items)}] {item['repo']} : {item['file']} ({fmt_size(size)}) -> {item['dest']}", flush=True)
        # stage beside the target (same drive, so the final step is a rename)
        staging = os.path.join(models_root, ".aitk_download", *item["repo"].split("/"))
        try:
            path = hf_hub_download(item["repo"], item["file"], local_dir=staging, token=token)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            os.replace(path, dest)
        except Exception as e:
            failed += 1
            print(f"   FAILED: {e}", flush=True)
    shutil.rmtree(os.path.join(models_root, ".aitk_download"), ignore_errors=True)
    return failed


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    token = hf_token()
    failed = 0
    for manifest in sys.argv[1:]:
        failed += fetch(manifest, token)
    print("== done" if not failed else f"== done, {failed} file(s) failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
