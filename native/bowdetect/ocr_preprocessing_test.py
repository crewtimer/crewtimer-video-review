import unittest

import cv2
import numpy as np

from ocr_preprocessing import normalize_grayscale_card


class GrayscalePreprocessingTest(unittest.TestCase):
    def test_preserves_grayscale_detail(self):
        image = np.full((40, 50, 3), 155, dtype=np.uint8)
        cv2.putText(
            image,
            "38",
            (3, 31),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (45, 45, 45),
            2,
            cv2.LINE_AA,
        )
        normalized = normalize_grayscale_card(image)
        self.assertEqual(normalized.shape, (48, 60))
        self.assertEqual(normalized.dtype, np.uint8)
        self.assertGreater(len(np.unique(normalized)), 32)
        self.assertGreater(np.count_nonzero((normalized > 20) & (normalized < 235)), 200)

    def test_normalizes_dark_card_polarity(self):
        image = np.full((40, 50, 3), 55, dtype=np.uint8)
        cv2.putText(
            image,
            "7",
            (15, 32),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.1,
            (220, 220, 220),
            2,
            cv2.LINE_AA,
        )
        normalized = normalize_grayscale_card(image)
        center = normalized[10:38, 12:48]
        self.assertGreater(float(center.mean()), 127)


if __name__ == "__main__":
    unittest.main()
