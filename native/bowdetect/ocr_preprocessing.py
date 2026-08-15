"""Shared grayscale preprocessing for bow-number OCR training and inference."""

from __future__ import annotations

import cv2
import numpy as np


OUTPUT_HEIGHT = 48
OUTPUT_WIDTH = 60
UPSCALE = 10
CLAHE_CLIP_LIMIT = 2.0
CLAHE_GRID_SIZE = (4, 4)
POLARITY_THRESHOLD = 127.0


def normalize_grayscale_card(
    image: np.ndarray,
    output_width: int = OUTPUT_WIDTH,
    output_height: int = OUTPUT_HEIGHT,
) -> np.ndarray:
    """Preserve gray detail while normalizing contrast, polarity, and size."""
    if image.ndim == 2:
        gray = image
    elif image.shape[2] == 4:
        gray = cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
    else:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    upscaled = cv2.resize(
        gray, None, fx=UPSCALE, fy=UPSCALE, interpolation=cv2.INTER_LANCZOS4
    )
    enhanced = cv2.createCLAHE(
        clipLimit=CLAHE_CLIP_LIMIT, tileGridSize=CLAHE_GRID_SIZE
    ).apply(upscaled)
    blurred = cv2.GaussianBlur(enhanced, (0, 0), 1.0)
    sharpened = cv2.addWeighted(enhanced, 1.6, blurred, -0.6, 0)

    height, width = sharpened.shape
    center = sharpened[
        round(height * 0.2):round(height * 0.8),
        round(width * 0.2):round(width * 0.8),
    ]
    normalized = (
        sharpened
        if center.mean() >= POLARITY_THRESHOLD
        else cv2.bitwise_not(sharpened)
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
        (output_width, output_height),
        interpolation=cv2.INTER_AREA,
    )
