#!/usr/bin/env python3
"""Build a YOLO-format 'card' detection dataset from card-labels JSON sidecars.

For each labelled bow card, crops the source image to a padded boatBox and
re-expresses the card's `box` as a YOLO-normalized label relative to that
crop. This matches what the runtime pipeline does at inference time: the
boat detector finds a boat, we crop to it, and the card detector trained on
this dataset finds the card within that crop.
"""

import argparse
import hashlib
import json
from pathlib import Path

import cv2

BOAT_PAD_FRACTION = 0.15  # padding around boatBox, as a fraction of its own w/h
BOAT_MATCH_IOU = 0.50


def clamp(value, lo, hi):
    return max(lo, min(value, hi))


def split_for(image_name: str, validation_percent: int) -> str:
    digest = hashlib.sha256(image_name.encode("utf-8")).digest()
    return "val" if digest[0] < validation_percent * 256 / 100 else "train"


def box_iou(first: dict, second: dict) -> float:
    x1 = max(float(first["x"]), float(second["x"]))
    y1 = max(float(first["y"]), float(second["y"]))
    x2 = min(
        float(first["x"]) + float(first["width"]),
        float(second["x"]) + float(second["width"]),
    )
    y2 = min(
        float(first["y"]) + float(first["height"]),
        float(second["y"]) + float(second["height"]),
    )
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    first_area = max(0.0, float(first["width"])) * max(
        0.0, float(first["height"])
    )
    second_area = max(0.0, float(second["width"])) * max(
        0.0, float(second["height"])
    )
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def boxes_intersect(first: dict, second: dict) -> bool:
    return (
        float(first["x"]) < float(second["x"]) + float(second["width"])
        and float(first["x"]) + float(first["width"]) > float(second["x"])
        and float(first["y"]) < float(second["y"]) + float(second["height"])
        and float(first["y"]) + float(first["height"]) > float(second["y"])
    )


def padded_box(box: dict, image_w: int, image_h: int) -> dict:
    x = int(round(float(box["x"])))
    y = int(round(float(box["y"])))
    width = int(round(float(box["width"])))
    height = int(round(float(box["height"])))
    pad_x = max(4, round(width * BOAT_PAD_FRACTION))
    pad_y = max(4, round(height * BOAT_PAD_FRACTION))
    x1 = clamp(x - pad_x, 0, image_w)
    y1 = clamp(y - pad_y, 0, image_h)
    x2 = clamp(x + width + pad_x, 0, image_w)
    y2 = clamp(y + height + pad_y, 0, image_h)
    return {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}


def read_yolo_boat_boxes(label_path: Path, image_w: int, image_h: int) -> list[dict]:
    if not label_path.is_file():
        return []
    boxes = []
    for line in label_path.read_text().splitlines():
        fields = line.split()
        if len(fields) < 5 or fields[0] != "0":
            continue
        try:
            center_x, center_y, width, height = map(float, fields[1:5])
        except ValueError:
            continue
        boxes.append(
            {
                "x": (center_x - width / 2) * image_w,
                "y": (center_y - height / 2) * image_h,
                "width": width * image_w,
                "height": height * image_h,
            }
        )
    return boxes


def build_from_dataset(
    dataset_root: Path, output_root: Path, validation_percent: int = 0
) -> dict:
    images_dir = dataset_root / "images"
    labels_dir = dataset_root / "card-labels"
    boat_labels_dir = dataset_root / "labels"
    if validation_percent:
        for split in ("train", "val"):
            (output_root / split / "images").mkdir(parents=True, exist_ok=True)
            (output_root / split / "labels").mkdir(parents=True, exist_ok=True)
    else:
        (output_root / "images").mkdir(parents=True, exist_ok=True)
        (output_root / "labels").mkdir(parents=True, exist_ok=True)

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
        "negative_candidates": 0,
        "negative_written": 0,
        "negative_skipped_card_overlap": 0,
        "full_frame_negative_written": 0,
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

        cards = data.get("cards", [])
        for card_index, card in enumerate(cards):
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
            split = split_for(image_path.name, validation_percent)
            split_root = output_root / split if validation_percent else output_root
            out_images = split_root / "images"
            out_labels = split_root / "labels"
            cv2.imwrite(str(out_images / f"{name}.png"), crop)
            (out_labels / f"{name}.txt").write_text(
                f"0 {norm_cx:.6f} {norm_cy:.6f} {norm_w:.6f} {norm_h:.6f}\n"
            )
            stats["written"] += 1

        annotated_boats = [
            card["boatBox"]
            for card in cards
            if isinstance(card.get("boatBox"), dict)
        ]
        annotated_cards = [
            card["box"] for card in cards if isinstance(card.get("box"), dict)
        ]
        boat_label_path = boat_labels_dir / f"{image_path.stem}.txt"
        detected_boats = read_yolo_boat_boxes(boat_label_path, image_w, image_h)
        negative_index = 0
        for boat_box in detected_boats:
            if any(box_iou(boat_box, known) >= BOAT_MATCH_IOU for known in annotated_boats):
                continue
            stats["negative_candidates"] += 1
            crop_box = padded_box(boat_box, image_w, image_h)
            if crop_box["width"] <= 0 or crop_box["height"] <= 0:
                continue
            if any(boxes_intersect(crop_box, card_box) for card_box in annotated_cards):
                stats["negative_skipped_card_overlap"] += 1
                continue

            x1 = int(crop_box["x"])
            y1 = int(crop_box["y"])
            x2 = x1 + int(crop_box["width"])
            y2 = y1 + int(crop_box["height"])
            negative_crop = image[y1:y2, x1:x2]
            if negative_crop.size == 0:
                continue
            split = split_for(image_path.name, validation_percent)
            split_root = output_root / split if validation_percent else output_root
            out_images = split_root / "images"
            out_labels = split_root / "labels"
            name = (
                f"{dataset_root.name}_{image_path.stem}"
                f"_boat-negative{negative_index:02d}"
            )
            cv2.imwrite(str(out_images / f"{name}.png"), negative_crop)
            (out_labels / f"{name}.txt").write_text("")
            negative_index += 1
            stats["negative_written"] += 1

        # An explicitly empty boat label plus cards: [] marks an image known to
        # contain neither boats nor cards. Preserve the full frame as a hard
        # negative for the optional full-frame card-detector fallback.
        if (
            not cards
            and boat_label_path.is_file()
            and not boat_label_path.read_text().strip()
        ):
            split = split_for(image_path.name, validation_percent)
            split_root = output_root / split if validation_percent else output_root
            out_images = split_root / "images"
            out_labels = split_root / "labels"
            name = f"{dataset_root.name}_{image_path.stem}_full-negative00"
            cv2.imwrite(str(out_images / f"{name}.png"), image)
            (out_labels / f"{name}.txt").write_text("")
            stats["full_frame_negative_written"] += 1

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a YOLO 'card' detector dataset from card-labels JSON sidecars"
    )
    parser.add_argument("datasets", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--validation-percent", type=int, default=0)
    args = parser.parse_args()

    if not 0 <= args.validation_percent < 100:
        parser.error("--validation-percent must be between 0 and 99")

    totals = {}
    for dataset in args.datasets:
        stats = build_from_dataset(dataset, args.output, args.validation_percent)
        totals[dataset.name] = stats
        print(f"{dataset}: {stats}")
    if args.validation_percent:
        (args.output / "data.yaml").write_text(
            f"path: {args.output.resolve()}\n"
            "train: train/images\n"
            "val: val/images\n"
            "names:\n"
            "  0: bow_card\n"
        )
    print(json.dumps(totals, indent=2))


if __name__ == "__main__":
    main()
