#!/usr/bin/env python3
"""Extract normalized OCR crops from bow-card JSON sidecars."""

import argparse
import hashlib
import json
from pathlib import Path

import cv2

OUTPUT_WIDTH = 64
OUTPUT_HEIGHT = 32


def normalize_card(image, box):
    """Crop with source-pixel padding and apply the production OCR pipeline."""
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
        sharpened, 140, 255, cv2.THRESH_BINARY
    )

    # The model always receives dark text/card features on a light background.
    normalized = (
        thresholded
        if thresholded.mean() > 128
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


def extract_dataset(dataset_root, output_root, validation_percent):
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
        for card_index, card in enumerate(data.get("cards", [])):
            stats["cards"] += 1
            digits = str(card.get("digits") or card.get("value") or "")
            if not card.get("legible", bool(digits)):
                stats["unreadable"] += 1
                continue
            if len(digits) != 1 or not digits.isdigit():
                stats["unsupported"] += 1
                continue
            box = card.get("box")
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
        description="Extract normalized single-digit bow-card OCR crops"
    )
    parser.add_argument("datasets", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--validation-percent", type=int, default=20)
    args = parser.parse_args()

    if not 0 <= args.validation_percent < 100:
        parser.error("--validation-percent must be between 0 and 99")

    totals = {}
    for dataset in args.datasets:
        stats = extract_dataset(
            dataset, args.output, args.validation_percent
        )
        totals[dataset.name] = stats
        print(f"{dataset}: {stats}")
    print(json.dumps(totals, indent=2))


if __name__ == "__main__":
    main()
