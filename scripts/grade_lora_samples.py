"""Grade a finished (or running) LoRA job by face identity, checkpoint by checkpoint.

For every saved step it reads the job's samples and scores:
  - likeness:   how close the faces in a subject's prompts are to that subject's real
                photos (ArcFace cosine similarity to the subject's centroid)
  - leakage:    in prompts that name no subject (the control prompts, e.g. "a man and
                a woman at a bar"), the strongest match to ANY subject - should stay low
  - swap:       in prompts that place two subjects ("j@cid on the left ... l3xi on the
                right"), whether each landed on the side the prompt asked for
  - faces:      share of samples where every expected face was found

and picks the step with the best likeness among those that keep leakage low and faces
found. It measures WHO is in the picture, not whether the picture is good: look at the
picked step yourself.

Models: SCRFD-10GF (detection + 5 landmarks) and ArcFace ResNet100 glintr100, the
insightface antelopev2 pack (non-commercial research licence). Needs insightface and
onnxruntime (GPU build for speed).

Usage:
  python scripts/grade_lora_samples.py "J:/Training/outputs/MyJob" ^
      --ref "l3xi=D:/Datasets/US/l3xi" --ref "j@cid=D:/Datasets/US/j@cid" ^
      --models "<folder with scrfd_10g_bnkps.onnx and glintr100.onnx>"
A ref is TRIGGER=FOLDER: the trigger as it appears in the sample prompts, and the
subject's real photos.
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict

import cv2
import numpy as np
from PIL import Image, ImageOps

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
SAMPLE_RE = re.compile(r"__(\d{9})_(\d+)\.(?:jpg|jpeg|png|webp)$", re.I)
SIDE_RE = r"[^.\n]{0,60}?\b(left|right)\b"
# where the Basement app's image-organizer runtime keeps the antelopev2 pack
DEFAULT_MODELS = os.path.join(os.environ.get("LOCALAPPDATA", ""), "com.sunrisecablema.basementui", "runtimes",
                              "image-organizer", "models", "antelopev2", "antelopev2")


def load_bgr(path):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)


class FaceModels:
    def __init__(self, models_dir, det_size=640, det_thresh=0.5, gpu=0):
        from insightface.model_zoo import get_model
        det_path = os.path.join(models_dir, "scrfd_10g_bnkps.onnx")
        rec_path = os.path.join(models_dir, "glintr100.onnx")
        for p in (det_path, rec_path):
            if not os.path.isfile(p):
                raise FileNotFoundError(p)
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        self.det = get_model(det_path, providers=providers)
        self.det.prepare(ctx_id=gpu, input_size=(det_size, det_size), det_thresh=det_thresh)
        self.rec = get_model(rec_path, providers=providers)
        self.rec.prepare(ctx_id=gpu)

    def faces(self, bgr):
        """[(box [x1,y1,x2,y2], score, unit embedding), ...] largest first."""
        from insightface.utils import face_align
        boxes, kpss = self.det.detect(bgr, max_num=0)
        out = []
        for box, kps in zip(boxes, kpss if kpss is not None else []):
            crop = face_align.norm_crop(bgr, landmark=kps, image_size=112)
            emb = self.rec.get_feat(crop).flatten()
            out.append((box[:4], float(box[4]), emb / np.linalg.norm(emb)))
        out.sort(key=lambda f: (f[0][2] - f[0][0]) * (f[0][3] - f[0][1]), reverse=True)
        return out


def reference(models, name, folder, max_photos):
    """The subject's centroid embedding and how consistent its photos are with each other."""
    names = sorted(n for n in os.listdir(folder) if n.lower().endswith(IMAGE_EXTS))[:max_photos]
    embs, used = [], []
    for n in names:
        faces = models.faces(load_bgr(os.path.join(folder, n)))
        if not faces:
            continue
        if len(faces) > 1:
            # only a photo where one face clearly dominates, so we know whose it is
            a0 = (faces[0][0][2] - faces[0][0][0]) * (faces[0][0][3] - faces[0][0][1])
            a1 = (faces[1][0][2] - faces[1][0][0]) * (faces[1][0][3] - faces[1][0][1])
            if a0 < 3 * a1:
                continue
        embs.append(faces[0][2])
        used.append(n)
    if len(embs) < 3:
        raise ValueError(f"{name}: only {len(embs)} usable reference face(s) in {folder}")
    embs = np.stack(embs)
    centroid = embs.mean(0)
    centroid /= np.linalg.norm(centroid)
    # leave-one-out: each photo against the centroid of the others - the likeness ceiling
    loo = []
    for i in range(len(embs)):
        rest = np.delete(embs, i, 0).mean(0)
        loo.append(float(embs[i] @ (rest / np.linalg.norm(rest))))
    print(f"  {name}: {len(embs)} reference faces from {len(names)} photos, "
          f"photo-to-photo likeness {np.mean(loo):.3f}")
    return {"centroid": centroid, "ceiling": float(np.mean(loo)), "count": len(embs)}


def read_prompts(job_dir):
    import yaml
    with open(os.path.join(job_dir, "config.yaml"), encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    sample = cfg["config"]["process"][0].get("sample", {})
    if sample.get("samples"):
        return [s["prompt"] if isinstance(s, dict) else s for s in sample["samples"]]
    return list(sample.get("prompts", []))


def prompt_plan(prompt, triggers):
    """Which subjects a prompt asks for, and the side each was put on (None when unsaid)."""
    want = []
    for t in triggers:
        m = re.search(r"(?<!\w)" + re.escape(t) + r"(?!\w)", prompt, re.I)
        if m:
            side = re.match(SIDE_RE, prompt[m.end():], re.I)
            want.append((m.start(), t, side.group(1).lower() if side else None))
    return [(t, side) for _pos, t, side in sorted(want)]


def grade_sample(faces, plan, refs):
    row = {"faces_found": len(faces)}
    if not plan:
        # control prompt: nobody should look like a subject
        sims = [float(f[2] @ refs[t]["centroid"]) for f in faces for t in refs]
        row["leakage"] = max(sims) if sims else 0.0
        row["complete"] = True
        return row
    free = list(range(len(faces)))
    placed = {}
    # best matches first, so two subjects never claim the same face
    pairs = sorted(((float(faces[i][2] @ refs[t]["centroid"]), t, i) for t, _s in plan for i in free), reverse=True)
    for sim, t, i in pairs:
        if t in placed or i not in free:
            continue
        placed[t] = (sim, i)
        free.remove(i)
    for t, _side in plan:
        row[f"likeness:{t}"] = placed[t][0] if t in placed else 0.0
    row["complete"] = all(t in placed for t, _s in plan)
    sided = [(t, side) for t, side in plan if side and t in placed]
    if len(sided) >= 2:
        centers = {t: (faces[placed[t][1]][0][0] + faces[placed[t][1]][0][2]) / 2 for t, _s in sided}
        lefts = [t for t, side in sided if side == "left"]
        rights = [t for t, side in sided if side == "right"]
        row["swap_ok"] = all(centers[a] < centers[b] for a in lefts for b in rights)
    return row


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("job", help="the job's training folder (holds config.yaml and samples/)")
    p.add_argument("--ref", action="append", required=True, metavar="TRIGGER=FOLDER")
    p.add_argument("--models", default=DEFAULT_MODELS, help="folder with scrfd_10g_bnkps.onnx and glintr100.onnx")
    p.add_argument("--max_ref_photos", type=int, default=60)
    p.add_argument("--leak_threshold", type=float, default=0.30,
                   help="control-prompt likeness above this counts as leakage")
    p.add_argument("--out", default=None, help="where to write the grades (default: <job>/grades)")
    args = p.parse_args()

    out = args.out or os.path.join(args.job, "grades")
    os.makedirs(out, exist_ok=True)
    models = FaceModels(args.models)

    print("References:")
    refs = {}
    for r in args.ref:
        trigger, folder = r.split("=", 1)
        refs[trigger.strip()] = reference(models, trigger.strip(), folder.strip(), args.max_ref_photos)

    prompts = read_prompts(args.job)
    plans = [prompt_plan(pr, list(refs)) for pr in prompts]
    for i, (pr, plan) in enumerate(zip(prompts, plans)):
        who = ", ".join(f"{t}{'(' + s + ')' if s else ''}" for t, s in plan) or "CONTROL (no subject)"
        print(f"  prompt {i}: {who}  |  {pr[:70]}...")

    sample_dir = os.path.join(args.job, "samples")
    rows = []
    for n in sorted(os.listdir(sample_dir)):
        m = SAMPLE_RE.search(n)
        if not m:
            continue
        step, idx = int(m.group(1)), int(m.group(2))
        if idx >= len(plans):
            continue
        faces = models.faces(load_bgr(os.path.join(sample_dir, n)))
        row = {"file": n, "step": step, "prompt": idx, **grade_sample(faces, plans[idx], refs)}
        rows.append(row)

    # per step
    steps = defaultdict(list)
    for r in rows:
        steps[r["step"]].append(r)
    summary = []
    for step in sorted(steps):
        rs = steps[step]
        s = {"step": step, "samples": len(rs),
             "faces_ok": sum(r["complete"] for r in rs) / len(rs)}
        for t in refs:
            vals = [r[f"likeness:{t}"] for r in rs if f"likeness:{t}" in r]
            if vals:
                s[f"likeness:{t}"] = float(np.mean(vals))
        leaks = [r["leakage"] for r in rs if "leakage" in r]
        if leaks:
            s["leakage_max"] = float(max(leaks))
        swaps = [r["swap_ok"] for r in rs if "swap_ok" in r]
        if swaps:
            s["swap_ok"] = sum(swaps) / len(swaps)
        like = [s[f"likeness:{t}"] for t in refs if f"likeness:{t}" in s]
        s["likeness_mean"] = float(np.mean(like)) if like else 0.0
        summary.append(s)

    # the pick: best likeness among steps that keep faces and stay below the leak line
    # (step 0 is the untrained model, never a pick)
    ok = [s for s in summary if s["step"] > 0 and s["faces_ok"] >= 0.9
          and s.get("leakage_max", 0.0) <= args.leak_threshold]
    best = max(ok, key=lambda s: s["likeness_mean"]) if ok else None
    # the earliest step within 0.01 of the best: same likeness, less chance of overtraining
    early = min((s for s in ok if s["likeness_mean"] >= best["likeness_mean"] - 0.01), key=lambda s: s["step"]) if best else None

    cols = ["step", "faces_ok"] + [f"likeness:{t}" for t in refs] + ["likeness_mean", "leakage_max", "swap_ok"]
    cols = [c for c in cols if any(c in s for s in summary)]
    with open(os.path.join(out, "summary.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(summary)
    sample_cols = sorted({k for r in rows for k in r}, key=lambda k: (k not in ("file", "step", "prompt"), k))
    with open(os.path.join(out, "samples.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=sample_cols)
        w.writeheader()
        w.writerows(rows)
    report = {"refs": {t: {"ceiling": v["ceiling"], "count": v["count"]} for t, v in refs.items()},
              "prompts": [{"prompt": pr, "subjects": [t for t, _ in pl]} for pr, pl in zip(prompts, plans)],
              "summary": summary, "best_step": best and best["step"], "earliest_near_best": early and early["step"],
              "leak_threshold": args.leak_threshold}
    with open(os.path.join(out, "grades.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    chart(summary, refs, args.leak_threshold, best, os.path.join(out, "grades.png"))

    print("\n" + " | ".join(f"{c:>14}" for c in cols))
    for s in summary:
        print(" | ".join(f"{s[c]:>14.3f}" if isinstance(s.get(c), float) else f"{s.get(c, ''):>14}" for c in cols))
    for t, v in refs.items():
        print(f"\nLikeness ceiling for {t} (their real photos vs each other): {v['ceiling']:.3f}")
    if best:
        print(f"Best step: {best['step']} (likeness {best['likeness_mean']:.3f}); "
              f"earliest near-best: {early['step']}")
    else:
        print("No step passed the face / leakage checks.")
    print(f"Wrote {out}")


def chart(summary, refs, leak_threshold, best, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    steps = [s["step"] for s in summary]
    fig, ax = plt.subplots(figsize=(9, 4.5))
    for t, v in refs.items():
        ys = [s.get(f"likeness:{t}") for s in summary]
        line, = ax.plot(steps, ys, marker="o", label=f"likeness {t}")
        ax.axhline(v["ceiling"], ls=":", lw=1, color=line.get_color())
    if any("leakage_max" in s for s in summary):
        ax.plot(steps, [s.get("leakage_max") for s in summary], marker="x", color="crimson", label="leakage (control)")
        ax.axhline(leak_threshold, ls="--", lw=1, color="crimson")
    if best:
        ax.axvline(best["step"], ls="--", lw=1, color="gray")
        ax.annotate(f"pick {best['step']}", (best["step"], ax.get_ylim()[1]), ha="center", va="top", fontsize=9)
    ax.set_xlabel("step")
    ax.set_ylabel("ArcFace similarity")
    ax.set_title("Identity grades per checkpoint (dotted = real photo ceiling)")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=120)


if __name__ == "__main__":
    sys.exit(main())
