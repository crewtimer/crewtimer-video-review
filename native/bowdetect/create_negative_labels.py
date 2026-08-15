#!/usr/bin/env python3
"""Create empty boat labels and card sidecars for known-negative images."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg"}


def create_labels(dataset: Path, overwrite: bool = False) -> int:
    images_dir = dataset / "images"
    if not images_dir.is_dir():
        raise ValueError(f"Missing images directory: {images_dir}")
    labels_dir = dataset / "labels"
    cards_dir = dataset / "card-labels"
    labels_dir.mkdir(parents=True, exist_ok=True)
    cards_dir.mkdir(parents=True, exist_ok=True)

    written = 0
    for image_path in sorted(images_dir.iterdir()):
        if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Unable to read image: {image_path}")
        height, width = image.shape[:2]
        label_path = labels_dir / f"{image_path.stem}.txt"
        card_path = cards_dir / f"{image_path.stem}.json"
        if not overwrite and (label_path.exists() or card_path.exists()):
            raise ValueError(
                f"Refusing to overwrite existing labels for {image_path.name}; "
                "use --overwrite to replace them"
            )
        label_path.write_text("")
        card_path.write_text(
            json.dumps(
                {
                    "image": image_path.name,
                    "width": width,
                    "height": height,
                    "cards": [],
                },
                indent=2,
            )
            + "\n"
        )
        written += 1
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    try:
        written = create_labels(args.dataset, args.overwrite)
    except ValueError as error:
        parser.error(str(error))
    print(f"Created empty boat and card labels for {written} images in {args.dataset}")


if __name__ == "__main__":
    main()
