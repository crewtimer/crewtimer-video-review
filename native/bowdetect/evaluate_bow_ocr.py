#!/usr/bin/env python3
"""Evaluate bow OCR from annotated and detector-generated card crops."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import cv2

from test_boat_card_detection import (
    BowNumberReader,
    Detection,
    YoloBoxDetector,
    intersection_over_union,
    padded_crop,
)


def box_from_json(value: dict[str, float]) -> tuple[int, int, int, int]:
    x, y = round(value["x"]), round(value["y"])
    return x, y, x + round(value["width"]), y + round(value["height"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("number_model", type=Path)
    parser.add_argument("--card-model", type=Path)
    parser.add_argument("--card-confidence", type=float, default=0.30)
    args = parser.parse_args()

    reader = BowNumberReader(args.number_model)
    detector = YoloBoxDetector(args.card_model) if args.card_model else None
    counts: Counter[str] = Counter()
    errors: Counter[tuple[str, str]] = Counter()

    for sidecar_path in sorted((args.dataset / "card-labels").glob("*.json")):
        sidecar = json.loads(sidecar_path.read_text())
        image = cv2.imread(str(args.dataset / "images" / sidecar["image"]))
        if image is None:
            continue
        for card in sidecar.get("cards", []):
            expected = str(card.get("digits", card.get("value", ""))).strip()
            if not card.get("legible", bool(expected)) or not expected.isdigit():
                continue
            counts["total"] += 1
            counts[f"length_{len(expected)}_total"] += 1
            gt_box = box_from_json(card["box"])
            crop, _, _ = padded_crop(image, gt_box)
            mode = "annotated"
            if detector:
                boat_crop, offset_x, offset_y = padded_crop(image, box_from_json(card["boatBox"]))
                candidates = detector.detect(boat_crop, args.card_confidence)
                candidates = [
                    Detection(
                        (x1 + offset_x, y1 + offset_y, x2 + offset_x, y2 + offset_y),
                        candidate.confidence,
                    )
                    for candidate in candidates
                    for x1, y1, x2, y2 in [candidate.box]
                ]
                if not candidates:
                    counts["detector_miss"] += 1
                    continue
                detected = max(candidates, key=lambda item: intersection_over_union(item, Detection(gt_box, 1)))
                crop = image[detected.box[1] : detected.box[3], detected.box[0] : detected.box[2]]
                mode = "detected"
            prediction = reader.read(crop).text
            if prediction == expected:
                counts["correct"] += 1
                counts[f"length_{len(expected)}_correct"] += 1
            else:
                errors[(expected, prediction)] += 1

    print(f"Mode: {mode}")
    print(f"Correct: {counts['correct']}/{counts['total']} ({100 * counts['correct'] / counts['total']:.2f}%)")
    if detector:
        print(f"Card detector misses: {counts['detector_miss']}")
    for length in range(1, 4):
        total = counts[f"length_{length}_total"]
        if total:
            correct = counts[f"length_{length}_correct"]
            print(f"{length} digit: {correct}/{total} ({100 * correct / total:.1f}%)")
    print("Most common errors:")
    for (expected, prediction), count in errors.most_common(20):
        print(f"  {expected!r} -> {prediction!r}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
