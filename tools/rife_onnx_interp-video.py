#!/usr/bin/env python3
"""
rife_onnx_interp.py — RIFE v4 ONNX interpolation between two image files,
as a single frame or as a rendered video sweep.

Video mode:
    python3 rife_onnx_interp.py f0.png f1.png --model rife_v4.6.onnx \
        --frames 100 --fps 30 --out sweep.mp4

    --frames N renders an N-frame video spanning t = 0 .. 1 inclusive.
    Frame 0 is the original first image, frame N-1 the original second;
    the N-2 frames between are RIFE-interpolated at evenly spaced t.

Single-frame mode (no --frames):
    python3 rife_onnx_interp.py f0.png f1.png --model rife_v4.6.onnx \
        --t 0.5 --out mid.png

Model input layout (vs-mlrt rife_v4.x.onnx export), single [1, 11, H, W]:
    ch 0-2 : frame 0, RGB, 0..1
    ch 3-5 : frame 1, RGB, 0..1
    ch 6   : timestep t (constant plane, 0..1)
    ch 7   : horizontal sampling grid  2*x/(W-1) - 1
    ch 8   : vertical   sampling grid  2*y/(H-1) - 1
    ch 9   : constant 2/(W-1)
    ch 10  : constant 2/(H-1)

Model download: extract models/rife/rife_v4.6.onnx from the models.7z asset
at https://github.com/AmusementClub/vs-mlrt/releases
"""

import argparse
import sys
import time

import cv2
import numpy as np
import onnxruntime as ort

PAD_MULTIPLE = 32  # RIFE v4 pyramid needs dims divisible by 32


def build_static_planes(h: int, w: int) -> np.ndarray:
    """Precompute channels 7-10 (grid + multipliers); constant across frames."""
    xs = np.linspace(-1.0, 1.0, w, dtype=np.float32)
    ys = np.linspace(-1.0, 1.0, h, dtype=np.float32)
    return np.stack([
        np.broadcast_to(xs[None, :], (h, w)),
        np.broadcast_to(ys[:, None], (h, w)),
        np.full((h, w), 2.0 / (w - 1), dtype=np.float32),
        np.full((h, w), 2.0 / (h - 1), dtype=np.float32),
    ])


def pad_to_multiple(img: np.ndarray, mult: int) -> tuple[np.ndarray, int, int]:
    """Reflect-pad HxWx3 image so both dims are multiples of `mult`."""
    h, w = img.shape[:2]
    ph = (mult - h % mult) % mult
    pw = (mult - w % mult) % mult
    if ph or pw:
        img = cv2.copyMakeBorder(img, 0, ph, 0, pw, cv2.BORDER_REFLECT)
    return img, h, w


def load_rgb01(path: str) -> np.ndarray:
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    if bgr is None:
        sys.exit(f"error: could not read image: {path}")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0


def make_session(model_path: str) -> ort.InferenceSession:
    available = ort.get_available_providers()
    preferred = [p for p in ("CoreMLExecutionProvider", "CPUExecutionProvider")
                 if p in available]
    sess = ort.InferenceSession(model_path, providers=preferred)
    print(f"execution providers: {sess.get_providers()}")
    return sess


class Interpolator:
    """Reusable two-frame interpolator; pads once, rebuilds only the t plane."""

    def __init__(self, sess: ort.InferenceSession,
                 img0: np.ndarray, img1: np.ndarray):
        if img0.shape != img1.shape:
            sys.exit("error: input images must have identical dimensions")
        p0, self.h, self.w = pad_to_multiple(img0, PAD_MULTIPLE)
        p1, _, _ = pad_to_multiple(img1, PAD_MULTIPLE)
        ph, pw = p0.shape[:2]

        self.inp = np.empty((1, 11, ph, pw), dtype=np.float32)
        self.inp[0, 0:3] = p0.transpose(2, 0, 1)
        self.inp[0, 3:6] = p1.transpose(2, 0, 1)
        self.inp[0, 7:11] = build_static_planes(ph, pw)

        self.sess = sess
        self.input_name = sess.get_inputs()[0].name

    def at(self, t: float) -> np.ndarray:
        """Interpolated frame at time t, HxWx3 RGB float 0..1."""
        self.inp[0, 6] = t
        out = self.sess.run(None, {self.input_name: self.inp})[0]
        return np.clip(out[0].transpose(1, 2, 0)[:self.h, :self.w], 0.0, 1.0)


def to_bgr8(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor((img * 255.0 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR)


def open_writer(path: str, fps: float, w: int, h: int) -> cv2.VideoWriter:
    # 'mp4v' is universally available; on macOS 'avc1' gives H.264 via
    # VideoToolbox and better player compatibility -- try it first there.
    for fourcc in ("avc1", "mp4v"):
        wr = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*fourcc), fps, (w, h))
        if wr.isOpened():
            print(f"video codec: {fourcc}")
            return wr
    sys.exit(f"error: could not open video writer for {path}")


def main() -> None:
    ap = argparse.ArgumentParser(description="RIFE v4 ONNX two-frame interpolation")
    ap.add_argument("frame0")
    ap.add_argument("frame1")
    ap.add_argument("--model", default="rife_v4.6.onnx")
    ap.add_argument("--frames", type=int, default=None,
                    help="render an N-frame video sweeping t from 0 to 1 "
                         "(endpoints are the original images)")
    ap.add_argument("--fps", type=float, default=30.0,
                    help="frame rate of the output video (default 30)")
    ap.add_argument("--t", type=float, default=0.5,
                    help="single-frame mode: timestep in (0,1); default 0.5")
    ap.add_argument("--out", default=None,
                    help="output path (default: sweep.mp4 or interpolated.png)")
    ap.add_argument("--crop", type=int, nargs=4, metavar=("X", "Y", "W", "H"),
                    help="optional crop applied to both frames before "
                         "interpolation (e.g. bow region)")
    args = ap.parse_args()

    img0 = load_rgb01(args.frame0)
    img1 = load_rgb01(args.frame1)

    if args.crop:
        x, y, cw, ch = args.crop
        img0 = img0[y:y + ch, x:x + cw]
        img1 = img1[y:y + ch, x:x + cw]
        print(f"cropped to {img0.shape[1]}x{img0.shape[0]} at ({x},{y})")

    sess = make_session(args.model)
    interp = Interpolator(sess, img0, img1)
    interp.at(0.5)  # warm-up (first CoreML call compiles the graph)

    if args.frames is not None:
        n = args.frames
        if n < 2:
            sys.exit("error: --frames must be at least 2")
        out_path = args.out or "sweep.mp4"
        h, w = img0.shape[:2]
        writer = open_writer(out_path, args.fps, w, h)

        t_start = time.perf_counter()
        for i in range(n):
            t = i / (n - 1)
            if i == 0:
                frame = img0            # exact originals at the endpoints
            elif i == n - 1:
                frame = img1
            else:
                frame = interp.at(t)
            writer.write(to_bgr8(frame))
            if i % 10 == 0 or i == n - 1:
                el = time.perf_counter() - t_start
                print(f"\rframe {i + 1}/{n}  ({el:.1f}s elapsed)",
                      end="", flush=True)
        print()
        writer.release()
        dt = time.perf_counter() - t_start
        print(f"wrote {out_path}: {n} frames @ {args.fps:g} fps "
              f"({dt:.1f}s, {dt / max(n - 2, 1) * 1000:.0f} ms/interpolated frame)")
    else:
        if not 0.0 < args.t < 1.0:
            sys.exit("error: --t must be strictly between 0 and 1")
        out_path = args.out or "interpolated.png"
        frame = interp.at(args.t)
        if not cv2.imwrite(out_path, to_bgr8(frame)):
            sys.exit(f"error: could not write {out_path}")
        print(f"wrote {out_path}  (t={args.t})")


if __name__ == "__main__":
    main()
