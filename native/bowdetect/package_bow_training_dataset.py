#!/usr/bin/env python3
"""Package card-detector and OCR datasets for the combined Colab notebook."""

from __future__ import annotations

import argparse
import json
import tempfile
import zipfile
from pathlib import Path

from package_card_detector_dataset import IMAGE_SUFFIXES, validate_dataset


def validate_ocr_dataset(dataset: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    for split in ("train", "validation"):
        directory = dataset / split
        if not directory.is_dir():
            raise ValueError(f"Missing OCR {split} directory in {dataset}")
        images = [
            path
            for path in directory.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
        ]
        invalid = [
            path.name
            for path in images
            if not path.stem.split("_", 1)[0].isdigit()
            or not 1 <= len(path.stem.split("_", 1)[0]) <= 3
        ]
        if invalid:
            raise ValueError(
                f"OCR {split} contains {len(invalid)} files without a 1-3 digit "
                f"filename label; first invalid file: {invalid[0]}"
            )
        if not images:
            raise ValueError(f"No OCR {split} images found in {dataset}")
        counts[split] = len(images)
    return counts


def create_archive(
    card_dataset: Path,
    ocr_dataset: Path,
    training_script: Path,
    output: Path,
) -> dict[str, dict[str, int]]:
    card_counts = validate_dataset(card_dataset)
    ocr_counts = validate_ocr_dataset(ocr_dataset)
    if not training_script.is_file():
        raise ValueError(f"Missing OCR training script: {training_script}")
    preprocessing_script = training_script.with_name("ocr_preprocessing.py")
    if not preprocessing_script.is_file():
        raise ValueError(f"Missing OCR preprocessing script: {preprocessing_script}")

    counts = {"card_detector": card_counts, "ocr": ocr_counts}
    output.parent.mkdir(parents=True, exist_ok=True)
    root = Path("bow-training-data")

    with tempfile.TemporaryDirectory() as temp_dir:
        portable_yaml = Path(temp_dir) / "data.yaml"
        portable_yaml.write_text(
            "path: .\n"
            "train: train/images\n"
            "val: val/images\n"
            "names:\n"
            "  0: bow_card\n"
        )
        manifest = Path(temp_dir) / "manifest.json"
        manifest.write_text(json.dumps(counts, indent=2) + "\n")

        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.write(manifest, root / "manifest.json")
            archive.write(
                portable_yaml, root / "card-detector-data" / "data.yaml"
            )
            for split in ("train", "val"):
                for kind in ("images", "labels"):
                    source = card_dataset / split / kind
                    for path in sorted(source.iterdir()):
                        if not path.is_file():
                            continue
                        if kind == "images" and path.suffix.lower() not in IMAGE_SUFFIXES:
                            continue
                        if kind == "labels" and path.suffix.lower() != ".txt":
                            continue
                        archive.write(
                            path,
                            root / "card-detector-data" / split / kind / path.name,
                        )
            for split in ("train", "validation"):
                for path in sorted((ocr_dataset / split).iterdir()):
                    if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
                        archive.write(path, root / "ocr-data" / split / path.name)
            archive.write(training_script, root / "tools" / training_script.name)
            archive.write(
                preprocessing_script,
                root / "tools" / preprocessing_script.name,
            )
    return counts


def main() -> None:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Zip card-detector and OCR training data for Google Colab"
    )
    parser.add_argument(
        "--card-dataset",
        type=Path,
        default=Path("build/card-detector-data"),
    )
    parser.add_argument(
        "--ocr-dataset", type=Path, default=Path("build/ocr-data")
    )
    parser.add_argument(
        "--training-script", type=Path, default=here / "train_bow_crnn.py"
    )
    parser.add_argument(
        "--output", type=Path, default=Path("build/bow-training-colab.zip")
    )
    args = parser.parse_args()

    try:
        counts = create_archive(
            args.card_dataset, args.ocr_dataset, args.training_script, args.output
        )
    except ValueError as error:
        parser.error(str(error))
    print(
        f"Created {args.output.resolve()}: "
        f"card train={counts['card_detector']['train']}, "
        f"card val={counts['card_detector']['val']}, "
        f"OCR train={counts['ocr']['train']}, "
        f"OCR validation={counts['ocr']['validation']}"
    )


if __name__ == "__main__":
    main()
