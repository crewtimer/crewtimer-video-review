import unittest
from unittest.mock import patch

import numpy as np
from bow_ocr_labels import CHARACTERS, NUM_CLASSES
from train_bow_crnn import (
    ROBOTO_CONDENSED_BOLD_PATH,
    ctc_greedy_decode,
    configure_vocabulary,
    make_alpha_validation_samples,
    random_bow_label,
    synthetic_text_layout,
    training_label,
)


class BowCrnnCharsetTest(unittest.TestCase):
    def tearDown(self):
        configure_vocabulary("alphanumeric")

    def test_ctc_decode_maps_blank_digits_and_letters(self):
        classes = [0, 15, 15, 0, 2, 0, 10, 0, 10]
        logits = np.full((len(classes), NUM_CLASSES), -10.0, dtype=np.float32)
        logits[np.arange(len(classes)), classes] = 10.0
        self.assertEqual(ctc_greedy_decode(logits), "E199")

    def test_synthetic_generator_can_add_alpha_prefix(self):
        with (
            patch("train_bow_crnn.random_numeric_string", return_value="199"),
            patch("train_bow_crnn.random.random", return_value=0.0),
            patch("train_bow_crnn.random.choice", return_value="Z"),
        ):
            self.assertEqual(random_bow_label(), "Z199")

    def test_every_character_has_a_nonblank_model_class(self):
        for expected_class, character in enumerate(CHARACTERS, start=1):
            logits = np.full((1, NUM_CLASSES), -10.0, dtype=np.float32)
            logits[0, expected_class] = 10.0
            self.assertEqual(ctc_greedy_decode(logits), character)

    def test_validation_samples_cover_every_alpha_prefix(self):
        labels = [label for _, label in make_alpha_validation_samples()]
        self.assertEqual(
            {label[0] for label in labels}, set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        )
        self.assertEqual(len(labels), 26 * 6)

    def test_numeric_vocabulary_strips_prefixes_and_uses_eleven_classes(self):
        import train_bow_crnn

        configure_vocabulary("numeric")
        self.assertEqual(train_bow_crnn.CHARACTERS, "0123456789")
        self.assertEqual(train_bow_crnn.NUM_CLASSES, 11)
        self.assertEqual(training_label("E43"), "43")
        self.assertEqual(make_alpha_validation_samples(), [])

    def test_synthetic_layout_uses_roboto_condensed_bold(self):
        self.assertTrue(ROBOTO_CONDENSED_BOLD_PATH.is_file())
        layout = synthetic_text_layout("D128", 28)
        self.assertEqual(layout["font"].getname(), ("Roboto Condensed", "Bold"))
        self.assertGreater(layout["width"], 0)
        self.assertGreater(layout["height"], 0)


if __name__ == "__main__":
    unittest.main()
