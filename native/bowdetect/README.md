# Bow Card Decoder

Reads alphanumeric bow numbers from finish-line camera crops of racing shells
and returns the decoded text together with the pixel location of each character
so it can be highlighted in the source image.

```
Input image (58–140 px wide crop)
          │
          ▼  OpenCV preprocessing
  Upscale 10× → CLAHE local contrast → Mild sharpen
  → Polarity auto-detect → Resize to fixed 60×48
          │
          ▼  ONNX Runtime
  bow_crnn.onnx  (CRNN: CNN → BiGRU → mean-pool → argmax)
          │
          ▼
  BowCardResult { text="E1", bbox, charBoxes[] }
```

Tested on finish-line camera crops from multiple hull colours (white, grey, red)
and both bow card polarities (dark card / white text, light card / black text).

---

## Files

| File | Language | Purpose |
|---|---|---|
| `decode_bow_card.py` | Python | Reference implementation (Tesseract back-end) |
| `bow_card_decoder.h` | C++ | Production implementation (ONNX back-end, single header) |
| `bow_card_demo.cpp` | C++ | CLI demo for `bow_card_decoder.h` |
| `CMakeLists.txt` | CMake | Build script for the C++ demo |
| `scripts/train_bow_crnn.py` | Python | Trains `bow_crnn.onnx` from synthetic data |
| `bow_crnn.onnx` | ONNX | Trained CRNN model (replace with a fully trained version) |

---

## Quick start

### Python (Tesseract back-end — no training required)

```bash
pip install opencv-python pytesseract numpy
# Ubuntu: sudo apt install tesseract-ocr

python decode_bow_card.py image.png
python decode_bow_card.py image.png --annotate          # saves image_annotated.png
python decode_bow_card.py image.png --roi 5 42 14 52    # y0 y1 x0 x1
python decode_bow_card.py image.png --start-list E1 E2 F1 3 4
python decode_bow_card.py --test                        # self-test on sample images
```

#### Python API

```python
from decode_bow_card import decode_bow_card, annotate_image, validate_against_start_list

text, bbox, char_boxes = decode_bow_card("image.png")
# text      → "E1"
# bbox      → (x=25, y=14, w=24, h=27)  — original image pixels
# char_boxes → [BowCharBox('E', x=25, y=15, w=8, h=25),
#               BowCharBox('1', x=35, y=14, w=14, h=27)]

# Optional: fuzzy-match against known start list
corrected = validate_against_start_list(text, ["E1","E2","F1","F2"])

# Draw bounding boxes (6× upscale for visibility on tiny crops)
annotate_image("image.png", text, bbox, char_boxes,
               output_path="annotated.png", upscale=6)
```

### C++ (ONNX back-end)

#### 1. Train the model

```bash
pip install torch onnx onnxscript opencv-python numpy pillow

# Synthetic data only (~5 min on CPU, good baseline)
python scripts/train_bow_crnn.py --epochs 30 --samples 5000 --output bow_crnn.onnx

# If there is an error with onnx, it may need to be force updated:
python -m pip install --upgrade --force-reinstall --no-cache-dir onnx

# Add real labelled crops for best accuracy (see "Training" section)
python scripts/train_bow_crnn.py --epochs 50 --real-data crops/ --output bow_crnn.onnx
```

#### 2. Build

```bash
mkdir build && cd build

# Point CMake at your ONNX Runtime installation
cmake .. -DONNXRUNTIME_ROOT=/path/to/onnxruntime-linux-x64-1.x.x
cmake --build .
```

Single-command build without CMake:

```bash
g++ -std=c++17 -O2 bow_card_demo.cpp -o bow_card_demo \
    $(pkg-config --cflags --libs opencv4)              \
    -I/path/to/onnxruntime/include                     \
    -L/path/to/onnxruntime/lib -lonnxruntime
```

#### 3. Run

```bash
./bow_card_demo bow_crnn.onnx image.png
./bow_card_demo bow_crnn.onnx image.png --annotate
./bow_card_demo bow_crnn.onnx image.png --roi 5 42 14 52
./bow_card_demo bow_crnn.onnx image.png --start-list E1 E2 F1 F2 3 4
```

#### C++ API

```cpp
#include "bow_card_decoder.h"

// Initialise once (loads the ONNX model)
BowCardDecoder decoder("bow_crnn.onnx");

// Decode a crop (auto-detects bow card region)
cv::Mat frame = cv::imread("crop.png");
BowCardResult result = decoder.decode(frame);

std::cout << result.text << "\n";          // "E1"
std::cout << result.bbox << "\n";          // [25×14 24×27]
for (auto& cb : result.charBoxes)
    std::cout << cb.ch << " @ " << cb.box << "\n";

// Optional: fuzzy match against start list
std::string corrected = BowCardDecoder::matchStartList(
    result.text, {"E1","E2","F1","F2"});

// Draw bounding boxes (upscale=6 for display)
cv::Mat display;
cv::resize(frame, display, cv::Size(), 6, 6, cv::INTER_NEAREST);
BowCardDecoder::annotate(display, result.text, result.bbox,
                          result.charBoxes, /*upscale=*/6);
cv::imwrite("annotated.png", display);
```

---

## Pipeline detail

### Stage 1 — Preprocessing (OpenCV)

All preprocessing is identical between the Python reference and the C++
implementation.

```
Gray conversion
    │
    ▼  top 65% crop (hull/waterline never contains the bow card)
       — or explicit ROI if provided
    │
    ▼  Lanczos 10× upscale
       (source images are 58–140 px wide; Tesseract and CRNN both need ≥30 px
        cap-height to work reliably)
    │
    ▼  CLAHE local contrast enhancement (clip=2.0, grid=4×4)
       (separates digits from white, gray, or uneven card backgrounds)
    │
    ▼  Mild unsharp mask (weight=1.6, σ=1.0)
       (recovers edges without discarding grayscale stroke information)
    │
    ▼  Polarity auto-detection
       mean(central card region) > 128 → dark text, keep as-is
       mean(central card region) ≤ 128 → white text, invert
       → model receives: dark text/features on a light grayscale background
```

### Stage 2 — Whole-card sequence recognition

The card detector supplies one crop containing the complete bow number. The
CRNN reads 1–3 digits with an optional single A–Z prefix in one pass; there is
no per-character segmentation or Tesseract stage.

```
Detected card crop
    │
    ▼  Resize to fixed 60×48 (physical card size does not vary by digit count)
    │
    ▼  Normalise to [0, 1] float32
    │
    ▼  NCHW tensor (1, 1, 48, 60) → bow_crnn.onnx
    │
    ▼  Output (T, 1, 37)  T = 60/4 = 15 time steps
    │
    ▼  Greedy CTC decode (collapse repeats and remove blank)
```

### Stage 4 — Post-processing

Bounding-box coordinates are mapped back to original image pixels by undoing
the 10× upscale and the ROI offset. The overall bounding box is the union of
all per-character boxes.

An optional start-list fuzzy match (Levenshtein distance) corrects common OCR
confusions such as `0`/`O` and `1`/`I` when the set of valid bow numbers is
known in advance from the race draw.

---

## Training the CRNN model

### Why synthetic data works

The model input is a contrast-normalized grayscale image. Synthetic training
samples use variable light, gray, and dark card backgrounds and run through
the same pipeline:

```
Roboto Condensed Bold via Pillow → illumination gradient and noise → upscale 10×
→ CLAHE → mild sharpen → polarity-normalise → resize to 60×48
```

This closes the domain gap: the model trains on images that look exactly like
what it will see at inference time.

### Font choice

Training uses the vendored `RobotoCondensed-Bold.ttf` for every synthetic
label. Pillow renders the TrueType outlines before the normal image degradation
and production preprocessing are applied.

If your venue uses an unusual font, add real labelled crops with `--real-data`
(see below).

### Polarity handling

Training randomly generates numeric and A–Z-prefixed labels on both dark cards
(white text) and light cards (black text). The polarity auto-detection in the
preprocessing pipeline normalises both to black-on-white before the model sees
them. Synthetic prefix letters use the same font scale, stroke thickness,
and baseline as the numeric characters in both training and validation.
`--alpha-prefix-fraction` controls how much of the synthetic training mix
contains a prefix; the combined Makefile and Colab workflows use `0.80` with a
60/40 real-to-synthetic sample mix. Checkpoint selection gives equal weight to
held-out real-crop accuracy and a fixed validation set spanning every prefix.
When real alpha-prefixed crops are available, `--real-alpha-fraction` prevents
them from being diluted by the much larger numeric crop collection. The
combined workflow uses `0.10`, yielding an overall training mix of roughly 62%
numeric and 38% alpha-prefixed labels while production validation remains
dominated by real numeric crops.

### Training commands

```bash
# Baseline (~5 min on CPU)
python scripts/train_bow_crnn.py --epochs 30 --samples 5000 --output bow_crnn.onnx

# Better accuracy with more data (~15 min)
python scripts/train_bow_crnn.py --epochs 50 --samples 10000 --output bow_crnn.onnx

# Include real labelled crops
python scripts/train_bow_crnn.py --epochs 50 --real-data crops/ --output bow_crnn.onnx

# Verify an existing model
python scripts/train_bow_crnn.py --verify bow_crnn.onnx

# Train and verify an 11-class numeric-only model
python scripts/train_bow_crnn.py --vocabulary numeric --output bow_crnn_numeric.onnx
python scripts/train_bow_crnn.py --vocabulary numeric --verify bow_crnn_numeric.onnx
```

`make ocr` trains both variants. `bow_crnn.onnx` retains the 37-class
alphanumeric vocabulary; `bow_crnn_numeric.onnx` uses 11 classes and strips a
leading A-Z prefix from real crop labels during training and validation. The
native decoder selects the correct vocabulary from the ONNX output width. The
review app's bow-detection request selects the numeric model with
`numericOnly: true`; omitted or false continues to use the alphanumeric model.

### Train both card detection and OCR in Google Colab

To use numeric-only OCR labels for a dataset, add a `config.json` beside its
`images/` and `card-labels/` directories:

```json
{"ignoreAlpha": true}
```

OCR crop extraction removes leading letters from that dataset's labels (for
example, `E043` becomes `043`) in both training and validation. Evaluation uses
the same numeric ground truth. Source sidecars and images are unchanged. Omit
the property or set it to `false` to retain prefixes. Regenerate the OCR crops
and training ZIP after changing this setting.

Generate both local datasets and package their exact train/validation splits:

```bash
make colab-all-zip
```

This creates `build/bow-training-colab.zip` containing the YOLO card-detector
dataset, the whole-card OCR crops, and the OCR training utility. Open
`train_bow_models_colab.ipynb` in a GPU-enabled Colab runtime, run all cells,
and copy the ZIP to Google Drive at
`MyDrive/yolo_training/data/bow-training-colab.zip`. The notebook mounts Drive
and loads the archive from that location.

The notebook trains and validates the card detector and both OCR variants. It
exports `bow_card_detect.onnx`, `bow_crnn.onnx`, and
`bow_crnn_numeric.onnx`, verifies the tensor shapes expected by the C++ runtime,
and downloads `bow-model-training-results.zip` with the ONNX files, PyTorch
checkpoints, metrics, and card-detector training log. It also copies those
artifacts to a Pacific-time-stamped Drive folder such as
`MyDrive/yolo_training/bowtrain-2026-0814_1701`. Its `ocr-failures/index.html`
report shows every failed held-out crop enlarged with the expected number,
prediction, confidence, source filename, and original crop.

Card-detector dataset generation also includes labeled boat crops that have no
associated card annotation as hard negatives. These retain real hull, glare,
logo, and timing-line context while using an empty YOLO label file. Any
negative crop touching an annotated card is rejected.

Known-negative full frames can be prepared with:

```bash
python scripts/create_negative_labels.py /path/to/dataset-negatives
```

This creates empty `labels/*.txt` files and `card-labels/*.json` sidecars with
`cards: []`. Card-detector dataset generation recognizes that combination and
includes the complete image as an empty-label full-frame negative.

### Labelling real crops for `--real-data`

Save each crop as `<label>_<anything>.png` in a flat directory:

```
crops/
  E1_race3_bow1_frame042.png
  3_heat2_lane3_frame017.png
  F2_final_bow4_frame091.png
```

The label is everything before the first underscore. It must contain 1–3
digits with at most one A–Z prefix. Lowercase sidecar and filename labels are
normalized to uppercase. 50–100 real crops per label dramatically improves
accuracy on your specific camera and cards.

### Model architecture

```
Input: (1, 1, 48, 60)

CNN:
  Conv2d(1→32, 3×3) + BN + ReLU + MaxPool(2×2)
  Conv2d(32→64, 3×3) + BN + ReLU + MaxPool(2×2)
  Conv2d(64→128, 3×3) + BN + ReLU

Reshape spatial columns into a 15-step sequence

RNN: two-layer bidirectional GRU (hidden size 256)

FC: Linear(512→37 or 11)        →  (15, 1, C)     [time-major]

Decode: greedy CTC over digits 0–9, optionally letters A–Z, plus the blank class.
Class 0 is the required CTC blank; hyphen and space are not model characters.
```

Synthetic labels are rendered with the vendored Roboto Condensed Bold TrueType
font through Pillow. Font size, position, contrast, lighting, blur, morphology,
and compression artifacts vary between samples. The combined Colab archive
includes the same font and its Apache 2.0 license.

Parameters: ~4.0M. Model file size: ~16 MB.
Inference time on CPU: ~2 ms median / ~3 ms p95 (single character crop).

---

## Handling multiple bow cards in one image

The decoder is designed for single-bow crops from a finish-line camera. If two
shells cross simultaneously and both bow cards appear in the same crop, the
decoder concatenates the characters left-to-right with no delimiter:

```
Two cards ("3" and "4") in one image  →  "34"
```

Detection is simple: check the label format. Valid single bow numbers contain
1–3 digits and may have one A–Z prefix. Anything else (or anything not in the
start list after fuzzy matching) signals an ambiguous frame. The recommended
handling is to flag the frame for manual review rather than guess.

---

## Known limitations and edge cases

**Low resolution.** Source crops are typically 58–140 px wide. The 10× upscale
and unsharp mask recover most legible characters, but severe motion blur (bow
passing at speed) can render individual characters unrecognisable even to a
human. The start-list fuzzy match helps recover from partial reads.

**Timing post occlusion.** The white vertical timing post at the finish line
is filtered out by the `aspect < 0.15` blob filter. Partial occlusion of a
character by the post may split that character's blob, but the grouping step
will merge them if the gap is ≤ 1 original pixel. Larger occlusions require
manual review.

**Non-standard fonts.** Serif, script, or handwritten bow cards will degrade
accuracy significantly (see font table above). Add 50–100 real labelled crops
via `--real-data` to adapt the model to your specific cards.

**`0` vs `O` and `1` vs `I`.** These are the most common single-character
confusions after binarisation (both pairs look nearly identical at low
resolution). The start-list fuzzy match resolves them whenever the race draw
is available.

---

## Dependencies

### Python reference implementation

| Package | Version tested | Purpose |
|---|---|---|
| opencv-python | 4.13 | Preprocessing, annotation |
| pytesseract | 0.3.13 | Character recognition |
| numpy | 2.4 | Array operations |
| Tesseract (binary) | 5.3.4 | OCR engine |

### C++ implementation

| Library | Version tested | Purpose |
|---|---|---|
| OpenCV | 4.13 | Preprocessing, annotation, connected components |
| ONNX Runtime | 1.24 | CRNN inference |

### Training script

| Package | Purpose |
|---|---|
| torch | Model training |
| onnx, onnxscript | ONNX export |
| opencv-python | Synthetic sample generation |
| numpy | Array operations |
| onnxruntime | Post-export verification |

---

## Repository layout

```
bow-card-decoder/
├── README.md
├── decode_bow_card.py      # Python reference — drop-in, no training needed
├── bow_card_decoder.h      # C++ single-header implementation
├── bow_card_demo.cpp       # C++ CLI demo
├── CMakeLists.txt          # CMake build
├── scripts/
│   ├── train_bow_crnn.py   # CRNN training and ONNX export
│   └── ...                 # Dataset, evaluation, and command-line utilities
├── test/                    # Python unit and regression tests
├── bow_crnn.onnx           # Trained model (replace with fully-trained version)
└── samples/                # Optional: test images
    ├── small.png           # 140×88 — white hull, "E1"
    ├── Screenshot_…54.png  # 78×58  — grey hull, "3"
    └── Screenshot_…55.png  # 94×56  — red hull,  "4"
```

## Production detection pipeline

`BowNumberPipeline::detectAll` processes each frame in this order:

1. Run the boat detector on the full frame.
2. For each boat, expand its box by 15% (with at least four pixels of padding)
   and run the card detector on that crop.
3. If one or more cards are found, select the highest-confidence card, map its
   box back to full-frame coordinates, pad it by 15%, and run OCR once on that
   card crop.
4. If no card is found at the normal 0.30 confidence threshold, rerun the card
   detector at 0.02 and select its highest-confidence candidate.
5. OCR the padded fallback card crop. Accept the fallback card and bow number
   only when OCR confidence is at least 0.80; otherwise return only the boat.
6. Return one result per boat. Accepted normal and fallback card results contain
   `boatBox`, `cardBox`, recognized text, and OCR confidence.

When no boats are detected and `detectCardsWithoutBoat` is enabled, the pipeline
instead runs the card detector over the full frame and OCRs every detected padded
card. With the option disabled, no detections are returned. The single-result
`detect` method runs this same sequence and then selects the result whose boat
box (or card box for card-only detection) is closest to the supplied point of
interest.

## Validate the holdout dataset

Run from `native/bowdetect`:

```sh
make validate-holdout
# Optional overrides:
make validate-holdout HOLDOUT_DATASET=/path/to/dataset HOLDOUT_OUTPUT=build/my-report HOLDOUT_IOU=0.5
# Regattas whose cards display only the final digit:
make validate-holdout HOLDOUT_LAST_DIGIT_ONLY=1
```

The default dataset is `~/training/datasets/dataset-holdout`. This target evaluates
all images without training or changing models, using the current
`crewtimer-boat-train.onnx`, `bow_card_detect.onnx`, `bow_crnn.onnx`, and
`bow_crnn_numeric.onnx` files. Both OCR models run through the complete native
pipeline; the report presents their detection and exact-text results separately.
The validator checks that the alphanumeric and numeric outputs have 37 and 11
classes respectively, so swapped or incorrectly trained models fail clearly.
It builds a small adapter that directly calls the review app's
`BowNumberPipeline::detectAll`, including the low-confidence card fallback
documented above. It uses the app's default thresholds and ONNX execution providers, with
card-only detection disabled.
Images are evaluated in full, without the UI's optional region selection or
video interpolation.

Requirements: Python with OpenCV (`cv2`), a C++17 compiler, and the native OpenCV
and ONNX Runtime libraries built for `native/ffreader`. The Makefile defaults to
the repository's macOS library layout. For other installations, override
`HOLDOUT_CPPFLAGS` and `HOLDOUT_LDLIBS` with the appropriate include/link flags.

Outputs are `build/holdout-validation/report.md` (summary and bow-number errors)
and `report.json` (model SHA-256 hashes, configuration, per-image predictions,
annotations, timings, and scores). Boat truth comes from YOLO `labels/*.txt`;
card boxes and legible bow numbers come from `card-labels/*.json`. Missing
annotations are explicitly excluded per stage, whereas empty annotations are
negatives. Detection precision/recall uses one-to-one descending-IoU matching
at 0.5 by default, not mAP. Bow-number accuracy uses exact text on spatially
matched cards, with both end-to-end and matched-card denominators. End-to-end
accuracy counts upstream detection misses as failures. Numeric-model scoring
removes an optional leading A-Z prefix from ground truth. Invalid/unreadable data
fails the run instead of silently skipping images. Sidecars are matched by filename
stem; stale embedded image names are reported. Card annotations whose dimensions
differ from the actual image are reported and excluded from card/OCR scoring,
while inference and boat scoring still run. Zero denominators report N/A.
With `HOLDOUT_LAST_DIGIT_ONLY=1` (or the script's `--last-digit-only`), expected
OCR labels and model predictions are compared by their final digit. The report
retains the full raw prediction when it lists a mismatch.

Both `holdout` and `dataset-holdout` (and `HOLDOUT_DATASET`) are excluded from the
Makefile's training dataset list. This does not establish whether existing model
weights were previously trained on these images.

## Annotate a single image

From the repository root, detect boats, bow cards, and bow numbers, save a new
annotated PNG beside the input, and open it in a window:

```sh
python3 native/bowdetect/scripts/annotate_bow_detection.py /path/to/image.jpg
```

Use `--output /path/to/result.png` to choose the output location,
`--numeric` for `bow_crnn_numeric.onnx`, or `--no-show` when running without a
desktop display. The script uses the review app's default confidence thresholds
and its highest-confidence-card-per-boat behavior.
