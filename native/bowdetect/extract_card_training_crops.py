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

from ocr_preprocessing import OUTPUT_HEIGHT, OUTPUT_WIDTH, normalize_grayscale_card
from test_boat_card_detection import YoloBoxDetector, padded_crop

DETECTOR_MIN_ANNOTATION_IOU = 0.20
DETECTOR_ANNOTATION_MARGIN = 0.25
DETECTOR_MIN_MARGIN_PX = 2


def normalize_card(image, box):
    """Crop with source-pixel padding and apply grayscale OCR preprocessing."""
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

    return normalize_grayscale_card(crop, OUTPUT_WIDTH, OUTPUT_HEIGHT)


def split_for(image_name, validation_percent):
    digest = hashlib.sha256(image_name.encode("utf-8")).digest()
    return "validation" if digest[0] < validation_percent * 256 / 100 else "train"


def box_xyxy(box):
    """Convert an x/y/width/height mapping to floating-point corner values."""
    x = float(box["x"])
    y = float(box["y"])
    return x, y, x + float(box["width"]), y + float(box["height"])


def box_iou(first, second):
    """Return intersection-over-union for two x/y/width/height mappings."""
    ax1, ay1, ax2, ay2 = box_xyxy(first)
    bx1, by1, bx2, by2 = box_xyxy(second)
    intersection_w = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    intersection_h = max(0.0, min(ay2, by2) - max(ay1, by1))
    intersection = intersection_w * intersection_h
    union = max(0.0, (ax2 - ax1) * (ay2 - ay1)) + max(
        0.0, (bx2 - bx1) * (by2 - by1)
    ) - intersection
    return intersection / union if union > 0 else 0.0


def detector_box_matches_annotation(detected, annotation):
    """Accept a detected crop only when it agrees with the labelled card."""
    try:
        if min(
            float(detected["width"]),
            float(detected["height"]),
            float(annotation["width"]),
            float(annotation["height"]),
        ) <= 0:
            return False
        dx1, dy1, dx2, dy2 = box_xyxy(detected)
        ax1, ay1, ax2, ay2 = box_xyxy(annotation)
    except (KeyError, TypeError, ValueError):
        return False

    margin_x = max(
        DETECTOR_MIN_MARGIN_PX,
        float(annotation["width"]) * DETECTOR_ANNOTATION_MARGIN,
    )
    margin_y = max(
        DETECTOR_MIN_MARGIN_PX,
        float(annotation["height"]) * DETECTOR_ANNOTATION_MARGIN,
    )
    center_x = (dx1 + dx2) / 2
    center_y = (dy1 + dy2) / 2
    center_matches = (
        ax1 - margin_x <= center_x <= ax2 + margin_x
        and ay1 - margin_y <= center_y <= ay2 + margin_y
    )
    return center_matches and box_iou(detected, annotation) >= DETECTOR_MIN_ANNOTATION_IOU


def detector_card_box(image, card, detector):
    boat_box = card.get("boatBox")
    if not isinstance(boat_box, dict):
        return None, "no_boat_box"
    annotation = card.get("box")
    if not isinstance(annotation, dict):
        return None, "invalid_annotation"
    boat_xyxy = (
        int(boat_box["x"]),
        int(boat_box["y"]),
        int(boat_box["x"] + boat_box["width"]),
        int(boat_box["y"] + boat_box["height"]),
    )
    boat_crop, offset_x, offset_y = padded_crop(image, boat_xyxy)
    candidates = detector.detect(boat_crop, 0.30)
    if not candidates:
        return None, "no_detection"
    center_x = (
        float(annotation.get("x", 0))
        + float(annotation.get("width", 0)) / 2
    )
    center_y = (
        float(annotation.get("y", 0))
        + float(annotation.get("height", 0)) / 2
    )
    candidate_boxes = []
    for detection in candidates:
        x1, y1, x2, y2 = detection.box
        detected = {
            "x": x1 + offset_x,
            "y": y1 + offset_y,
            "width": x2 - x1,
            "height": y2 - y1,
        }
        detected_center_x = float(detected["x"]) + float(detected["width"]) / 2
        detected_center_y = float(detected["y"]) + float(detected["height"]) / 2
        distance_squared = (
            (detected_center_x - center_x) ** 2
            + (detected_center_y - center_y) ** 2
        )
        candidate_boxes.append(
            (box_iou(detected, annotation), distance_squared, detected)
        )

    _, _, selected = max(candidate_boxes, key=lambda item: (item[0], -item[1]))
    if detector_box_matches_annotation(selected, annotation):
        return selected, "accepted"
    return None, "rejected"


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
        "detector_rejected": 0,
        "detector_no_detection": 0,
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
            box, detector_status = detector_card_box(image, card, detector)
            if box is not None:
                stats["detector_boxes"] += 1
            else:
                box = card.get("box")
                stats["annotation_boxes"] += 1
                if detector_status == "rejected":
                    stats["detector_rejected"] += 1
                elif detector_status == "no_detection":
                    stats["detector_no_detection"] += 1
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
