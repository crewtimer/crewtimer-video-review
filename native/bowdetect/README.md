# Bow Card Decoder

Reads alphanumeric bow numbers from finish-line camera crops of racing shells
and returns the decoded text together with the pixel location of each character
so it can be highlighted in the source image.

```
Input image (58–140 px wide crop)
          │
          ▼  OpenCV preprocessing
  Upscale 10× → Unsharp mask → Binary threshold
  → Connected-component blob detection
  → Polarity auto-detect → Group overlapping blobs
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
| `train_bow_crnn.py` | Python | Trains `bow_crnn.onnx` from synthetic data |
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
pip install torch onnx onnxscript opencv-python numpy

# Synthetic data only (~5 min on CPU, good baseline)
python train_bow_crnn.py --epochs 30 --samples 5000 --output bow_crnn.onnx

# If there is an error with onnx, it may need to be force updated:
python -m pip install --upgrade --force-reinstall --no-cache-dir onnx

# Add real labelled crops for best accuracy (see "Training" section)
python train_bow_crnn.py --epochs 50 --real-data crops/ --output bow_crnn.onnx
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
    ▼  Unsharp mask  (weight=2.5, σ=1.0)
       (recovers edges lost to motion blur and JPEG compression)
    │
    ▼  Binary threshold @ 140
       (isolates bright character pixels)
    │
    ▼  Polarity auto-detection
       mean(blob region) > 128 → dark text, keep as-is
       mean(blob region) ≤ 128 → white text, invert
       → model always receives: black text on white background
```

### Stage 2 — Blob detection and grouping (OpenCV)

Connected-component analysis on the binary image, with filters to reject:

| Condition | What it rejects |
|---|---|
| `area < 200` | Salt-and-pepper noise |
| `width > min(50% of frame, 30 px orig)` | Full-width hull stripe |
| `width < 3 px orig` | Timing post (1–2 px thin vertical line) |
| `height ≤ 4 px orig` | Horizontal smear / noise |
| `aspect < 0.15` | Near-vertical timing post |
| `aspect > 2.5` | Thin horizontal stripe |

Surviving blobs are sorted left-to-right and grouped: blobs whose horizontal
gap is ≤ 1 original pixel are treated as strokes of the same character (handles
the broken middle bar of 'E' being detected as a separate fragment).

For each group the **largest blob** (by area) is used for recognition; smaller
fragments in the same group are subsumed.

### Stage 3 — Character recognition

**Python back-end:** Tesseract 5 in PSM 10 (single character mode), with a
whitelist of `A–Z 0–9`. Falls back to PSM 8 then PSM 7 if PSM 10 returns
empty.

**C++ back-end:** CRNN ONNX model.

```
Crop (variable size)
    │
    ▼  Resize to 64×32 (CRNN_W × CRNN_H)
    │
    ▼  Normalise to [0, 1] float32
    │
    ▼  NCHW tensor (1, 1, 32, 64) → bow_crnn.onnx
    │
    ▼  Output (T, 1, 37)  T = 64/4 = 16 time steps
    │
    ▼  Mean-pool over T → argmax over 37 classes
    │
    ▼  CHARSET[best_class]   ('-' A–Z 0–9, index 0 = blank/unknown)
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

The model input is a binary (0/255) image produced by the preprocessing
pipeline — not a photograph. Synthetic training samples are generated by
rendering characters and running them through the **identical pipeline**:

```
cv2.putText() → Gaussian noise → upscale 4× → unsharp mask
→ threshold → polarity-normalise → resize to 64×32
```

This closes the domain gap: the model trains on images that look exactly like
what it will see at inference time.

### Font choice

Training uses `FONT_HERSHEY_SIMPLEX` and `FONT_HERSHEY_DUPLEX` (chosen
randomly 50/50 per sample). Both are stroke-based sans-serifs that closely
match the bold block capitals printed on regatta bow cards.

Accuracy on held-out synthetic samples by font, after a 30-epoch training run:

| Font at inference | Accuracy |
|---|---|
| DUPLEX / SIMPLEX (matches training) | 94–97% |
| COMPLEX / TRIPLEX (serif) | 60–62% |
| PLAIN (thin strokes) | 20% |
| Script fonts | 6–31% |

If your venue uses an unusual font, add real labelled crops with `--real-data`
(see below).

### Polarity handling

Training randomly generates both dark-card (white text) and light-card (black
text) samples. The polarity auto-detection in the preprocessing pipeline
normalises both to black-on-white before the model sees them, so a single
model handles both card types at 94–100% accuracy.

### Training commands

```bash
# Baseline (~5 min on CPU)
python train_bow_crnn.py --epochs 30 --samples 5000 --output bow_crnn.onnx

# Better accuracy with more data (~15 min)
python train_bow_crnn.py --epochs 50 --samples 10000 --output bow_crnn.onnx

# Include real labelled crops
python train_bow_crnn.py --epochs 50 --real-data crops/ --output bow_crnn.onnx

# Verify an existing model
python train_bow_crnn.py --verify bow_crnn.onnx
```

### Labelling real crops for `--real-data`

Save each crop as `<label>_<anything>.png` in a flat directory:

```
crops/
  E1_race3_bow1_frame042.png
  3_heat2_lane3_frame017.png
  F2_final_bow4_frame091.png
```

The label is everything before the first underscore. 50–100 real crops
per label dramatically improves accuracy on your specific camera and cards.

### Model architecture

```
Input: (1, 1, 32, 64)

CNN:
  Conv2d(1→32, 3×3) + BN + ReLU + MaxPool(2×2)   →  (1, 32, 16, 32)
  Conv2d(32→64, 3×3) + BN + ReLU + MaxPool(2×2)  →  (1, 64,  8, 16)
  Conv2d(64→128, 3×3) + BN + ReLU                →  (1, 128, 8, 16)

Reshape: (1, 16, 128×8) = (1, 16, 1024)

RNN: BiGRU(1024→256, 2 layers)  →  (16, 1, 512)

FC: Linear(512→37)              →  (16, 1, 37)    [time-major]

Decode: mean-pool over 16 time steps → argmax → CHARSET index
```

Parameters: ~3.3M. Model file size: ~13 MB.
Inference time on CPU: ~2 ms median / ~3 ms p95 (single character crop).

---

## Handling multiple bow cards in one image

The decoder is designed for single-bow crops from a finish-line camera. If two
shells cross simultaneously and both bow cards appear in the same crop, the
decoder concatenates the characters left-to-right with no delimiter:

```
Two cards ("3" and "4") in one image  →  "34"
```

Detection is simple: check string length. Valid single bow numbers are 1–3
characters. Anything longer (or not in the start list after fuzzy matching)
signals an ambiguous frame. The recommended handling is to flag the frame for
manual review rather than guess.

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
├── train_bow_crnn.py       # CRNN training and ONNX export
├── bow_crnn.onnx           # Trained model (replace with fully-trained version)
└── samples/                # Optional: test images
    ├── small.png           # 140×88 — white hull, "E1"
    ├── Screenshot_…54.png  # 78×58  — grey hull, "3"
    └── Screenshot_…55.png  # 94×56  — red hull,  "4"
```
