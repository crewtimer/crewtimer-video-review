# RIFE - Real-Time Intermediate Flow Estimation

## Obtaining the RIFE ONNX model

Frame interpolation uses **RIFE v4.6** ([hzwer/Practical-RIFE](https://github.com/hzwer/Practical-RIFE),
MIT license) in ONNX form. The upstream project only publishes PyTorch
checkpoints; we use the ONNX export maintained by the
[vs-mlrt](https://github.com/AmusementClub/vs-mlrt) project, whose conversions
are widely exercised in production video pipelines and whose input convention
is documented in their source (`vsmlrt.py`).

The model is bundled inside the `models.7z` asset attached to vs-mlrt
releases (the archive is ~850 MB; the model itself is ~21 MB). To download
and extract just the RIFE model:

```sh
# Check https://github.com/AmusementClub/vs-mlrt/releases for the newest
# models.vXX.XX.7z asset; the RIFE files are identical across releases.
curl -LO https://github.com/AmusementClub/vs-mlrt/releases/download/v15.16/models.v15.16.7z
7zz e models.v15.16.7z models/rife/rife_v4.6.onnx   # brew install sevenzip
```

Place `rife_v4.6.onnx` in `<MODEL_DIR>`. Verify the file (21,255,682 bytes)
loads with the expected signature — a single `[1, 11, H, W]` float32 input:

```sh
python3 -c "import onnxruntime as ort; \
  print(ort.InferenceSession('rife_v4.6.onnx', \
  providers=['CPUExecutionProvider']).get_inputs()[0].shape)"
# expect: [1, 11, None, None]
```

Any `rife_v4.x.onnx` from the same archive is a drop-in substitute — all
v4-series exports share the 11-channel input interface. Note that this
interface (images, timestep plane, sampling grid, and flow multipliers packed
into one tensor) is specific to the vs-mlrt exports; RIFE ONNX files from
other sources use different input layouts and will not work without code
changes.

## Timestep calibration

RIFE does not move content linearly with the requested timestep `t`. Measured
on SDFC26 finish-line clips, `rife_v4.6.onnx`:

- It never gets closer than ~0.05 of a frame (~1 ms at 60 fps) to either input
  frame: `t=0` lands at 0.051 and `t=1` at 0.933.
- It stalls around `t=0.5`: the position races ahead over 0.40–0.46, then
  barely moves until ~0.56.

The curve is the same across clips (spread ~0.01 frame) and boat speeds
(10–60 px/frame), so the native code corrects it with a fixed table
(`RIFE_MEASURED_POSITION` in `native/ffreader/src/RifeInterpolator.cpp`):

- Between 0.25 and 0.75 of a frame interval, the requested `t` is mapped
  through the inverted table.
- Within 0.25 of a real frame N, where RIFE cannot reach, the native code builds
  the RIFE midpoints on either side of N (cached) and interpolates between
  them, again through the table.

Without this, stepping 1 ms at a time jumps ~2.6 ms of motion each time it
crosses a real frame. With it, steps stay within 0.5–1.4 ms.

If the model is changed, regenerate the table and paste it into
`RifeInterpolator.cpp`:

```sh
python3 native/rife/calibrate_rife.py --model native/rife/rife_v4.6.onnx \
    <6-10 .mp4 files with scored bows in their .json sidecars>
```
