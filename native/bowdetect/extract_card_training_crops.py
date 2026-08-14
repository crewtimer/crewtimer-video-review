#!/usr/bin/env python3
"""Extract normalized whole-card OCR crops from bow-card JSON sidecars.

Each crop covers the entire bow number (however many digits) and is labelled
with the full digit string, for training a CTC sequence reader. This assumes
`box` (from card-labels/*.json) already tightly bounds the whole number, and
that upstream (BowNumberPipeline / a card detector) is responsible for
finding that box at inference time -- this script only prepares reader
training data from ground truth.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

import cv2

from test_boat_card_detection import YoloBoxDetector, padded_crop

OUTPUT_HEIGHT = 48
OUTPUT_WIDTH = 60


def normalize_card(image, box):
    """Crop with source-pixel padding and apply the production OCR pipeline:
    upscale, unsharp mask, threshold, polarity-normalise, then resize to a
    fixed size. Physical bow cards do not become wider when they contain more
    digits, so card width must not leak the target string length."""
    image_h, image_w = image.shape[:2]
    x = int(box["x"])
    y = int(box["y"])
    width = int(box["width"])
    height = int(box["height"])
    pad_x = max(2, round(width * 0.15))
    pad_y = max(2, round(height * 0.15))
    x1 = max(0, x - pad_x)
    y1 = max(0, y - pad_y)
    x2 = min(image_w, x + width + pad_x)
    y2 = min(image_h, y + height + pad_y)
    crop = image[y1:y2, x1:x2]
    if crop.size == 0:
        return None

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    upscaled = cv2.resize(
        gray, None, fx=10, fy=10, interpolation=cv2.INTER_LANCZOS4
    )
    blurred = cv2.GaussianBlur(upscaled, (0, 0), 1.0)
    sharpened = cv2.addWeighted(upscaled, 2.5, blurred, -1.5, 0)
    _, thresholded = cv2.threshold(
        sharpened, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU
    )

    # The model always receives dark text/card features on a light background.
    threshold_h, threshold_w = thresholded.shape
    card_center = thresholded[
        round(threshold_h * 0.2):round(threshold_h * 0.8),
        round(threshold_w * 0.2):round(threshold_w * 0.8),
    ]
    normalized = (
        thresholded
        if card_center.mean() > 128
        else cv2.bitwise_not(thresholded)
    )
    border = max(10, round(min(normalized.shape[:2]) * 0.05))
    normalized = cv2.copyMakeBorder(
        normalized,
        border,
        border,
        border,
        border,
        cv2.BORDER_CONSTANT,
        value=255,
    )

    return cv2.resize(
        normalized,
        (OUTPUT_WIDTH, OUTPUT_HEIGHT),
        interpolation=cv2.INTER_AREA,
    )


def split_for(image_name, validation_percent):
    digest = hashlib.sha256(image_name.encode("utf-8")).digest()
    return "validation" if digest[0] < validation_percent * 256 / 100 else "train"


def detector_card_box(image, card, detector):
    boat_box = card.get("boatBox")
    if not isinstance(boat_box, dict):
        return None
    boat_xyxy = (
        int(boat_box["x"]),
        int(boat_box["y"]),
        int(boat_box["x"] + boat_box["width"]),
        int(boat_box["y"] + boat_box["height"]),
    )
    boat_crop, offset_x, offset_y = padded_crop(image, boat_xyxy)
    candidates = detector.detect(boat_crop, 0.30)
    if not candidates:
        return None
    annotation = card.get("box", {})
    center_x = float(annotation.get("x", 0)) + float(annotation.get("width", 0)) / 2
    center_y = float(annotation.get("y", 0)) + float(annotation.get("height", 0)) / 2
    selected = min(
        candidates,
        key=lambda detection: (
            ((detection.box[0] + detection.box[2]) / 2 + offset_x - center_x) ** 2
            + ((detection.box[1] + detection.box[3]) / 2 + offset_y - center_y) ** 2
        ),
    )
    x1, y1, x2, y2 = selected.box
    return {
        "x": x1 + offset_x,
        "y": y1 + offset_y,
        "width": x2 - x1,
        "height": y2 - y1,
    }


def extract_dataset(dataset_root, output_root, validation_percent, detector):
    images_dir = dataset_root / "images"
    labels_dir = dataset_root / "card-labels"
    images = {
        path.name: path
        for path in images_dir.iterdir()
        if path.suffix.lower() in {".png", ".jpg", ".jpeg"}
    }
    images_by_stem = {path.stem: path for path in images.values()}
    stats = {
        "sidecars": 0,
        "cards": 0,
        "written": 0,
        "unreadable": 0,
        "unsupported": 0,
        "missing_image": 0,
        "detector_boxes": 0,
        "annotation_boxes": 0,
    }

    for sidecar_path in sorted(labels_dir.glob("*.json")):
        stats["sidecars"] += 1
        data = json.loads(sidecar_path.read_text())
        image_path = images.get(data.get("image", ""))
        if image_path is None:
            image_path = images_by_stem.get(sidecar_path.stem)
        if image_path is None:
            stats["missing_image"] += 1
            continue

        image = cv2.imread(str(image_path))
        if image is None:
            stats["missing_image"] += 1
            continue

        split = split_for(image_path.name, validation_percent)
        cards = data.get("cards", [])
        filename_bow = re.search(r"-B(\d+)-", image_path.stem)
        for card_index, card in enumerate(cards):
            stats["cards"] += 1
            # Auto-exported sidecars include every detected card, but only the
            # finish-line boat has trusted timestamp-derived OCR ground truth.
            if card.get("verified") is False:
                stats["unreadable"] += 1
                continue
            digits = str(card.get("digits") or card.get("value") or "")
            if dataset_root.name == "dataset-hocr26" and len(cards) == 1 and filename_bow:
                digits = filename_bow.group(1)
            if not card.get("legible", bool(digits)):
                stats["unreadable"] += 1
                continue
            # Matches BowNumberReader's charset (digits only) and the range
            # of real bow numbers seen (1-3 digits, e.g. up to ~199).
            if not digits.isdigit() or not (1 <= len(digits) <= 3):
                stats["unsupported"] += 1
                continue
            box = detector_card_box(image, card, detector)
            if box is not None:
                stats["detector_boxes"] += 1
            else:
                box = card.get("box")
                stats["annotation_boxes"] += 1
            if not isinstance(box, dict):
                stats["unsupported"] += 1
                continue
            crop = normalize_card(image, box)
            if crop is None:
                stats["unsupported"] += 1
                continue
            destination = output_root / split
            destination.mkdir(parents=True, exist_ok=True)
            name = (
                f"{digits}_{dataset_root.name}_{image_path.stem}"
                f"_card{card_index:02d}.png"
            )
            cv2.imwrite(str(destination / name), crop)
            stats["written"] += 1
    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Extract normalized whole-card bow-number OCR crops"
    )
    parser.add_argument("datasets", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--validation-percent", type=int, default=20)
    parser.add_argument(
        "--card-model",
        type=Path,
        default=Path(__file__).with_name("bow_card_detect.onnx"),
        help="Card detector used to reproduce production OCR crops",
    )
    args = parser.parse_args()

    if not 0 <= args.validation_percent < 100:
        parser.error("--validation-percent must be between 0 and 99")

    detector = YoloBoxDetector(args.card_model)
    totals = {}
    for dataset in args.datasets:
        stats = extract_dataset(
            dataset, args.output, args.validation_percent, detector
        )
        totals[dataset.name] = stats
        print(f"{dataset}: {stats}")
    print(json.dumps(totals, indent=2))


if __name__ == "__main__":
    main()
