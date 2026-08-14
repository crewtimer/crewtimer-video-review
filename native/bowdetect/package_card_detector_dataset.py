#!/usr/bin/env python3
"""Package the generated bow-card detector crops for Google Colab.

The input is the output of build_card_detector_dataset.py (normally
build/card-detector-data). The archive retains the exact train/validation
split used by the local Makefile and replaces the machine-specific YAML path
with a portable relative path.
"""

from __future__ import annotations

import argparse
import tempfile
import zipfile
from pathlib import Path


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg"}


def matching_stems(dataset: Path, split: str) -> tuple[set[str], set[str]]:
    images = {
        path.stem
        for path in (dataset / split / "images").iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    }
    labels = {
        path.stem
        for path in (dataset / split / "labels").glob("*.txt")
        if path.is_file()
    }
    return images, labels


def validate_dataset(dataset: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    for split in ("train", "val"):
        image_dir = dataset / split / "images"
        label_dir = dataset / split / "labels"
        if not image_dir.is_dir() or not label_dir.is_dir():
            raise ValueError(f"Missing {split}/images or {split}/labels in {dataset}")
        images, labels = matching_stems(dataset, split)
        missing_labels = images - labels
        missing_images = labels - images
        if missing_labels or missing_images:
            raise ValueError(
                f"{split} image/label mismatch: {len(missing_labels)} images "
                f"without labels, {len(missing_images)} labels without images"
            )
        if not images:
            raise ValueError(f"No {split} images found in {dataset}")
        counts[split] = len(images)
    return counts


def create_archive(dataset: Path, output: Path) -> dict[str, int]:
    counts = validate_dataset(dataset)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp_dir:
        portable_yaml = Path(temp_dir) / "data.yaml"
        portable_yaml.write_text(
            "path: .\n"
            "train: train/images\n"
            "val: val/images\n"
            "names:\n"
            "  0: bow_card\n"
        )
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.write(portable_yaml, "card-detector-data/data.yaml")
            for split in ("train", "val"):
                for kind in ("images", "labels"):
                    source_dir = dataset / split / kind
                    for path in sorted(source_dir.iterdir()):
                        if path.is_file():
                            archive.write(
                                path,
                                Path("card-detector-data") / split / kind / path.name,
                            )
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Zip the generated card-detector crops and labels for Colab"
    )
    parser.add_argument(
        "--dataset", type=Path, default=Path("build/card-detector-data")
    )
    parser.add_argument(
        "--output", type=Path, default=Path("build/card-detector-colab.zip")
    )
    args = parser.parse_args()

    try:
        counts = create_archive(args.dataset, args.output)
    except ValueError as error:
        parser.error(str(error))
    print(
        f"Created {args.output.resolve()} with {counts['train']} training and "
        f"{counts['val']} validation images"
    )


if __name__ == "__main__":
    main()
