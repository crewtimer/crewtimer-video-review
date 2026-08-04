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
