import unittest

from extract_card_training_crops import box_iou, detector_box_matches_annotation


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
