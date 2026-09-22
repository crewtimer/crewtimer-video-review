#!/usr/bin/env python3
"""Detect boats, bow cards, and bow numbers in one image and annotate it."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from test_boat_card_detection import (
    BowNumberReader,
    Detection,
    NumberPrediction,
    YoloBoxDetector,
    draw_detection,
    padded_crop,
)


HERE = Path(__file__).resolve().parent.parent
FALLBACK_CARD_CONFIDENCE_THRESHOLD = 0.02
FALLBACK_OCR_CONFIDENCE_THRESHOLD = 0.8
BOAT_COLOR = (0, 255, 0)
CARD_COLOR = (255, 0, 255)


@dataclass(frozen=True)
class AnnotatedBoat:
    boat: Detection
    card: Detection | None = None
    number: NumberPrediction | None = None


def annotate_image(
    image: np.ndarray,
    boat_detector: YoloBoxDetector,
    card_detector: YoloBoxDetector,
    number_reader: BowNumberReader,
    boat_confidence: float = 0.25,
    card_confidence: float = 0.30,
) -> tuple[np.ndarray, list[AnnotatedBoat]]:
    """Run the review-app pipeline and return an annotated image and results."""
    annotated = image.copy()
    results: list[AnnotatedBoat] = []
    boats = boat_detector.detect(image, boat_confidence)
    for boat in boats:
        draw_detection(annotated, boat, BOAT_COLOR, "boat")
        boat_crop, offset_x, offset_y = padded_crop(image, boat.box)
        local_cards = card_detector.detect(boat_crop, card_confidence)
        using_fallback_card = not local_cards
        if not local_cards:
            local_cards = card_detector.detect(
                boat_crop, FALLBACK_CARD_CONFIDENCE_THRESHOLD
            )
        if not local_cards:
            results.append(AnnotatedBoat(boat=boat))
            continue

        # BowNumberPipeline selects one card per boat: the highest-confidence
        # card found inside that boat's padded crop.
        local_card = max(local_cards, key=lambda item: item.confidence)
        x1, y1, x2, y2 = local_card.box
        card = Detection(
            (x1 + offset_x, y1 + offset_y, x2 + offset_x, y2 + offset_y),
            local_card.confidence,
        )
        card_crop, _, _ = padded_crop(image, card.box)
        number = number_reader.read(card_crop)
        if using_fallback_card and number.confidence < FALLBACK_OCR_CONFIDENCE_THRESHOLD:
            results.append(AnnotatedBoat(boat=boat))
            continue
        label = number.text or "?"
        draw_detection(
            annotated,
            card,
            CARD_COLOR,
            f"bow {label} ocr={number.confidence:.2f} card",
        )
        results.append(AnnotatedBoat(boat=boat, card=card, number=number))
    return annotated, results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="Input image")
    parser.add_argument(
        "--output",
        type=Path,
        help="Output image (default: <input-stem>_annotated.png)",
    )
    parser.add_argument(
        "--boat-model",
        type=Path,
        default=HERE / "crewtimer-boat-train.onnx",
    )
    parser.add_argument(
        "--card-model", type=Path, default=HERE / "bow_card_detect.onnx"
    )
    parser.add_argument(
        "--number-model",
        type=Path,
        help="OCR model; overrides --numeric when supplied",
    )
    parser.add_argument(
        "--numeric",
        action="store_true",
        help="Use bow_crnn_numeric.onnx instead of bow_crnn.onnx",
    )
    parser.add_argument("--boat-confidence", type=float, default=0.25)
    parser.add_argument("--card-confidence", type=float, default=0.30)
    parser.add_argument(
        "--no-show",
        action="store_true",
        help="Save without opening a display window",
    )
    args = parser.parse_args()

    image_path = args.image.expanduser().resolve()
    output_path = (
        args.output.expanduser().resolve()
        if args.output
        else image_path.with_name(f"{image_path.stem}_annotated.png")
    )
    if output_path == image_path:
        parser.error("Output must differ from the input image")
    if not 0 <= args.boat_confidence <= 1:
        parser.error("--boat-confidence must be between 0 and 1")
    if not 0 <= args.card_confidence <= 1:
        parser.error("--card-confidence must be between 0 and 1")

    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        parser.error(f"Could not read image: {image_path}")
    number_model = args.number_model or (
        HERE / ("bow_crnn_numeric.onnx" if args.numeric else "bow_crnn.onnx")
    )
    try:
        boat_detector = YoloBoxDetector(args.boat_model)
        card_detector = YoloBoxDetector(args.card_model)
        number_reader = BowNumberReader(number_model)
        annotated, results = annotate_image(
            image,
            boat_detector,
            card_detector,
            number_reader,
            args.boat_confidence,
            args.card_confidence,
        )
    except RuntimeError as error:
        parser.error(str(error))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output_path), annotated):
        parser.error(f"Could not write output image: {output_path}")

    cards = [result for result in results if result.card is not None]
    numbers = [
        result.number.text or "?"
        for result in cards
        if result.number is not None
    ]
    print(
        f"Detected {len(results)} boat(s), {len(cards)} bow card(s), "
        f"bow numbers: {', '.join(numbers) if numbers else 'none'}"
    )
    print(f"Saved annotated image to {output_path}")

    if not args.no_show:
        try:
            cv2.namedWindow("Boat and bow-card detections", cv2.WINDOW_NORMAL)
            cv2.imshow("Boat and bow-card detections", annotated)
            print("Press any key in the image window to close it.")
            cv2.waitKey(0)
            cv2.destroyAllWindows()
        except cv2.error as error:
            parser.error(
                f"Could not open an image window: {error}. "
                "The annotated file was saved; use --no-show in a headless environment."
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
