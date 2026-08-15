import tempfile
import unittest
from pathlib import Path

from build_card_detector_dataset import (
    box_iou,
    boxes_intersect,
    read_yolo_boat_boxes,
)


class BoatNegativeGeometryTest(unittest.TestCase):
    def test_box_iou(self):
        first = {"x": 0, "y": 0, "width": 10, "height": 10}
        second = {"x": 5, "y": 0, "width": 10, "height": 10}
        self.assertAlmostEqual(box_iou(first, second), 1 / 3)

    def test_touching_edges_do_not_intersect(self):
        first = {"x": 0, "y": 0, "width": 10, "height": 10}
        second = {"x": 10, "y": 0, "width": 10, "height": 10}
        self.assertFalse(boxes_intersect(first, second))

    def test_reads_normalized_yolo_boat_box(self):
        with tempfile.TemporaryDirectory() as directory:
            label = Path(directory) / "frame.txt"
            label.write_text("0 0.5 0.5 0.25 0.5\n")
            boxes = read_yolo_boat_boxes(label, 200, 100)
        self.assertEqual(len(boxes), 1)
        self.assertAlmostEqual(boxes[0]["x"], 75)
        self.assertAlmostEqual(boxes[0]["y"], 25)
        self.assertAlmostEqual(boxes[0]["width"], 50)
        self.assertAlmostEqual(boxes[0]["height"], 50)


if __name__ == "__main__":
    unittest.main()
