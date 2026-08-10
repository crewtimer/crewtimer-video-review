#!/usr/bin/env python3
"""Build a YOLO-format 'card' detection dataset from card-labels JSON sidecars.

For each labelled bow card, crops the source image to a padded boatBox and
re-expresses the card's `box` as a YOLO-normalized label relative to that
crop. This matches what the runtime pipeline does at inference time: the
boat detector finds a boat, we crop to it, and the card detector trained on
this dataset finds the card within that crop.
"""

import argparse
import json
from pathlib import Path

import cv2

BOAT_PAD_FRACTION = 0.15  # padding around boatBox, as a fraction of its own w/h


def clamp(value, lo, hi):
    return max(lo, min(value, hi))


def build_from_dataset(dataset_root: Path, output_root: Path) -> dict:
    images_dir = dataset_root / "images"
    labels_dir = dataset_root / "card-labels"
    out_images = output_root / "images"
    out_labels = output_root / "labels"
    out_images.mkdir(parents=True, exist_ok=True)
    out_labels.mkdir(parents=True, exist_ok=True)

    images_by_stem = {
        path.stem: path
        for path in images_dir.iterdir()
        if path.suffix.lower() in {".png", ".jpg", ".jpeg"}
    }

    stats = {
        "sidecars": 0,
        "cards": 0,
        "written": 0,
        "skipped_no_box": 0,
        "skipped_no_image": 0,
    }

    for sidecar_path in sorted(labels_dir.glob("*.json")):
        stats["sidecars"] += 1
        data = json.loads(sidecar_path.read_text())
        image_path = images_by_stem.get(sidecar_path.stem)
        if image_path is None:
            stats["skipped_no_image"] += 1
            continue

        image = cv2.imread(str(image_path))
        if image is None:
            stats["skipped_no_image"] += 1
            continue
        image_h, image_w = image.shape[:2]

        for card_index, card in enumerate(data.get("cards", [])):
            stats["cards"] += 1
            boat_box = card.get("boatBox")
            box = card.get("box")
            if not isinstance(boat_box, dict) or not isinstance(box, dict):
                stats["skipped_no_box"] += 1
                continue

            bx, by = int(boat_box["x"]), int(boat_box["y"])
            bw, bh = int(boat_box["width"]), int(boat_box["height"])
            pad_x = max(4, round(bw * BOAT_PAD_FRACTION))
            pad_y = max(4, round(bh * BOAT_PAD_FRACTION))
            x1 = clamp(bx - pad_x, 0, image_w)
            y1 = clamp(by - pad_y, 0, image_h)
            x2 = clamp(bx + bw + pad_x, 0, image_w)
            y2 = clamp(by + bh + pad_y, 0, image_h)
            if x2 <= x1 or y2 <= y1:
                stats["skipped_no_box"] += 1
                continue

            crop = image[y1:y2, x1:x2]
            crop_w = x2 - x1
            crop_h = y2 - y1

            card_x = int(box["x"]) - x1
            card_y = int(box["y"]) - y1
            card_w = int(box["width"])
            card_h = int(box["height"])
            cx1 = clamp(card_x, 0, crop_w)
            cy1 = clamp(card_y, 0, crop_h)
            cx2 = clamp(card_x + card_w, 0, crop_w)
            cy2 = clamp(card_y + card_h, 0, crop_h)
            if cx2 <= cx1 or cy2 <= cy1:
                stats["skipped_no_box"] += 1
                continue

            norm_cx = (cx1 + cx2) / 2 / crop_w
            norm_cy = (cy1 + cy2) / 2 / crop_h
            norm_w = (cx2 - cx1) / crop_w
            norm_h = (cy2 - cy1) / crop_h

            name = f"{dataset_root.name}_{image_path.stem}_boat{card_index:02d}"
            cv2.imwrite(str(out_images / f"{name}.png"), crop)
            (out_labels / f"{name}.txt").write_text(
                f"0 {norm_cx:.6f} {norm_cy:.6f} {norm_w:.6f} {norm_h:.6f}\n"
            )
            stats["written"] += 1

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a YOLO 'card' detector dataset from card-labels JSON sidecars"
    )
    parser.add_argument("datasets", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    totals = {}
    for dataset in args.datasets:
        stats = build_from_dataset(dataset, args.output)
        totals[dataset.name] = stats
        print(f"{dataset}: {stats}")
    print(json.dumps(totals, indent=2))


if __name__ == "__main__":
    main()
