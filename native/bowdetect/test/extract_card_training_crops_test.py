import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from extract_card_training_crops import box_iou, detector_box_matches_annotation, extract_dataset


class DatasetIgnoreAlphaTest(unittest.TestCase):
    def test_config_controls_labels_in_both_splits(self):
        for config in (None, {}, {"ignoreAlpha": False}, {"ignoreAlpha": "true"}, {"ignoreAlpha": True}):
            for validation_percent, split in ((0, "train"), (100, "validation")):
                with self.subTest(config=config, split=split), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp) / "dataset"
                    (root / "images").mkdir(parents=True)
                    (root / "card-labels").mkdir()
                    if config is not None:
                        (root / "config.json").write_text(json.dumps(config))
                    cv2.imwrite(str(root / "images" / "card.png"), np.full((30, 40, 3), 180, dtype=np.uint8))
                    cards = [
                        {"value": "E043", "prefix": "E", "digits": "043"},
                        {"prefix": "Z", "digits": "12"},
                        {"digits": "a7"},
                        {"digits": "009"},
                    ]
                    for card in cards:
                        card["box"] = {"x": 5, "y": 5, "width": 20, "height": 15}
                    sidecar = root / "card-labels" / "card.json"
                    original = json.dumps({"image": "card.png", "cards": cards})
                    sidecar.write_text(original)
                    output = Path(tmp) / "output"
                    stats = extract_dataset(root, output, validation_percent, None)
                    self.assertEqual(stats["written"], 4)
                    labels = {path.name.split("_")[0] for path in (output / split).glob("*.png")}
                    expected = {"043", "12", "7", "009"} if config == {"ignoreAlpha": True} else {"E043", "Z12", "A7", "009"}
                    self.assertEqual(labels, expected)
                    self.assertEqual(sidecar.read_text(), original)


class DetectorAnnotationGateTest(unittest.TestCase):
    def setUp(self):
        self.annotation = {"x": 100, "y": 50, "width": 20, "height": 12}

    def test_accepts_close_detector_box(self):
        detected = {"x": 98, "y": 49, "width": 24, "height": 14}
        self.assertGreater(box_iou(detected, self.annotation), 0.5)
        self.assertTrue(detector_box_matches_annotation(detected, self.annotation))

    def test_rejects_nearby_non_overlapping_box(self):
        detected = {"x": 124, "y": 50, "width": 10, "height": 12}
        self.assertEqual(box_iou(detected, self.annotation), 0.0)
        self.assertFalse(detector_box_matches_annotation(detected, self.annotation))

    def test_rejects_large_box_with_insufficient_overlap(self):
        detected = {"x": 60, "y": 20, "width": 100, "height": 80}
        self.assertLess(box_iou(detected, self.annotation), 0.20)
        self.assertFalse(detector_box_matches_annotation(detected, self.annotation))

    def test_rejects_invalid_box(self):
        detected = {"x": 100, "y": 50, "width": 0, "height": 12}
        self.assertFalse(detector_box_matches_annotation(detected, self.annotation))


if __name__ == "__main__":
    unittest.main()
