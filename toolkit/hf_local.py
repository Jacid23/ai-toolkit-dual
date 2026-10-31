"""DUAL BUILD: Hugging Face models live in plain folders, never the HF cache.

Every hub download that would land in the HF cache (hf_hub_download /
snapshot_download without a local_dir: transformers / diffusers from_pretrained,
direct calls in the model loaders) is served from, or downloaded into,

    MODELS_PATH/hf/<org>/<repo>/<same paths as the repo>

as real files (no blobs, symlinks or hashes). A file already there is used
without touching the network. Calls that pass their own local_dir (the comfy
layout resolver) are left alone. Each folder can carry a download.bat
(scripts/make_model_folders.py) to pre-fetch exactly what aitk loads.

Env:
  AITK_HF_LOCAL=0        turn this off (back to the HF cache)
  AITK_HF_LOCAL_ONLY=1   never download; a missing file is an error
"""

import os
import sys

from toolkit.paths import MODELS_PATH

HF_MODELS_PATH = os.path.join(MODELS_PATH, "hf")
USED_FILE = ".aitk_used.txt"  # repo files aitk actually requested, one per line


def repo_dir(repo_id: str) -> str:
    return os.path.join(HF_MODELS_PATH, *repo_id.split("/"))


def _local_only() -> bool:
    return os.environ.get("AITK_HF_LOCAL_ONLY", "0").strip().lower() in ("1", "true", "yes")


def _record(folder: str, rel: str):
    try:
        path = os.path.join(folder, USED_FILE)
        seen = set()
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                seen = {l.strip() for l in f if l.strip()}
        if rel not in seen:
            os.makedirs(folder, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(rel + "\n")
    except Exception:
        pass


def from_hf_cache(repo_id: str, rel: str, dest: str) -> bool:
    """A file the old HF cache already holds is copied over instead of downloaded again."""
    try:
        from huggingface_hub import try_to_load_from_cache

        cached = try_to_load_from_cache(repo_id, rel)
        if isinstance(cached, str) and os.path.isfile(cached):
            import shutil

            os.makedirs(os.path.dirname(dest), exist_ok=True)
            tmp = dest + ".aitk_copy"
            shutil.copyfile(cached, tmp)
            os.replace(tmp, dest)
            return True
    except Exception:
        pass
    return False


def _is_model_repo(repo_type) -> bool:
    return repo_type in (None, "model")


def install():
    if os.environ.get("AITK_HF_LOCAL", "1").strip().lower() in ("0", "false", "no"):
        return
    import huggingface_hub
    import huggingface_hub.file_download as fd
    import huggingface_hub._snapshot_download as sd

    orig_file = fd.hf_hub_download
    orig_snap = sd.snapshot_download
    if getattr(orig_file, "_aitk_local", False):
        return

    def hf_hub_download(repo_id, filename, *args, **kwargs):
        if (
            args
            or kwargs.get("local_dir") is not None
            or kwargs.get("dry_run")
            or not _is_model_repo(kwargs.get("repo_type"))
        ):
            return orig_file(repo_id, filename, *args, **kwargs)
        folder = repo_dir(repo_id)
        subfolder = kwargs.get("subfolder")
        rel = f"{subfolder}/{filename}" if subfolder else filename
        local = os.path.join(folder, *rel.split("/"))
        if not kwargs.get("force_download") and (os.path.isfile(local) or from_hf_cache(repo_id, rel, local)):
            _record(folder, rel)
            return local
        kwargs.pop("cache_dir", None)
        kwargs.pop("local_dir", None)
        if _local_only():
            kwargs["local_files_only"] = True
        path = orig_file(repo_id, filename, local_dir=folder, **kwargs)
        _record(folder, rel)
        return path

    def snapshot_download(repo_id, *args, **kwargs):
        if (
            args
            or kwargs.get("local_dir") is not None
            or kwargs.get("dry_run")
            or not _is_model_repo(kwargs.get("repo_type"))
        ):
            return orig_snap(repo_id, *args, **kwargs)
        folder = repo_dir(repo_id)
        # an exact file list that is all there is served as-is; anything else goes through
        # the hub (into the folder), which fetches only the files that are missing
        allow = kwargs.get("allow_patterns")
        allow = [allow] if isinstance(allow, str) else allow
        if (
            allow
            and not kwargs.get("force_download")
            and not any(c in a for a in allow for c in "*?[")
            and all(os.path.isfile(os.path.join(folder, *a.split("/"))) for a in allow)
        ):
            return folder
        kwargs.pop("cache_dir", None)
        kwargs.pop("local_dir", None)
        if _local_only():
            kwargs["local_files_only"] = True
        return orig_snap(repo_id, local_dir=folder, **kwargs)

    hf_hub_download._aitk_local = True
    snapshot_download._aitk_local = True

    # later `from huggingface_hub import ...` picks these up; modules that
    # already imported the originals are patched in place
    for mod in (huggingface_hub, fd, sd):
        if getattr(mod, "hf_hub_download", None) is orig_file:
            mod.hf_hub_download = hf_hub_download
        if getattr(mod, "snapshot_download", None) is orig_snap:
            mod.snapshot_download = snapshot_download
    huggingface_hub.hf_hub_download = hf_hub_download
    huggingface_hub.snapshot_download = snapshot_download
    for mod in list(sys.modules.values()):
        try:
            if getattr(mod, "hf_hub_download", None) is orig_file:
                mod.hf_hub_download = hf_hub_download
            if getattr(mod, "snapshot_download", None) is orig_snap:
                mod.snapshot_download = snapshot_download
        except Exception:
            pass
