"""Build side-by-side "subject next to a stranger" images for a multi-person LoRA.

Each subject gets PER_SUBJECT 2:1 pictures: one of its training photos beside a
fixed stranger, the side picked at random. The caption describes the stranger
first and the subject second, because the text encoders are causal: words after a
trigger carry it, the stranger described before it stays clean:

  Two individual close-up portraits placed side by side.
  The left portrait is of a Latino woman in her 40s.
  The right portrait is of l3xi, a Caucasian woman in her 40s.

Train the output folder
as one more dataset next to the subjects, with Differential Output Preservation
on and every subject's trigger in diff_output_preservation_triggers.

Recipe and stranger set from Fizgig's LoRA Isolation
(https://github.com/shootthesound/Fizgig, Copyright 2026 Peter Neill, Apache-2.0).
The strangers are generated people, CC BY 4.0:
https://huggingface.co/datasets/ShootTheSound/fizgig-multi-person-strangers

Usage:
  python scripts/build_dop_side_by_side.py ^
      --subject "D:/data/US/j@cid" "j@cid" ^
      --subject "D:/data/US/l3xi" "l3xi" ^
      --describe "j@cid=a Caucasian man in his 40s" ^
      --describe "l3xi=a Caucasian woman in her 40s" ^
      --out "D:/data/US/_side_by_side"
"""

import argparse
import json
import os
import random
import re
import sys

import cv2
import numpy as np
from PIL import Image, ImageOps

REPO = "ShootTheSound/fizgig-multi-person-strangers"
REVISION = "8aeb77502234781cb5dca524994c80efcaa51024"  # pinned, so a rebuild gives the same strangers
PREFIX = "side_by_side_"
PER_SUBJECT = 16
PANEL = 512  # each half of a 1024 x 512 picture
HEADER = "Two individual close-up portraits placed side by side."
# the stranger set's wording -> the wording these captions use
STRANGER_WORDS = {"a Black ": "an African American ", "a white ": "a Caucasian "}
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
TOOLKIT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_STRANGERS = os.path.join(TOOLKIT_ROOT, "models", "dop_strangers")
# OpenCV model zoo: https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
DEFAULT_YUNET = os.path.join(TOOLKIT_ROOT, "models", "face", "face_detection_yunet_2023mar.onnx")


def subject_sex(folder, caption_ext):
    """"man" or "woman" from the words the subject's captions use most, or None."""
    counts = {"man": 0, "woman": 0}
    for n in os.listdir(folder):
        if not n.endswith(caption_ext) or n.startswith(PREFIX):
            continue
        with open(os.path.join(folder, n), encoding="utf-8", errors="replace") as f:
            text = f.read().lower()
        counts["man"] += len(re.findall(r"\b(?:male|man|guy|boy|he|his|him)\b", text))
        counts["woman"] += len(re.findall(r"\b(?:female|woman|lady|girl|she|her|hers)\b", text))
    if counts["man"] == counts["woman"]:
        return None
    return max(counts, key=counts.get)


def stranger_words(description):
    for old, new in STRANGER_WORDS.items():
        if description.startswith(old):
            return new + description[len(old):]
    return description


def caption(stranger, stranger_side, name, name_side, description=None):
    me = f"{name}, {description}" if description else name
    return "\n".join([
        HEADER,
        f"The {stranger_side} portrait is of {stranger_words(stranger)}.",
        f"The {name_side} portrait is of {me}.",
    ])


def get_strangers(folder):
    """[(path, description, sex), ...]: the local copy when complete, else downloaded (about 21 MB)."""
    index = os.path.join(folder, "strangers.json")
    if not os.path.isfile(index):
        from huggingface_hub import snapshot_download
        print(f"Downloading the stranger set from {REPO} into {folder}")
        snapshot_download(REPO, repo_type="dataset", revision=REVISION, local_dir=folder)
    with open(index, encoding="utf-8") as f:
        rows = json.load(f)
    people = [(os.path.join(folder, r["file"]), r["description"], r.get("sex")) for r in rows]
    missing = [p for p, _d, _s in people if not os.path.isfile(p)]
    if missing:
        raise RuntimeError(f"{len(missing)} stranger image(s) missing in {folder}, delete it and run again")
    return people


class FaceFinder:
    """Largest face as (cx, cy, size), or None. Uses OpenCV's YuNet when its model file
    is there (no extra packages), else mediapipe when installed, else OpenCV's bundled
    Haar cascades keeping only faces with two eyes inside (a bare face cascade fires on
    tattoos and hands)."""

    MIN_FACE = 0.08  # of the photo's short side: smaller faces make useless portraits

    def __init__(self, yunet_model=DEFAULT_YUNET):
        self.yunet = None
        self.mp = None
        if yunet_model and os.path.isfile(yunet_model):
            self.yunet = cv2.FaceDetectorYN.create(yunet_model, "", (320, 320), score_threshold=0.8)
            print("Face detection: OpenCV YuNet")
            return
        try:
            import mediapipe as mp
            self.mp = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.7)
            print("Face detection: mediapipe")
        except Exception:
            haar = cv2.data.haarcascades
            self.face = cv2.CascadeClassifier(os.path.join(haar, "haarcascade_frontalface_default.xml"))
            self.eyes = cv2.CascadeClassifier(os.path.join(haar, "haarcascade_eye.xml"))
            print(f"Face detection: OpenCV Haar (put the YuNet model at {DEFAULT_YUNET} for better picks)")

    def find(self, im):
        arr = np.asarray(im)
        scale = min(1.0, 1280 / max(arr.shape[:2]))
        if scale < 1:
            arr = cv2.resize(arr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        h, w = arr.shape[:2]
        if self.yunet is not None:
            boxes = self._yunet(arr)
        elif self.mp is not None:
            boxes = self._mediapipe(arr)
        else:
            boxes = self._haar(arr)
        boxes = [b for b in boxes if max(b[2], b[3]) >= self.MIN_FACE * min(w, h)]
        if not boxes:
            return None
        x, y, bw, bh = max(boxes, key=lambda b: b[2] * b[3])
        return (x + bw / 2) / scale, (y + bh / 2) / scale, max(bw, bh) / scale

    def _yunet(self, arr):
        h, w = arr.shape[:2]
        self.yunet.setInputSize((w, h))
        _ok, found = self.yunet.detect(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
        return [] if found is None else [tuple(f[:4]) for f in found]

    def _mediapipe(self, arr):
        h, w = arr.shape[:2]
        found = self.mp.process(arr).detections or []
        boxes = []
        for d in found:
            b = d.location_data.relative_bounding_box
            boxes.append((b.xmin * w, b.ymin * h, b.width * w, b.height * h))
        return boxes

    def _haar(self, arr):
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        boxes = []
        for x, y, w, h in self.face.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(48, 48)):
            top_half = gray[y:y + h // 2 + h // 8, x:x + w]
            if len(self.eyes.detectMultiScale(top_half, scaleFactor=1.1, minNeighbors=5)) >= 2:
                boxes.append((x, y, w, h))
        return boxes


def portrait_square(im, face=None, size=PANEL):
    """A square around the face (about 3x the face, never smaller than the panel unless
    the photo is), else the largest centred square."""
    w, h = im.size
    if face is None:
        side, cx, cy = min(w, h), w / 2, h / 2
    else:
        cx, cy, face_size = face
        side = min(min(w, h), max(face_size * 3, size))
    left = int(min(max(cx - side / 2, 0), w - side))
    top = int(min(max(cy - side / 2, 0), h - side))
    return im.crop((left, top, left + int(side), top + int(side))).resize((size, size), Image.LANCZOS)


def load(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def pick_photos(folder, rng, faces, exclude=()):
    """PER_SUBJECT (path, face) picks: photos with a face first, no photo twice until each is used."""
    names = sorted(n for n in os.listdir(folder) if n.lower().endswith(IMAGE_EXTS) and not n.startswith(PREFIX)
                   and n not in exclude)
    if not names:
        raise ValueError(f"no photos in {folder}")
    rng.shuffle(names)
    with_face, without = [], []
    for n in names:
        if len(with_face) >= PER_SUBJECT:
            break
        path = os.path.join(folder, n)
        face = faces.find(load(path))
        (with_face if face else without).append((path, face))
    picks = with_face + without
    print(f"  {len(with_face)} photo(s) with a face found, {max(0, PER_SUBJECT - len(with_face))} without")
    return [picks[k % len(picks)] for k in range(PER_SUBJECT)]


def build(subjects, out, strangers_dir, seed, caption_ext, exclude=(), yunet_model=DEFAULT_YUNET, same_sex=False,
          sexes=None, descriptions=None):
    everyone = get_strangers(strangers_dir)
    faces = FaceFinder(yunet_model)
    os.makedirs(out, exist_ok=True)
    for n in os.listdir(out):
        if n.startswith(PREFIX):
            os.remove(os.path.join(out, n))
    sources = {}
    for index, (folder, name) in enumerate(subjects):
        print(f"{name}: {folder}")
        people = everyone
        if same_sex:
            # a stranger of the subject's own sex is the hard case: that is who a face bleeds onto
            sex = (sexes or {}).get(name) or subject_sex(folder, caption_ext)
            if sex is None:
                raise ValueError(f"{name}: can't tell man or woman from its captions, pass --sex {name}=woman (or man)")
            people = [p for p in everyone if p[2] == sex]
            print(f"  strangers: {len(people)} {sex}")
        rng = random.Random(seed * 1000 + index)
        order = list(range(len(people)))
        rng.shuffle(order)
        picks = pick_photos(folder, rng, faces, exclude)
        tag = "".join(c if c.isalnum() else "_" for c in name)
        for k in range(PER_SUBJECT):
            stranger_path, description, _sex = people[order[k % len(order)]]
            path, face = picks[k]
            subject_left = rng.random() < 0.5
            mine = portrait_square(load(path), face)
            theirs = portrait_square(load(stranger_path))
            sheet = Image.new("RGB", (2 * PANEL, PANEL))
            sheet.paste(mine if subject_left else theirs, (0, 0))
            sheet.paste(theirs if subject_left else mine, (PANEL, 0))
            me, them = ("left", "right") if subject_left else ("right", "left")
            stem = os.path.join(out, f"{PREFIX}{tag}_{k:02d}")
            sheet.save(stem + ".png")
            with open(stem + caption_ext, "w", encoding="utf-8") as f:
                f.write(caption(description, them, name, me, (descriptions or {}).get(name)))
            sources[os.path.basename(stem)] = os.path.basename(path)
        print(f"  {PER_SUBJECT} pictures -> {out}")
    # which training photo each picture used, to --exclude a bad pick and rebuild
    with open(os.path.join(out, f"{PREFIX}sources.json"), "w", encoding="utf-8") as f:
        json.dump(sources, f, indent=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--subject", nargs=2, action="append", metavar=("FOLDER", "NAME"), required=True,
                        help="a subject's training folder and how its captions name it, e.g. 'l3xi'; repeat per person")
    parser.add_argument("--out", required=True, help="folder for the side-by-side pictures and captions")
    parser.add_argument("--strangers", default=DEFAULT_STRANGERS, help="where the stranger set is kept")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--caption_ext", default=".txt")
    parser.add_argument("--exclude", action="append", default=[], metavar="FILE",
                        help="a training photo's file name to leave out (a tattoo or a print read as a face); repeatable")
    parser.add_argument("--face_model", default=DEFAULT_YUNET, help="OpenCV YuNet face model (.onnx)")
    parser.add_argument("--same_sex", action="store_true",
                        help="pair each subject only with strangers of its own sex (read from its captions)")
    parser.add_argument("--sex", action="append", default=[], metavar="NAME=man|woman",
                        help="a subject's sex for --same_sex when its captions don't say; repeatable")
    parser.add_argument("--describe", action="append", default=[], metavar="NAME=TEXT",
                        help="what follows the subject's name in its caption line, e.g. "
                             "'l3xi=a Caucasian woman in her 40s'; repeatable")
    args = parser.parse_args()
    sexes = dict(s.split("=", 1) for s in args.sex)
    descriptions = {k: v.strip() for k, v in (d.split("=", 1) for d in args.describe) if v.strip()}
    build(args.subject, args.out, args.strangers, args.seed, args.caption_ext, set(args.exclude), args.face_model,
          args.same_sex, sexes, descriptions)


if __name__ == "__main__":
    sys.exit(main())
