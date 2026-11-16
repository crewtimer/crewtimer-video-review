#!/usr/bin/env python3
"""Measure where a RIFE ONNX model actually places motion for each timestep.

RIFE v4.x does not move content linearly with the requested timestep t: it
never gets closer than ~0.05 of a frame to either input frame and it stalls
around t=0.5. The native code (RifeInterpolator::timestepForTarget) inverts a
measured table to correct for this. Rerun this script if the model changes
and paste the printed table into RIFE_MEASURED_POSITION in
native/ffreader/src/RifeInterpolator.cpp.

How it works: for each clip, take the two real frames on either side of a
scored bow crossing (from the video's .json sidecar), run RIFE at
t = 0, step, ..., 1 on the zoomed crop the app would use, and locate the boat
in each result by template matching against the hull. The measured position
is reported as a fraction of the way from frame A to frame B. A synthetic pure
translation is also run as a sanity check (it should match the real clips).

Requirements: ffmpeg on PATH; pip install numpy opencv-python onnxruntime.

Example:
  python3 native/rife/calibrate_rife.py \
      --model native/rife/rife_v4.6.onnx \
      ~/regatta/SDFC26/SDFC26_20261108_080029.mp4 \
      ~/regatta/SDFC26/SDFC26_20261108_093601.mp4 ...

Use 6-10 clips with clear, unobstructed boats at different speeds and light.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

TEMPLATE_W = 180  # hull template size in source pixels
TEMPLATE_H = 150
HULL_OFFSET = 90  # template centre offset from the finish line, behind the bow
SEARCH_X = 80
SEARCH_Y = 12
MIN_MOTION_PX = 5  # skip clips where the boat barely moves


class Rife:
    """Runs the vs-mlrt RIFE export the same way RifeInterpolator.cpp does."""

    def __init__(self, model_path):
        self.session = ort.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name

    def __call__(self, a, b, t):
        h, w = a.shape[:2]
        ph, pw = -(-h // 32) * 32, -(-w // 32) * 32

        def prep(img):
            img = img.astype(np.float32) / 255.0
            return cv2.copyMakeBorder(img, 0, ph - h, 0, pw - w, cv2.BORDER_REFLECT)

        inp = np.zeros((1, 11, ph, pw), np.float32)
        inp[0, 0:3] = prep(a).transpose(2, 0, 1)
        inp[0, 3:6] = prep(b).transpose(2, 0, 1)
        inp[0, 6] = t
        xs, ys = 2.0 / (pw - 1), 2.0 / (ph - 1)
        inp[0, 7] = np.tile(-1 + np.arange(pw) * xs, (ph, 1))
        inp[0, 8] = np.tile((-1 + np.arange(ph) * ys)[:, None], (1, pw))
        inp[0, 9] = xs
        inp[0, 10] = ys
        out = self.session.run(None, {self.input_name: inp})[0][0, :3, :h, :w]
        return (np.clip(out.transpose(1, 2, 0), 0, 1) * 255 + 0.5).astype(np.uint8)


def gray(img):
    return cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32)


def make_tracker(ref, cx, cy):
    """Returns pos(img) -> sub-pixel x offset of the template taken from ref."""
    tx = int(cx - TEMPLATE_W / 2)
    ty = int(max(SEARCH_Y, cy - TEMPLATE_H / 2))
    th = min(TEMPLATE_H, ref.shape[0] - ty - SEARCH_Y)
    sx = min(SEARCH_X, tx)
    template = gray(ref)[ty : ty + th, tx : tx + TEMPLATE_W]

    def pos(img):
        region = gray(img)[ty - SEARCH_Y : ty + th + SEARCH_Y, tx - sx : tx + TEMPLATE_W + SEARCH_X]
        res = cv2.matchTemplate(region, template, cv2.TM_CCOEFF_NORMED)
        _, score, _, (x, y) = cv2.minMaxLoc(res)
        xf = float(x)
        if 0 < x < res.shape[1] - 1:
            l, c, r = res[y, x - 1], res[y, x], res[y, x + 1]
            denom = l - 2 * c + r
            if denom != 0:
                xf += 0.5 * (l - r) / denom
        return xf - sx, score

    return pos


def read_frame(video, frame_num_1based):
    """Decodes one frame (1-based, as the app numbers them) as RGB."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
         "stream=width,height", "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, check=True,
    )
    width, height = (int(v) for v in probe.stdout.strip().split(",")[:2])
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video), "-vf",
         f"select=eq(n\\,{frame_num_1based - 1})", "-vsync", "0",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.uint8)[: width * height * 3].reshape(height, width, 3)


def sweep(rife, a, b, pos, timesteps):
    pa, _ = pos(a)
    pb, _ = pos(b)
    motion = pb - pa
    if abs(motion) < MIN_MOTION_PX:
        return None, motion
    return [(pos(rife(a, b, float(t)))[0] - pa) / motion for t in timesteps], motion


def calibrate_clip(rife, video, timesteps):
    sidecar = json.loads(Path(video).with_suffix(".json").read_text())
    stamps = list(sidecar.get("timestamps", {}).values())
    if not stamps:
        raise ValueError("no scored timestamps in sidecar")
    stamp = stamps[0]
    frame_a = int(stamp["frameNum"])
    click_y = stamp.get("recordedY") or stamp["srcClickPoint"]["y"]
    finish_x = stamp.get("srcCenterPoint", {}).get("x")
    zoom_y = stamp.get("zoomY") or 5

    full_a = read_frame(video, frame_a)
    full_b = read_frame(video, frame_a + 1)
    height, width = full_a.shape[:2]
    if finish_x is None:
        finish_x = width / 2
    crop_h = int(height / zoom_y)
    y0 = int(max(0, min(height - crop_h, click_y - crop_h / 2)))
    a, b = full_a[y0 : y0 + crop_h], full_b[y0 : y0 + crop_h]

    # The hull trails the bow; try both sides and keep the one that tracks.
    best = None
    for side in (1, -1):
        cx = finish_x + side * HULL_OFFSET
        pos = make_tracker(b, cx, click_y - y0)
        motion = pos(b)[0] - pos(a)[0]
        score = pos(a)[1]
        if best is None or abs(motion) * score > abs(best[1]) * best[2]:
            best = (pos, motion, score)
    pos = best[0]
    return sweep(rife, a, b, pos, timesteps), a, pos


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True, help="path to rife_v4.x.onnx")
    parser.add_argument("--step", type=float, default=0.02, help="timestep spacing (default 0.02)")
    parser.add_argument("--json", help="optional path to write raw measurements")
    parser.add_argument("videos", nargs="+", help="mp4 files with .json sidecars containing a scored bow")
    args = parser.parse_args()

    rife = Rife(args.model)
    timesteps = np.round(np.arange(0, 1 + 1e-9, args.step), 6)
    results = {}
    last_crop, last_pos = None, None
    for video in args.videos:
        name = Path(video).stem
        try:
            (measured, motion), crop, pos = calibrate_clip(rife, video, timesteps)
        except Exception as e:  # noqa: BLE001 - report and continue with other clips
            print(f"{name}: skipped ({e})", file=sys.stderr)
            continue
        if measured is None:
            print(f"{name}: skipped (boat moved only {motion:.1f} px)", file=sys.stderr)
            continue
        results[name] = {"motion": float(motion), "position": [float(v) for v in measured]}
        last_crop, last_pos = crop, pos
        print(f"{name}: {motion:+.1f} px/frame", file=sys.stderr)

    if not results:
        sys.exit("No usable clips.")

    measured = np.array([r["position"] for r in results.values()])
    mean = np.maximum.accumulate(measured.mean(axis=0))  # table must be increasing
    spread = measured.std(axis=0)

    # Sanity check: a pure 36 px translation of the last clip's crop.
    synth_b = cv2.warpAffine(last_crop, np.float32([[1, 0, -36], [0, 1, 0]]),
                             (last_crop.shape[1], last_crop.shape[0]), borderMode=cv2.BORDER_REFLECT)
    synth_pos = make_tracker(last_crop, last_crop.shape[1] / 2, last_crop.shape[0] / 2)
    synth, _ = sweep(rife, last_crop, synth_b, synth_pos, timesteps)

    print("\n   t   measured  spread  synthetic   error(ms@60fps)")
    for i, t in enumerate(timesteps):
        syn = f"{synth[i]:.4f}" if synth else "   -  "
        print(f"  {t:4.2f}   {mean[i]:.4f}   {spread[i]:.4f}   {syn}    {(mean[i] - t) * 1000 / 60:+.2f}")
    if np.any(np.diff(mean) <= 0):
        print("\nWARNING: measured positions are not strictly increasing; add clips.", file=sys.stderr)

    print(f"\n// {len(results)} clips, max spread {spread.max():.4f} frame")
    print(f"constexpr double RIFE_TIMESTEP_STEP = {args.step};")
    print(f"constexpr std::array<double, {len(mean)}> RIFE_MEASURED_POSITION = {{")
    rows = [", ".join(f"{v:.4f}" for v in mean[i : i + 9]) for i in range(0, len(mean), 9)]
    print("    " + ",\n    ".join(rows) + "};")

    if args.json:
        Path(args.json).write_text(json.dumps({"t": timesteps.tolist(), "results": results}, indent=1))


if __name__ == "__main__":
    main()
