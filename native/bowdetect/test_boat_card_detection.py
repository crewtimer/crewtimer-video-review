#!/usr/bin/env python3
"""Visual smoke test for the boat -> bow-card detection pipeline.

The first output image contains every detected boat.  The second contains the
same boat boxes plus bow-card detections made within each padded boat crop.
"""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from ocr_preprocessing import normalize_grayscale_card

HERE = Path(__file__).resolve().parent
MODEL_SIZE = 640
PAD_VALUE = 114
BOAT_PAD_FRACTION = 0.15
MIN_PAD_PIXELS = 4
NUMBER_CHARSET = "-0123456789"


@dataclass(frozen=True)
class Detection:
    box: tuple[int, int, int, int]
    confidence: float


@dataclass(frozen=True)
class NumberPrediction:
    text: str
    confidence: float


def letterbox(image: np.ndarray) -> tuple[np.ndarray, float, int, int]:
    """Match the 640x640 preprocessing used by YoloBoxDetector.cpp."""
    height, width = image.shape[:2]
    scale = min(MODEL_SIZE / width, MODEL_SIZE / height)
    resized_width = max(1, round(width * scale))
    resized_height = max(1, round(height * scale))
    pad_x = (MODEL_SIZE - resized_width) // 2
    pad_y = (MODEL_SIZE - resized_height) // 2

    resized = cv2.resize(image, (resized_width, resized_height))
    padded = np.full((MODEL_SIZE, MODEL_SIZE, 3), PAD_VALUE, dtype=np.uint8)
    padded[pad_y : pad_y + resized_height, pad_x : pad_x + resized_width] = resized
    tensor = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return np.transpose(tensor, (2, 0, 1))[None], scale, pad_x, pad_y


def intersection_over_union(a: Detection, b: Detection) -> float:
    ax1, ay1, ax2, ay2 = a.box
    bx1, by1, bx2, by2 = b.box
    intersection = max(0, min(ax2, bx2) - max(ax1, bx1)) * max(
        0, min(ay2, by2) - max(ay1, by1)
    )
    if not intersection:
        return 0.0
    return intersection / (
        (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - intersection
    )


def non_maximum_suppression(
    detections: list[Detection], iou_threshold: float
) -> list[Detection]:
    kept: list[Detection] = []
    for candidate in sorted(detections, key=lambda item: item.confidence, reverse=True):
        if all(intersection_over_union(candidate, other) <= iou_threshold for other in kept):
            kept.append(candidate)
    return kept


class YoloBoxDetector:
    """ONNX implementation equivalent to the native single-class detector."""

    def __init__(self, model_path: Path):
        try:
            self.session = ort.InferenceSession(
                str(model_path), providers=["CPUExecutionProvider"]
            )
        except Exception as error:
            raise RuntimeError(f"Could not load ONNX model {model_path}: {error}") from error
        self.input_name = self.session.get_inputs()[0].name

    def detect(
        self,
        image: np.ndarray,
        confidence_threshold: float,
        iou_threshold: float = 0.45,
    ) -> list[Detection]:
        tensor, scale, pad_x, pad_y = letterbox(image)
        output = self.session.run(None, {self.input_name: tensor})[0]
        if output.ndim != 3 or output.shape[0] != 1 or output.shape[1] < 5:
            raise RuntimeError(f"Unexpected YOLO output shape: {output.shape}")

        image_height, image_width = image.shape[:2]
        detections: list[Detection] = []
        # Pose exports append keypoint channels after the five detection
        # channels; box-only inference deliberately ignores those values.
        for cx, cy, width, height, confidence in output[0, :5].T:
            confidence = float(confidence)
            if confidence < confidence_threshold:
                continue
            x1 = round((float(cx) - float(width) / 2 - pad_x) / scale)
            y1 = round((float(cy) - float(height) / 2 - pad_y) / scale)
            x2 = round((float(cx) + float(width) / 2 - pad_x) / scale)
            y2 = round((float(cy) + float(height) / 2 - pad_y) / scale)
            box = (
                max(0, min(x1, image_width)),
                max(0, min(y1, image_height)),
                max(0, min(x2, image_width)),
                max(0, min(y2, image_height)),
            )
            if box[2] > box[0] and box[3] > box[1]:
                detections.append(Detection(box, confidence))
        return non_maximum_suppression(detections, iou_threshold)


class BowNumberReader:
    """CTC bow-number reader equivalent to BowNumberReader.cpp."""

    def __init__(self, model_path: Path):
        try:
            self.session = ort.InferenceSession(
                str(model_path), providers=["CPUExecutionProvider"]
            )
        except Exception as error:
            raise RuntimeError(f"Could not load ONNX model {model_path}: {error}") from error
        self.input_name = self.session.get_inputs()[0].name

    @staticmethod
    def preprocess(card_crop: np.ndarray) -> np.ndarray:
        return normalize_grayscale_card(card_crop)

    def read(self, card_crop: np.ndarray) -> NumberPrediction:
        normalized = self.preprocess(card_crop)
        tensor = normalized.astype(np.float32)[None, None] / 255.0
        logits = self.session.run(None, {self.input_name: tensor})[0][:, 0, :]

        characters: list[str] = []
        probabilities: list[float] = []
        previous = -1
        for row in logits:
            best = int(np.argmax(row))
            if best != previous and best != 0:
                shifted = row - row[best]
                probabilities.append(float(1.0 / np.exp(shifted).sum()))
                characters.append(NUMBER_CHARSET[best])
            previous = best
        confidence = float(np.mean(probabilities)) if probabilities else 0.0
        return NumberPrediction("".join(characters), confidence)


def padded_crop(
    image: np.ndarray, box: tuple[int, int, int, int]
) -> tuple[np.ndarray, int, int]:
    x1, y1, x2, y2 = box
    pad_x = max(MIN_PAD_PIXELS, round((x2 - x1) * BOAT_PAD_FRACTION))
    pad_y = max(MIN_PAD_PIXELS, round((y2 - y1) * BOAT_PAD_FRACTION))
    crop_x1 = max(0, x1 - pad_x)
    crop_y1 = max(0, y1 - pad_y)
    crop_x2 = min(image.shape[1], x2 + pad_x)
    crop_y2 = min(image.shape[0], y2 + pad_y)
    return image[crop_y1:crop_y2, crop_x1:crop_x2], crop_x1, crop_y1


def draw_detection(
    image: np.ndarray, detection: Detection, color: tuple[int, int, int], label: str
) -> None:
    x1, y1, x2, y2 = detection.box
    cv2.rectangle(image, (x1, y1), (x2, y2), color, 3)
    cv2.putText(
        image,
        f"{label} {detection.confidence:.2f}",
        (x1, max(24, y1 - 8)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        color,
        2,
        cv2.LINE_AA,
    )


def draw_processing_times(
    image: np.ndarray,
    boat_seconds: float,
    card_seconds: float | None = None,
    number_seconds: float | None = None,
) -> None:
    lines = [f"Processing time: boats {boat_seconds * 1000:.1f} ms"]
    if card_seconds is not None:
        lines.append(f"cards {card_seconds * 1000:.1f} ms")
    if number_seconds is not None:
        lines.append(f"numbers {number_seconds * 1000:.1f} ms")
        total = boat_seconds + (card_seconds or 0.0) + number_seconds
        lines.append(f"total {total * 1000:.1f} ms")

    line_height = 28
    panel_width = 350
    panel_height = 14 + line_height * len(lines)
    overlay = image.copy()
    cv2.rectangle(overlay, (8, 8), (panel_width, panel_height), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.65, image, 0.35, 0, image)
    for index, line in enumerate(lines):
        cv2.putText(
            image,
            line,
            (18, 34 + index * line_height),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="Image file to analyze")
    parser.add_argument("--boat-model", type=Path, default=HERE / "crewtimer-boat-train.onnx")
    parser.add_argument("--card-model", type=Path, default=HERE / "bow_card_detect.onnx")
    parser.add_argument("--number-model", type=Path, default=HERE / "bow_crnn.onnx")
    parser.add_argument("--output-dir", type=Path, default=HERE / "test-output")
    parser.add_argument("--boat-confidence", type=float, default=0.25)
    parser.add_argument("--card-confidence", type=float, default=0.30)
    parser.add_argument(
        "--boats-only", action="store_true", help="Run only the first detection stage"
    )
    parser.add_argument("--show", action="store_true", help="Open both annotated images")
    args = parser.parse_args()

    image = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    if image is None:
        parser.error(f"Could not read image: {args.image}")

    try:
        boat_detector = YoloBoxDetector(args.boat_model)
    except RuntimeError as error:
        parser.error(str(error))

    started = time.perf_counter()
    boats = boat_detector.detect(image, args.boat_confidence)
    boat_seconds = time.perf_counter() - started
    boats_image = image.copy()
    combined_image = image.copy()
    cards: list[Detection] = []
    for boat in boats:
        draw_detection(boats_image, boat, (0, 255, 0), "boat")
        draw_detection(combined_image, boat, (0, 255, 0), "boat")

    draw_processing_times(boats_image, boat_seconds)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    boats_path = args.output_dir / f"{args.image.stem}_boats.png"
    cv2.imwrite(str(boats_path), boats_image)
    print(f"Detected {len(boats)} boat(s); wrote {boats_path}")
    if args.boats_only:
        print(f"Processing time: boats={boat_seconds * 1000:.1f} ms")
        if args.show:
            cv2.imshow("Detected boats", boats_image)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
        return 0

    try:
        card_detector = YoloBoxDetector(args.card_model)
        number_reader = BowNumberReader(args.number_model)
    except RuntimeError as error:
        parser.error(str(error))

    card_seconds = 0.0
    number_seconds = 0.0
    for boat in boats:
        crop, offset_x, offset_y = padded_crop(image, boat.box)
        started = time.perf_counter()
        local_cards = card_detector.detect(crop, args.card_confidence)
        card_seconds += time.perf_counter() - started
        for local_card in local_cards:
            x1, y1, x2, y2 = local_card.box
            card = Detection(
                (x1 + offset_x, y1 + offset_y, x2 + offset_x, y2 + offset_y),
                local_card.confidence,
            )
            cards.append(card)
            card_crop, _, _ = padded_crop(image, card.box)
            started = time.perf_counter()
            prediction = number_reader.read(card_crop)
            number_seconds += time.perf_counter() - started
            number_label = prediction.text or "?"
            draw_detection(
                combined_image,
                card,
                (255, 0, 255),
                f"bow {number_label} ocr={prediction.confidence:.2f} card",
            )
            print(
                f"Recognized bow number {number_label!r} "
                f"(confidence {prediction.confidence:.2f})"
            )

    draw_processing_times(
        combined_image, boat_seconds, card_seconds, number_seconds
    )

    combined_path = args.output_dir / f"{args.image.stem}_boats_and_cards.png"
    cv2.imwrite(str(combined_path), combined_image)
    print(f"Detected {len(cards)} bow card(s); wrote {combined_path}")
    print(
        "Processing time: "
        f"boats={boat_seconds * 1000:.1f} ms, "
        f"cards={card_seconds * 1000:.1f} ms, "
        f"numbers={number_seconds * 1000:.1f} ms, "
        f"total={(boat_seconds + card_seconds + number_seconds) * 1000:.1f} ms"
    )

    if args.show:
        cv2.imshow("Detected boats", boats_image)
        cv2.imshow("Detected boats and bow cards", combined_image)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
