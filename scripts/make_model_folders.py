"""DUAL BUILD: create the model folder tree with an itemized download.bat in each.

    python scripts/make_model_folders.py            (with the aitk interpreter)

For every model in the New Job list it works out the files aitk loads and
writes, per hub repo:

    models/hf/<org>/<repo>/download.bat   runs toolkit/model_fetch.py on:
    models/hf/<org>/<repo>/files.json     the itemized list (repo file -> where aitk reads it)
    models/hf/<org>/<repo>/FILES.txt      the same list, readable, with sizes

plus models/hf/_models.json (arch -> its folders) for the New Job page's
"Download model" button. Only metadata is read from the hub; nothing large
is downloaded. Re-run any time; existing model files are never touched.

Which files:
- hub-style repos: the diffusers/transformers folders minus duplicates (the
  root single-file checkpoint, .bin next to .safetensors, fp16/ema variants,
  onnx/flax/docs/images, .git)
- components aitk loads from a ComfyUI weight file (v2 classes'
  aitk_comfy_weight_names) get that file in the ComfyUI layout, ranked for the
  model's default qtype like the loader does, and only the configs from the
  standard repo
- 'org/repo/path/file.safetensors' references: that file
- a few loaders with their own logic have explicit rules (RULES below);
  models that resolve their files themselves into the ComfyUI layout and have
  no rule are marked "auto" (they download exactly what they need on first run)
"""

import fnmatch
import importlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

import toolkit  # noqa: E402  (installs the hf_local hook; MODELS_PATH)
from toolkit.paths import MODELS_PATH  # noqa: E402
from toolkit.hf_local import HF_MODELS_PATH  # noqa: E402
from toolkit.models.v2.resolver import comfy_local_rel, comfy_precision_rank  # noqa: E402

UI_FILES = [
    "extensions_built_in/diffusion_models/ui.tsx",
    "extensions_built_in/audio_models/ui.tsx",
    "extensions_built_in/flex2/ui.tsx",
    "extensions_built_in/llm_models/ui.tsx",
]

WEIGHT_EXT = (".safetensors", ".bin", ".pt", ".pth", ".ckpt", ".gguf", ".sft")
JUNK = [
    ".git*", "*.md", "LICENSE*", "license*", "NOTICE*", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp",
    "*.mp4", "*.mp3", "*.wav", "*.pdf", "assets/*", "images/*", "examples/*", "docs/*", "demo*/*",
    "*.onnx", "*.onnx_data", "onnx/*", "*.msgpack", "*.h5", "*.ot", "*.tflite", "openvino/*",
    "coreml/*", "*.mlmodel*", "*.pb", "openvino_model*", "*.xml", "*/.ipynb_checkpoints/*", "*.ipynb",
]
VARIANT_RE = re.compile(r"\.(fp16|fp32|bf16|ema|non_ema|non-ema|noema)(-\d+-of-\d+)?\.(safetensors|bin)$", re.I)

# models whose loaders resolve their own files into the ComfyUI layout
CUSTOM_COMFY = {"moss_image", "minimax_h3", "fibo2", "flux3", "iris3b", "ltx2", "zimage_l2p"}

# explicit rules: arch base -> {repo: [(file, dest-kind)]}; dest-kind "comfy" or "hf"
MOSS_COMFY = "Comfy-Org/MOSS-Image"
RULES = {
    "moss_image": {
        # the loader's own repack names (..._int8_convrot_attn) are gone from the repo; it
        # also takes a local moss_image_<variant>_bf16 file, which the repack now ships
        "OpenMOSS-Team/MOSS-Image-SFT": [
            (MOSS_COMFY, "diffusion_models/moss_image_sft_bf16.safetensors", "comfy"),
            (MOSS_COMFY, "text_encoders/qwen3.5_9b_int8_convrot.safetensors", "comfy"),
            (MOSS_COMFY, "vae/flux2-vae.safetensors", "comfy"),
            ("OpenMOSS-Team/MOSS-Image-SFT", "tokenizer/*", "hf"),
            ("Qwen/Qwen3.5-9B", "preprocessor_config.json", "hf"),  # edit variants
        ],
        "OpenMOSS-Team/MOSS-Image-Base": [
            (MOSS_COMFY, "diffusion_models/moss_image_base_bf16.safetensors", "comfy"),
            (MOSS_COMFY, "text_encoders/qwen3.5_9b_int8_convrot.safetensors", "comfy"),
            (MOSS_COMFY, "vae/flux2-vae.safetensors", "comfy"),
            ("OpenMOSS-Team/MOSS-Image-Base", "tokenizer/*", "hf"),
            ("Qwen/Qwen3.5-9B", "preprocessor_config.json", "hf"),
        ],
    },
}
# repos whose loader reads the root single file, not the diffusers transformer/ folder
ROOT_SINGLE_FILE = {"krea/Krea-2-Raw": "raw.safetensors", "krea/Krea-2-Turbo": "turbo.safetensors"}


# ---------------------------------------------------------------- UI models
def ui_models():
    out = []
    for f in UI_FILES:
        s = open(os.path.join(ROOT, f), encoding="utf-8").read()
        starts = [m.start() for m in re.finditer(r"\n\s*\{\s*\n\s*name:\s*[\"']", s)] + [len(s)]
        for a, b in zip(starts, starts[1:]):
            blk = s[a:b]
            name = re.search(r"name:\s*[\"']([^\"']+)[\"']", blk).group(1)
            label = re.search(r"label:\s*[\"']([^\"']+)[\"']", blk)
            refs = []
            for m in re.finditer(r"[\"']([A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+(?:/[^\"'\s]*)?)[\"']", blk):
                v = m.group(1)
                if v.startswith(("config.", "http")) or " " in v or v in refs:
                    continue
                refs.append(v)
            qt = {}
            for key in ("qtype", "qtype_te", "quantize", "quantize_te"):
                m = re.search(r"\"config\.process\[0\]\.model\.%s\":\s*\[\s*([^,\]]+)" % key, blk)
                if m:
                    qt[key] = m.group(1).strip().strip("\"'")
            out.append({"name": name, "label": label.group(1) if label else name, "refs": refs, "q": qt})
    return out


def qtype_for(model, te=False):
    q = model["q"]
    if q.get("quantize_te" if te else "quantize", "false") != "true":
        return None
    return q.get("qtype_te" if te else "qtype") or "qfloat8"


# ---------------------------------------------------------------- comfy registry
def comfy_registry():
    """standard repo (or (repo, subfolder)) -> [(class, comfy repo, candidates, subfolder, is_te)]"""
    for root in ["toolkit/models/v2", "extensions_built_in/diffusion_models"]:
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d != "__pycache__"]
            for f in fn:
                if f.endswith(".py"):
                    mod = os.path.join(dp, f[:-3]).replace(os.sep, ".").replace("/", ".")
                    try:
                        importlib.import_module(mod[:-9] if mod.endswith(".__init__") else mod)
                    except Exception:
                        pass
    from toolkit.models.v2._mixin import OstrisModelMixin

    reg = {}
    stack, seen = list(OstrisModelMixin.__subclasses__()), set()
    while stack:
        c = stack.pop()
        if c in seen:
            continue
        seen.add(c)
        stack.extend(c.__subclasses__())
        names = c.__dict__.get("aitk_comfy_weight_names") or {}
        is_te = "TextEncoder" in c.__name__ or "Encoder" in c.__name__ and "VAE" not in c.__name__
        for key, cands in names.items():
            repo_id = c.aitk_comfy_repo
            if isinstance(cands, dict):
                repo_id = cands.get("repo", repo_id)
                cands = cands.get("files")
            if not cands or not repo_id:
                continue
            repo, sub = key if isinstance(key, tuple) else (key, getattr(c, "aitk_subfolder", None))
            reg.setdefault(repo, []).append((c.__name__, repo_id, list(cands), sub, is_te))
    return reg


# ---------------------------------------------------------------- hub listing
_listing = {}


def listing(repo, token):
    if repo in _listing:
        return _listing[repo]
    from huggingface_hub import HfApi

    try:
        files = {
            e.path: (getattr(e, "size", None) or 0)
            for e in HfApi(token=token).list_repo_tree(repo, recursive=True)
            if hasattr(e, "size") and not getattr(e, "tree_id", None)
        }
    except Exception as e:
        print(f"   ! can't list {repo}: {type(e).__name__}: {str(e)[:120]}")
        files = None
    _listing[repo] = files
    return files


def is_weight(p):
    return p.lower().endswith(WEIGHT_EXT)


def pipeline_components(repo, files):
    """the subfolders a diffusers model_index.json names (others are extras: alternate VAEs etc.)"""
    if "model_index.json" not in files:
        return None
    try:
        from huggingface_hub import hf_hub_download

        with open(hf_hub_download(repo, "model_index.json"), "r", encoding="utf-8") as f:
            idx = json.load(f)
        return {k for k, v in idx.items() if isinstance(v, list) and v and v[0]}
    except Exception:
        return None


def generic_files(repo, files, drop_weight_dirs=(), configs_only=False, skip_dirs=()):
    components = pipeline_components(repo, files)
    keep = []
    for p in files:
        top = p.split("/")[0] if "/" in p else ""
        if top and components is not None and top not in components:
            continue
        if top and top in skip_dirs:
            continue
        if any(fnmatch.fnmatch(p, j) or fnmatch.fnmatch(os.path.basename(p), j) for j in JUNK):
            continue
        if configs_only and is_weight(p):
            continue
        keep.append(p)
    dirs = {}
    for p in keep:
        dirs.setdefault(os.path.dirname(p), []).append(p)
    is_diffusers = "model_index.json" in files or any(
        os.path.dirname(p) and os.path.basename(p) == "config.json" for p in files
    )
    out = []
    for d, ps in dirs.items():
        has_st = any(p.endswith(".safetensors") for p in ps)
        has_plain = any(is_weight(p) and not VARIANT_RE.search(p) for p in ps)
        for p in ps:
            if is_weight(p):
                if has_st and not p.endswith(".safetensors"):
                    continue  # .bin/.pt duplicates of the safetensors
                if has_plain and VARIANT_RE.search(p):
                    continue  # fp16 / ema variants of the default weights
                if d == "" and is_diffusers:
                    continue  # root single-file copy of the diffusers folders
                top = p.split("/")[0]
                if top in drop_weight_dirs:
                    continue  # weights come from a ComfyUI file instead
            if d.startswith(("split_files", "diffusion_models", "text_encoders", "vae/", "checkpoints", "loras")) and is_weight(p):
                continue  # comfy packs: never every precision variant
            out.append(p)
    root_file = ROOT_SINGLE_FILE.get(repo)
    if root_file:
        out = [p for p in out if not p.startswith("transformer/")]
        if root_file in files and root_file not in out:
            out.append(root_file)
    return sorted(out)


def best_candidate(cands, existing, qtype):
    present = [c for c in cands if c in existing]
    if not present:
        return None
    return sorted(present, key=lambda c: (comfy_precision_rank(c, qtype=qtype), cands.index(c)))[0]


def hf_dest(repo, path):
    return "hf/" + repo + "/" + path


# ---------------------------------------------------------------- main
def main():
    token = os.environ.get("HF_TOKEN") or None
    if not token:
        try:
            import sqlite3

            row = sqlite3.connect(os.path.join(ROOT, "aitk_db.db")).execute(
                "SELECT value FROM Settings WHERE key = 'HF_TOKEN'"
            ).fetchone()
            token = (row[0] or "").strip() or None if row else None
        except Exception:
            pass

    print("reading model list and loader weight tables ...")
    models = ui_models()
    reg = comfy_registry()

    per_repo = {}  # repo -> {dest: item}
    arch_index = {}

    def add(owner, repo, file, dest, size):
        item = {"repo": repo, "file": file, "dest": dest, "size": size}
        per_repo.setdefault(owner, {})[dest] = item
        arch_items[dest] = item

    for m in models:
        base = m["name"].split(":")[0]
        folders, auto = [], False
        arch_items = {}
        for i, ref in enumerate(m["refs"]):
            parts = ref.split("/")
            repo = "/".join(parts[:2])
            print(f"{m['name']}: {ref}")
            files = listing(repo, token)
            if files is None:
                continue
            if repo not in folders:
                folders.append(repo)

            if len(parts) > 2:  # a single file
                rel = "/".join(parts[2:])
                if rel in files:
                    dest = comfy_local_rel(rel) if base in CUSTOM_COMFY else hf_dest(repo, rel)
                    add(repo, repo, rel, dest, files[rel])
                continue

            rule = RULES.get(base, {}).get(repo)
            if rule:
                for src, pat, kind in rule:
                    src_files = files if src == repo else (listing(src, token) or {})
                    for p in sorted(src_files):
                        if fnmatch.fnmatch(p, pat) or fnmatch.fnmatch(comfy_local_rel(p), pat):
                            dest = comfy_local_rel(p) if kind == "comfy" else hf_dest(src, p)
                            add(repo, src, p, dest, src_files[p])
                continue
            if base in CUSTOM_COMFY and i == 0:
                auto = True
                continue

            entries = reg.get(repo, [])
            replaced = set()
            for cls_name, comfy_repo, cands, sub, is_te in entries:
                if i > 0 and (sub or "transformer").startswith(("transformer", "unet")) and not is_te:
                    continue
                cfiles = listing(comfy_repo, token) or {}
                pick = best_candidate(cands, cfiles, qtype_for(m, te=is_te))
                if pick:
                    add(repo, comfy_repo, pick, comfy_local_rel(pick), cfiles[pick])
                    replaced.add(sub or "")
            comfy_pack = repo.startswith(("Comfy-Org/", "Kijai/")) or "comfy" in repo.lower()
            # a second repo (extras_name_or_path) supplies text encoder / VAE / tokenizer only
            skip = ("transformer", "transformer_2", "unet") if i > 0 else ()
            for p in generic_files(
                repo, files, drop_weight_dirs=replaced, configs_only=comfy_pack or "" in replaced, skip_dirs=skip
            ):
                add(repo, repo, p, hf_dest(repo, p), files[p])
        arch_index[m["name"]] = {
            "label": m["label"],
            "repos": folders,
            "auto": auto,
            "items": sorted(arch_items.values(), key=lambda x: x["dest"]),
        }

    # write folders
    py = sys.executable
    fetch = os.path.join(ROOT, "toolkit", "model_fetch.py")
    for repo, items in sorted(per_repo.items()):
        folder = os.path.join(HF_MODELS_PATH, *repo.split("/"))
        os.makedirs(folder, exist_ok=True)
        items = sorted(items.values(), key=lambda x: x["dest"])
        total = sum(x["size"] or 0 for x in items)
        manifest = {"title": repo, "models_root": MODELS_PATH, "items": items, "total": total}
        with open(os.path.join(folder, "files.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=1)
        lines = [f"{repo}  ({len(items)} files, {total / 1e9:.2f} GB)", ""]
        for x in items:
            src = "" if x["repo"] == repo else f"   [from {x['repo']}]"
            lines.append(f"{(x['size'] or 0) / 1e9:8.2f} GB  {x['dest']}{src}")
        with open(os.path.join(folder, "FILES.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        with open(os.path.join(folder, "download.bat"), "w", encoding="utf-8", newline="\r\n") as f:
            f.write("@echo off\n")
            f.write(f"REM {repo}: the {len(items)} files aitk loads ({total / 1e9:.2f} GB). See FILES.txt.\n")
            f.write("REM Already-downloaded files are skipped. Gated repos need your HF token (aitk Settings).\n")
            f.write("cd /d \"%~dp0\"\n")
            f.write(f"\"{py}\" \"{fetch}\" \"%~dp0files.json\"\n")
            f.write("if \"%AITK_NO_PAUSE%\"==\"\" pause\n")
    for a in arch_index.values():
        a["repos"] = [r for r in a["repos"] if r in per_repo]
    with open(os.path.join(HF_MODELS_PATH, "_models.json"), "w", encoding="utf-8") as f:
        json.dump({"models_root": MODELS_PATH, "python": py, "fetch": fetch, "models": arch_index}, f, indent=1)
    print(f"\nwrote {len(per_repo)} folders under {HF_MODELS_PATH}")
    for name, a in arch_index.items():
        size = sum(x["size"] or 0 for x in a["items"])
        print(f"  {name:28s} {size / 1e9:7.1f} GB  {'AUTO ' if a['auto'] else ''}{', '.join(a['repos'])}")


if __name__ == "__main__":
    main()
