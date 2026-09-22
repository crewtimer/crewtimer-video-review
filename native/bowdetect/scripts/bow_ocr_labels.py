"""Shared bow-card OCR character and label definitions."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from pathlib import Path


# CTC reserves model output class 0 for its blank. The characters below map to
# output classes 1..36; neither a hyphen nor a space is part of the vocabulary.
DIGITS = "0123456789"
ALPHA_PREFIXES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
CHARACTERS = DIGITS + ALPHA_PREFIXES
BLANK_INDEX = 0
NUM_CLASSES = len(CHARACTERS) + 1
NUMERIC_NUM_CLASSES = len(DIGITS) + 1

_LABEL_PATTERN = re.compile(r"[A-Z]?[0-9]{1,3}")


def characters_for_class_count(num_classes: int) -> str:
    """Return the known CTC vocabulary for an ONNX output class count."""
    if num_classes == NUMERIC_NUM_CLASSES:
        return DIGITS
    if num_classes == NUM_CLASSES:
        return CHARACTERS
    raise ValueError(
        f"Unsupported bow OCR class count {num_classes}; expected "
        f"{NUMERIC_NUM_CLASSES} (numeric) or {NUM_CLASSES} (alphanumeric)"
    )


def dataset_ignores_alpha(dataset_root: Path) -> bool:
    """Read the optional dataset-level OCR label policy."""
    config_path = dataset_root / "config.json"
    if not config_path.exists():
        return False
    config = json.loads(config_path.read_text())
    return config.get("ignoreAlpha") is True


def normalize_bow_label(value: object, *, ignore_alpha: bool = False) -> str:
    """Return a sidecar or filename label in the model's canonical form."""
    label = str(value or "").strip().upper()
    return label.lstrip(ALPHA_PREFIXES) if ignore_alpha else label


def is_valid_bow_label(value: object) -> bool:
    """Accept a numeric bow label with an optional single A-Z prefix."""
    return _LABEL_PATTERN.fullmatch(normalize_bow_label(value)) is not None


def bow_label_from_card(
    card: Mapping[str, object], *, ignore_alpha: bool = False
) -> str:
    """Read a complete label from a card sidecar entry.

    Newer sidecars store both the full label in ``value`` and its components
    in ``prefix`` and ``digits``. Older numeric sidecars may only have digits.
    """
    value = normalize_bow_label(card.get("value"), ignore_alpha=ignore_alpha)
    if is_valid_bow_label(value):
        return value

    prefix = normalize_bow_label(card.get("prefix"))
    digits = normalize_bow_label(card.get("digits"))
    assembled = normalize_bow_label(prefix + digits, ignore_alpha=ignore_alpha)
    return assembled if is_valid_bow_label(assembled) else value or assembled
