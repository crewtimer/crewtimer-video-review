#!/usr/bin/env python3
"""Score full-image review-app inference against holdout annotations."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import onnxruntime as ort

from bow_ocr_labels import bow_label_from_card, dataset_ignores_alpha, is_valid_bow_label


def iou(a, b):
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(
        0, min(a[3], b[3]) - max(a[1], b[1]))
    union = ((a[2] - a[0]) * (a[3] - a[1]) +
             (b[2] - b[0]) * (b[3] - b[1]) - intersection)
    return intersection / union if union > 0 else 0.0


def match_boxes(predicted, expected, threshold):
    """Greedy descending-IoU, one-to-one spatial matching (not mAP)."""
    candidates = sorted(((iou(p, g), pi, gi)
                         for pi, p in enumerate(predicted)
                         for gi, g in enumerate(expected)), reverse=True)
    pairs, used_p, used_g = [], set(), set()
    for overlap, pi, gi in candidates:
        if overlap >= threshold and pi not in used_p and gi not in used_g:
            pairs.append((pi, gi))
            used_p.add(pi)
            used_g.add(gi)
    return pairs


def metrics(tp, predicted, expected):
    return dict(tp=tp, fp=predicted - tp, fn=expected - tp,
                precision=tp / predicted if predicted else None,
                recall=tp / expected if expected else None)


def annotations(root, image_path, width, height, ignore_alpha, warnings=None,
                last_digit_only=False):
    warnings = warnings if warnings is not None else []
    boat_path = root / 'labels' / (image_path.stem + '.txt')
    card_path = root / 'card-labels' / (image_path.stem + '.json')
    boats = None
    if boat_path.exists():
        boats = []
        for line in boat_path.read_text().splitlines():
            if not line.strip():
                continue
            fields = [float(v) for v in line.split()]
            if len(fields) < 5 or fields[0] != 0:
                raise ValueError(f'Invalid single-class YOLO annotation: {boat_path}')
            _, x, y, w, h = fields[:5]  # Pose keypoints, if present, are unused.
            if not all(0 <= v <= 1 for v in (x, y, w, h)) or w <= 0 or h <= 0:
                raise ValueError(f'Invalid normalized box: {boat_path}')
            boats.append([(x-w/2)*width, (y-h/2)*height,
                          (x+w/2)*width, (y+h/2)*height])
    cards = None
    if card_path.exists():
        sidecar = json.loads(card_path.read_text())
        if sidecar['image'] != image_path.name:
            warnings.append(f"Sidecar image name {sidecar['image']} differs; matched by sidecar filename")
        if sidecar['width'] != width or sidecar['height'] != height:
            warnings.append(f"Card annotation dimensions {sidecar['width']}x{sidecar['height']} "
                            f"differ from image {width}x{height}; card/OCR scoring excluded")
            return boats, None
        cards = []
        for card in sidecar['cards']:
            b = card['box']
            if b['width'] <= 0 or b['height'] <= 0:
                raise ValueError(f'Invalid card box: {card_path}')
            text = bow_label_from_card(card, ignore_alpha=ignore_alpha)
            legible = (bool(card.get('legible', bool(text)))
                        and is_valid_bow_label(text))
            if last_digit_only and text:
                text = text[-1]
            cards.append(dict(box=[b['x'], b['y'], b['x']+b['width'], b['y']+b['height']],
                              text=text, legible=legible))
    return boats, cards


def score(boats, cards, detections, threshold, last_digit_only=False):
    result = {}
    if boats is not None:
        predicted = [d['boat'] for d in detections if d['boat'][2] > d['boat'][0]]
        pairs = match_boxes(predicted, boats, threshold)
        result['boats'] = metrics(len(pairs), len(predicted), len(boats))
    if cards is not None:
        predicted = [d for d in detections if d['card'][2] > d['card'][0]]
        pairs = match_boxes([d['card'] for d in predicted], [c['box'] for c in cards], threshold)
        result['cards'] = metrics(len(pairs), len(predicted), len(cards))
        matched = {gi: pi for pi, gi in pairs}
        eligible = [gi for gi, card in enumerate(cards) if card['legible']]
        def text_matches(gi):
            if gi not in matched:
                return False
            predicted_text = predicted[matched[gi]]['text']
            expected_text = cards[gi]['text']
            if last_digit_only:
                predicted_text = predicted_text[-1:]
                expected_text = expected_text[-1:]
            return predicted_text == expected_text
        result['numbers'] = dict(
            total=len(eligible), matched=sum(gi in matched for gi in eligible),
            correct=sum(text_matches(gi) for gi in eligible))
        result['number_errors'] = [dict(expected=cards[gi]['text'],
            predicted=predicted[matched[gi]]['text'] if gi in matched else None,
            reason='wrong_text' if gi in matched else 'card_missed')
            for gi in eligible if not text_matches(gi)]
    return result


def summarize(rows, image_count):
    summary = {}
    for stage in ('boats', 'cards'):
        values = [row[stage] for row in rows if stage in row]
        tp, fp, fn = (sum(value[key] for value in values)
                      for key in ('tp', 'fp', 'fn'))
        summary[stage] = dict(
            scored_images=len(values),
            unannotated_images=image_count - len(values),
            **metrics(tp, tp + fp, tp + fn),
        )
    numbers = {
        key: sum(row.get('numbers', {}).get(key, 0) for row in rows)
        for key in ('total', 'matched', 'correct')
    }
    numbers['end_to_end_accuracy'] = (
        numbers['correct'] / numbers['total'] if numbers['total'] else None
    )
    numbers['matched_card_accuracy'] = (
        numbers['correct'] / numbers['matched'] if numbers['matched'] else None
    )
    summary['numbers'] = numbers
    return summary


def validate_number_model(path, expected_classes, name):
    session = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
    shape = session.get_outputs()[0].shape
    if len(shape) != 3 or shape[2] != expected_classes:
        raise ValueError(
            f'{name} OCR model must output (T, 1, {expected_classes}); '
            f'{path} outputs {shape}'
        )
    return expected_classes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, default=Path.home() / 'training/datasets/dataset-holdout')
    parser.add_argument('--output-dir', type=Path, default=Path('build/holdout-validation'))
    parser.add_argument('--runner', type=Path, default=Path('build/holdout-pipeline'))
    parser.add_argument('--iou', type=float, default=0.5)
    parser.add_argument(
        '--last-digit-only',
        action='store_true',
        help='Score OCR against only the final digit of each annotated label',
    )
    for name, default in [('boat', 'crewtimer-boat-train.onnx'),
                          ('card', 'bow_card_detect.onnx'),
                          ('number', 'bow_crnn.onnx'),
                          ('numeric-number', 'bow_crnn_numeric.onnx')]:
        parser.add_argument(f'--{name}-model', type=Path, default=Path(default))
    args = parser.parse_args()
    if not 0 < args.iou <= 1:
        parser.error('--iou must be in (0, 1]')
    root = args.dataset.expanduser().resolve()
    images = sorted(p for p in (root / 'images').glob('*') if p.suffix.lower() in {'.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp'})
    if not images:
        parser.error(f'No images found in {root / "images"}')
    shared_models = {
        name: getattr(args, f'{name}_model').resolve()
        for name in ('boat', 'card')
    }
    number_models = {
        'alphanumeric': args.number_model.resolve(),
        'numeric': args.numeric_number_model.resolve(),
    }
    all_models = {**shared_models, **{
        f'{name}_number': path for name, path in number_models.items()
    }}
    missing = [str(path) for path in all_models.values() if not path.is_file()]
    if missing:
        parser.error('Missing model file(s): ' + ', '.join(missing))
    try:
        number_class_counts = {
            'alphanumeric': validate_number_model(
                number_models['alphanumeric'], 37, 'Alphanumeric'
            ),
            'numeric': validate_number_model(
                number_models['numeric'], 11, 'Numeric'
            ),
        }
    except (ValueError, RuntimeError) as error:
        parser.error(str(error))
    report = dict(dataset=str(root), created=datetime.now(timezone.utc).isoformat(),
                  pipeline='native/ffreader/src/BowNumberPipeline.cpp:detectAll; detectCardsWithoutBoat=false',
                  iou_threshold=args.iou,
                  last_digit_only=args.last_digit_only,
                  models={k: dict(path=str(p), sha256=hashlib.sha256(p.read_bytes()).hexdigest())
                          for k, p in all_models.items()}, images=[])
    for name, class_count in number_class_counts.items():
        report['models'][f'{name}_number']['class_count'] = class_count
    ignore_alpha = dataset_ignores_alpha(root)
    report['ignore_alpha_labels'] = ignore_alpha
    started = time.perf_counter()
    for index, path in enumerate(images):
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError(f'Cannot read image: {path}')
        height, width = image.shape[:2]
        warnings = []
        boats, cards = annotations(
            root, path, width, height, ignore_alpha, warnings,
            args.last_digit_only,
        )
        _, numeric_cards = annotations(
            root, path, width, height, True,
            last_digit_only=args.last_digit_only,
        )
        report['images'].append(dict(
            image=path.name,
            annotations=dict(
                boats=boats,
                alphanumeric_cards=cards,
                numeric_cards=numeric_cards,
            ),
            warnings=warnings,
            runs={},
        ))

    for model_name, number_model in number_models.items():
        command = [str(args.runner.resolve()), str(shared_models['boat']),
                   str(shared_models['card']), str(number_model)]
        with subprocess.Popen(command, stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE) as process:
            try:
                for index, (path, row) in enumerate(
                        zip(images, report['images']), 1):
                    image = cv2.imread(str(path))
                    height, width = image.shape[:2]
                    tick = time.perf_counter()
                    process.stdin.write(
                        f'{width} {height}\n'.encode() + image.tobytes()
                    )
                    process.stdin.flush()
                    line = process.stdout.readline()
                    if not line:
                        raise RuntimeError(
                            f'{model_name} native inference failed; '
                            'see stderr diagnostics'
                        )
                    detections = json.loads(line)
                    expected_cards = row['annotations'][f'{model_name}_cards']
                    row['runs'][model_name] = dict(
                        seconds=time.perf_counter() - tick,
                        detections=detections,
                        **score(row['annotations']['boats'], expected_cards,
                                detections, args.iou, args.last_digit_only),
                    )
                    if index % 25 == 0 or index == len(images):
                        print(f'Validated {model_name} {index}/{len(images)} images',
                              flush=True)
                process.stdin.close()
                if process.wait() != 0:
                    raise RuntimeError(f'{model_name} native inference process failed')
            finally:
                if process.poll() is None:
                    process.kill()
    report['elapsed_seconds'] = time.perf_counter() - started
    summary = {
        name: summarize([row['runs'][name] for row in report['images']],
                        len(images))
        for name in number_models
    }
    report['summary'] = summary
    def percent(value):
        return f'{value:.2%}' if value is not None else 'N/A'
    lines = ['# Holdout validation', '', f'Dataset: `{root}`',
             f'Images: {len(images)}; elapsed: {report["elapsed_seconds"]:.1f}s', '',
             'Uses the review app C++ pipeline on full images with both OCR models, default thresholds, and no card-only fallback.',
             f'One-to-one descending-IoU matching at IoU >= {args.iou}; these are fixed-threshold metrics, not mAP.', '',
             '| Model | Stage | Scored images | Unannotated images | TP | FP | FN | Precision | Recall |',
             '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
    for model_name in number_models:
        for stage in ('boats', 'cards'):
            r = summary[model_name][stage]
            lines.append(f'| {model_name} | {stage} | {r["scored_images"]} | {r["unannotated_images"]} | {r["tp"]} | {r["fp"]} | {r["fn"]} | {percent(r["precision"])} | {percent(r["recall"])} |')
    lines += ['', '| OCR model | Exact end to end | Exact on matched cards |',
              '| --- | ---: | ---: |']
    for model_name in number_models:
        numbers = summary[model_name]['numbers']
        lines.append(
            f'| {model_name} | {numbers["correct"]}/{numbers["total"]} '
            f'({percent(numbers["end_to_end_accuracy"])}) | '
            f'{numbers["correct"]}/{numbers["matched"]} '
            f'({percent(numbers["matched_card_accuracy"])}) |'
        )
    lines += ['',
              'Missing annotations are excluded per stage; empty annotation files count as negatives. All annotated cards count for detection; only legible, valid labels count for OCR. Card recall includes upstream boat misses. Duplicate predictions count as false positives. Unmatched legible cards count as bow-number failures.', '',
              'The numeric model is scored against labels with any leading A-Z prefix removed.', '',
              '## Bow-number errors', '', '| Model | Image | Expected | Predicted | Reason |', '| --- | --- | --- | --- | --- |']
    if args.last_digit_only:
        error_heading = lines.index('## Bow-number errors')
        lines[error_heading:error_heading] = [
            'Last-digit-only scoring is enabled; expected and predicted labels are compared by their final digit.',
            '',
        ]
    for row in report['images']:
        for model_name in number_models:
            for error in row['runs'][model_name].get('number_errors', []):
                lines.append(f'| {model_name} | {row["image"]} | {error["expected"]} | {error["predicted"] if error["predicted"] is not None else "—"} | {error["reason"]} |')
    lines += ['', '## Annotation notes', '',
              'Sidecars are paired by filename stem. Dimension mismatches exclude card/OCR scoring; predictions are retained.', '']
    for row in report['images']:
        for warning in row['warnings']:
            lines.append(f"- {row['image']}: {warning}")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    (args.output_dir / 'report.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines[:17]))
    print(f'Reports: {args.output_dir / "report.md"} and report.json')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
