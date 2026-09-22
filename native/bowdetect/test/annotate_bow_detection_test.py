import unittest

import numpy as np

from annotate_bow_detection import annotate_image
from test_boat_card_detection import Detection, NumberPrediction


class FakeDetector:
    def __init__(self, detections):
        self.detections = (
            list(detections)
            if detections and isinstance(detections[0], list)
            else [detections]
        )
        self.calls = []

    def detect(self, image, confidence):
        self.calls.append((image.shape, confidence))
        return self.detections[min(len(self.calls) - 1, len(self.detections) - 1)]


class FakeReader:
    def __init__(self, prediction):
        self.predictions = (
            list(prediction) if isinstance(prediction, (list, tuple)) else [prediction]
        )
        self.crops = []

    def read(self, crop):
        self.crops.append(crop.shape)
        return self.predictions[min(len(self.crops) - 1, len(self.predictions) - 1)]


class AnnotateBowDetectionTest(unittest.TestCase):
    def test_selects_best_card_and_maps_it_to_full_image(self):
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        boat = Detection((40, 20, 140, 80), 0.9)
        cards = [
            Detection((20, 20, 40, 40), 0.4),
            Detection((50, 25, 75, 50), 0.8),
        ]
        reader = FakeReader(NumberPrediction("17", 0.95))

        annotated, results = annotate_image(
            image, FakeDetector([boat]), FakeDetector(cards), reader
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].boat, boat)
        # The boat receives 15 px horizontal and 9 px vertical padding, so
        # its crop begins at (25, 11).
        self.assertEqual(results[0].card.box, (75, 36, 100, 61))
        self.assertEqual(results[0].number.text, "17")
        self.assertEqual(len(reader.crops), 1)
        self.assertFalse(np.array_equal(annotated, image))

    def test_accepts_low_confidence_card_when_ocr_is_confident(self):
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        boat = Detection((40, 20, 140, 80), 0.9)
        fallback_card = Detection((20, 20, 40, 40), 0.026)
        card_detector = FakeDetector([[], [fallback_card]])
        reader = FakeReader(NumberPrediction("2", 0.90))

        _, results = annotate_image(
            image, FakeDetector([boat]), card_detector, reader
        )

        self.assertEqual(results[0].number.text, "2")
        self.assertEqual(results[0].card.box, (45, 31, 65, 51))
        self.assertEqual([call[1] for call in card_detector.calls], [0.3, 0.02])

    def test_rejects_low_confidence_card_when_ocr_is_uncertain(self):
        image = np.zeros((50, 60, 3), dtype=np.uint8)
        boat = Detection((10, 10, 40, 35), 0.7)
        fallback_card = Detection((5, 5, 20, 20), 0.03)
        reader = FakeReader(NumberPrediction("2", 0.79))

        _, results = annotate_image(
            image, FakeDetector([boat]), FakeDetector([[], [fallback_card]]), reader
        )

        self.assertIsNone(results[0].card)
        self.assertIsNone(results[0].number)

    def test_returns_only_boat_when_no_card_candidate_exists(self):
        image = np.zeros((50, 60, 3), dtype=np.uint8)
        boat = Detection((10, 10, 40, 35), 0.7)
        reader = FakeReader(NumberPrediction("2", 0.99))

        _, results = annotate_image(
            image, FakeDetector([boat]), FakeDetector([]), reader
        )

        self.assertIsNone(results[0].card)
        self.assertIsNone(results[0].number)
        self.assertEqual(reader.crops, [])


if __name__ == "__main__":
    unittest.main()
