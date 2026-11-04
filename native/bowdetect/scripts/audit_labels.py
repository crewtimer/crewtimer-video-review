#!/usr/bin/env python3
"""Flag training labels that are likely wrong and write a review report.

Two passes over each dataset's labels/ and card-labels/:

1. Rule checks that need no model: holdout leaks, duplicate images, cards
   too tall for their boat or outside every boat, tiny cards marked legible,
   invalid bow labels, and boats with no card label.
2. Model checks with the review app's C++ pipeline (build/holdout-pipeline):
   labelled boats or cards it cannot find, boats or cards it finds that have
   no label, and cards where confident OCR reads a different number.

The current models were trained on these labels, so they partly memorise bad
ones; model checks find fewer problems than a model trained without the
dataset would. The report lists suspects for review, not confirmed errors.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import subprocess
from collections import defaultdict
from pathlib import Path

import cv2

from bow_ocr_labels import dataset_ignores_alpha, is_valid_bow_label
from validate_holdout import annotations, match_boxes

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp'}
# The review app drops cards taller than this share of their boat
# (MAX_CARD_TO_BOAT_HEIGHT in BowNumberPipeline.cpp).
MAX_CARD_TO_BOAT_HEIGHT = 0.75

# Reason: (severity, description). Lower severity sorts first in the report.
REASONS = {
    'bad_annotation': (1, 'Label file is malformed'),
    'holdout_leak': (1, 'Image is also in the holdout'),
    'ocr_disagrees': (1, 'Confident OCR reads a different number than the label'),
    'card_too_tall': (1, f'Card taller than {MAX_CARD_TO_BOAT_HEIGHT} of its boat'),
    'card_outside_boat': (2, 'Card centre is outside every labelled boat'),
    'small_legible_card': (2, 'Card marked legible but too small to read'),
    'invalid_label': (2, 'Card marked legible with an invalid bow label'),
    'duplicate_image': (2, 'Same image is in another training dataset'),
    'boat_not_detected': (3, 'Labelled boat the model does not find'),
    'card_not_detected': (3, 'Labelled legible card the model does not find'),
    'unlabelled_boat': (3, 'Model finds a boat that has no label'),
    'unlabelled_card': (3, 'Model finds a card that has no label'),
    'boat_without_card': (4, 'Labelled boat with no card label'),
}


def image_paths(root):
    return sorted(p for p in (root / 'images').glob('*')
                  if p.suffix.lower() in IMAGE_SUFFIXES)


def contains(box, point):
    return box[0] <= point[0] <= box[2] and box[1] <= point[1] <= box[3]


def centre(box):
    return ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def rule_findings(boats, cards, min_card_height):
    """Label-only checks for one image. Boxes are [x1, y1, x2, y2]."""
    findings = []
    boats = boats or []
    for index, card in enumerate(cards or []):
        box = card['box']
        height = box[3] - box[1]
        owners = [boat for boat in boats if contains(boat, centre(box))]
        if boats and not owners:
            findings.append(dict(reason='card_outside_boat', focus=box, card=index))
        for boat in owners:
            ratio = height / (boat[3] - boat[1])
            if ratio > MAX_CARD_TO_BOAT_HEIGHT:
                findings.append(dict(reason='card_too_tall', focus=box, card=index,
                                     detail=f'card/boat height {ratio:.2f}'))
                break
        if card['legible'] and height < min_card_height:
            findings.append(dict(reason='small_legible_card', focus=box, card=index,
                                 label=card['text'],
                                 detail=f'{box[2] - box[0]:.0f}x{height:.0f} px'))
        if card['legible'] and not is_valid_bow_label(card['text']):
            findings.append(dict(reason='invalid_label', focus=box, card=index,
                                 label=card['text']))
    if cards is not None:
        for boat in boats:
            if not any(contains(boat, centre(card['box'])) for card in cards):
                findings.append(dict(reason='boat_without_card', focus=boat))
    return findings


def model_findings(boats, cards, detections, iou, min_ocr_confidence):
    """Disagreements between labels and the pipeline's detections."""
    findings = []
    if boats is not None:
        predicted = [d['boat'] for d in detections if d['boat'][2] > d['boat'][0]]
        pairs = match_boxes(predicted, boats, iou)
        matched_p = {pi for pi, _ in pairs}
        matched_g = {gi for _, gi in pairs}
        findings += [dict(reason='boat_not_detected', focus=boat)
                     for gi, boat in enumerate(boats) if gi not in matched_g]
        findings += [dict(reason='unlabelled_boat', focus=boat)
                     for pi, boat in enumerate(predicted) if pi not in matched_p]
    if cards is not None:
        predicted = [d for d in detections if d['card'][2] > d['card'][0]]
        pairs = match_boxes([d['card'] for d in predicted],
                            [c['box'] for c in cards], iou)
        by_label = {gi: predicted[pi] for pi, gi in pairs}
        matched_p = {pi for pi, _ in pairs}
        findings += [dict(reason='unlabelled_card', focus=d['card'],
                          predicted=d['text'])
                     for pi, d in enumerate(predicted) if pi not in matched_p]
        for gi, card in enumerate(cards):
            if not card['legible']:
                continue
            detection = by_label.get(gi)
            if detection is None:
                findings.append(dict(reason='card_not_detected', focus=card['box'],
                                     card=gi, label=card['text']))
                continue
            text = detection['text']
            # The app trims extra leading digits to the event's digit count.
            if (text and not text.endswith(card['text'])
                    and detection['confidence'] >= min_ocr_confidence):
                findings.append(dict(reason='ocr_disagrees', focus=card['box'],
                                     card=gi, label=card['text'], predicted=text,
                                     detail=f"confidence {detection['confidence']:.2f}"))
    return findings


def file_hash(path):
    return hashlib.md5(path.read_bytes()).hexdigest()


def tile(image, focus, boats, cards, detections, max_width=360):
    """Context crop around the focus box with labels green and predictions red."""
    canvas = image.copy()
    for d in detections:
        for box in (d['boat'], d['card']):
            if box[2] > box[0]:
                cv2.rectangle(canvas, tuple(map(int, box[:2])), tuple(map(int, box[2:])),
                              (0, 0, 255), 2)
    for box in (boats or []) + [c['box'] for c in cards or []]:
        cv2.rectangle(canvas, tuple(map(int, box[:2])), tuple(map(int, box[2:])),
                      (0, 255, 0), 2)
    height, width = image.shape[:2]
    if focus is None:
        crop = canvas
    else:
        cv2.rectangle(canvas, tuple(map(int, focus[:2])), tuple(map(int, focus[2:])),
                      (0, 255, 255), 3)
        pad = max(focus[2] - focus[0], focus[3] - focus[1], 120)
        x1, y1 = max(0, int(focus[0] - pad)), max(0, int(focus[1] - pad))
        x2, y2 = min(width, int(focus[2] + pad)), min(height, int(focus[3] + pad))
        crop = canvas[y1:y2, x1:x2]
    scale = max_width / crop.shape[1]
    return cv2.resize(crop, (max_width, max(1, int(crop.shape[0] * scale))),
                      interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_NEAREST)


class Pipeline:
    """Streams frames to the review app's C++ pipeline (holdout_pipeline.cpp)."""

    def __init__(self, runner, boat_model, card_model, number_model):
        self.process = subprocess.Popen(
            [str(runner), str(boat_model), str(card_model), str(number_model)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def detect(self, image):
        height, width = image.shape[:2]
        self.process.stdin.write(f'{width} {height}\n'.encode() + image.tobytes())
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError('Native inference failed; see stderr diagnostics')
        return json.loads(line)

    def close(self):
        self.process.stdin.close()
        if self.process.wait() != 0:
            raise RuntimeError('Native inference process failed')


def write_report(output_dir, findings, image_count, dataset_count, rules_only):
    rows = []
    counts = defaultdict(int)
    for f in findings:
        counts[f['reason']] += 1
    summary = ''.join(
        f'<tr><td>{REASONS[r][0]}</td><td><a href="#{r}">{html.escape(REASONS[r][1])}</a></td>'
        f'<td>{counts[r]}</td></tr>'
        for r in sorted(counts, key=lambda r: (REASONS[r][0], r)))
    sections = []
    for reason in sorted(counts, key=lambda r: (REASONS[r][0], r)):
        items = [f for f in findings if f['reason'] == reason]
        cells = []
        for f in items:
            text = []
            if 'card' in f:
                text.append(f"card {f['card']}")
            if 'label' in f:
                text.append(f"label <code>[{html.escape(f['label'])}]</code>")
            if 'predicted' in f:
                text.append(f"read <code>[{html.escape(f['predicted'])}]</code>")
            if f.get('detail'):
                text.append(html.escape(f['detail']))
            cells.append(
                f'<figure><a href="{html.escape(f["frame"])}"><img src="{html.escape(f["tile"])}" loading="lazy"></a>'
                f'<figcaption><b>{html.escape(f["dataset"])}</b><br>{html.escape(f["image"])}'
                f'<br>{" · ".join(text)}</figcaption></figure>')
        sections.append(f'<h2 id="{reason}">{html.escape(REASONS[reason][1])} ({len(items)})</h2>'
                        f'<div class="grid">{"".join(cells)}</div>')
    mode = 'rule checks only' if rules_only else 'rule and model checks'
    (output_dir / 'index.html').write_text(
        '<!doctype html><html><head><meta charset="utf-8"><title>Label audit</title>'
        '<style>body{font-family:sans-serif;margin:16px}table{border-collapse:collapse}'
        'td,th{border:1px solid #bbb;padding:4px 8px}code{font-size:1.15em}'
        '.grid{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:360px;font-size:12px;'
        'word-break:break-all}img{width:360px}</style></head><body>'
        f'<h1>Label audit: {len(findings)} suspects in {image_count} images from '
        f'{dataset_count} datasets ({mode})</h1>'
        '<p>Green boxes are labels, red boxes are model detections, and yellow marks the '
        'suspect. Click a tile for the full frame. Suspects are for review, not confirmed '
        'errors; severity 1 is most likely wrong.</p>'
        f'<table><tr><th>Severity</th><th>Reason</th><th>Count</th></tr>{summary}</table>'
        + ''.join(sections) + '</body></html>')
    with (output_dir / 'findings.csv').open('w', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['severity', 'reason', 'dataset', 'image', 'card', 'label',
                         'predicted', 'detail'])
        for f in findings:
            writer.writerow([REASONS[f['reason']][0], f['reason'], f['dataset'], f['image'],
                             f.get('card', ''), f.get('label', ''), f.get('predicted', ''),
                             f.get('detail', '')])


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('datasets', type=Path, nargs='+')
    parser.add_argument('--holdout', type=Path,
                        default=Path.home() / 'training/datasets/dataset-holdout')
    parser.add_argument('--output-dir', type=Path, default=Path('build/label-audit'))
    parser.add_argument('--rules-only', action='store_true',
                        help='Skip the model pass (no runner or models needed)')
    parser.add_argument('--runner', type=Path, default=Path('build/holdout-pipeline'))
    parser.add_argument('--boat-model', type=Path, default=Path('crewtimer-boat-train.onnx'))
    parser.add_argument('--card-model', type=Path, default=Path('bow_card_detect.onnx'))
    parser.add_argument('--number-model', type=Path, default=Path('bow_crnn_numeric.onnx'),
                        help='OCR model; numeric labels are used for the default numeric model')
    parser.add_argument('--iou', type=float, default=0.5)
    parser.add_argument('--min-ocr-confidence', type=float, default=0.9)
    parser.add_argument('--min-card-height', type=float, default=12,
                        help='Legible cards shorter than this many pixels are flagged')
    args = parser.parse_args()

    roots = [d.expanduser().resolve() for d in args.datasets]
    holdout = args.holdout.expanduser().resolve()
    roots = [r for r in roots if r != holdout]
    numeric = 'numeric' in args.number_model.name

    print('Hashing images for duplicate and holdout checks...', flush=True)
    owners = defaultdict(list)
    if holdout.is_dir():
        for path in image_paths(holdout):
            owners[file_hash(path)].append(('holdout', path.name))
    work = []
    for root in roots:
        for path in image_paths(root):
            digest = file_hash(path)
            owners[digest].append((root.name, path.name))
            work.append((root, path, digest))

    pipeline = None
    if not args.rules_only:
        pipeline = Pipeline(args.runner.resolve(), args.boat_model.resolve(),
                            args.card_model.resolve(), args.number_model.resolve())

    output_dir = args.output_dir
    (output_dir / 'tiles').mkdir(parents=True, exist_ok=True)
    (output_dir / 'frames').mkdir(exist_ok=True)
    findings = []
    ignore_alpha = {root: numeric or dataset_ignores_alpha(root) for root in roots}
    for index, (root, path, digest) in enumerate(work, 1):
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError(f'Cannot read image: {path}')
        height, width = image.shape[:2]
        try:
            boats, cards = annotations(root, path, width, height, ignore_alpha[root])
            found = rule_findings(boats, cards, args.min_card_height)
        except ValueError as error:
            boats, cards = None, None
            found = [dict(reason='bad_annotation', focus=None, detail=str(error))]
        others = [o for o in owners[digest] if o != (root.name, path.name)]
        if any(name == 'holdout' for name, _ in others):
            found.append(dict(reason='holdout_leak', focus=None))
        elif others:
            found.append(dict(reason='duplicate_image', focus=None,
                              detail='also in ' + ', '.join(f'{d}/{n}' for d, n in others)))
        detections = []
        if pipeline is not None and (boats is not None or cards is not None):
            detections = pipeline.detect(image)
            found += model_findings(boats, cards, detections, args.iou,
                                    args.min_ocr_confidence)
        if found:
            stem = f'{root.name}__{path.stem}'
            frame = f'frames/{stem}.jpg'
            cv2.imwrite(str(output_dir / frame),
                        tile(image, None, boats, cards, detections, 960))
            for number, f in enumerate(found):
                name = f'tiles/{stem}__{number}.jpg'
                cv2.imwrite(str(output_dir / name),
                            tile(image, f['focus'], boats, cards, detections))
                f.update(dataset=root.name, image=path.name, tile=name, frame=frame)
            findings += found
        if index % 100 == 0 or index == len(work):
            print(f'Audited {index}/{len(work)} images, {len(findings)} suspects', flush=True)
    if pipeline is not None:
        pipeline.close()

    findings.sort(key=lambda f: (REASONS[f['reason']][0], f['reason'], f['dataset'], f['image']))
    write_report(output_dir, findings, len(work), len(roots), args.rules_only)
    counts = defaultdict(int)
    for f in findings:
        counts[f['reason']] += 1
    for reason in sorted(counts, key=lambda r: (REASONS[r][0], r)):
        print(f'  {counts[reason]:5d}  {REASONS[reason][1]}')
    print(f'Report: {output_dir / "index.html"} (findings.csv lists every suspect)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
