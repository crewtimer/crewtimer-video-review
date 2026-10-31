import unittest
from unittest.mock import patch

import numpy as np
from bow_ocr_labels import CHARACTERS, NUM_CLASSES
from train_bow_crnn import (
    CRNN_H,
    CRNN_W,
    LIBERATION_SANS_REGULAR_PATH,
    ROBOTO_CONDENSED_BOLD_PATH,
    BowCardDataset,
    ctc_greedy_decode,
    configure_vocabulary,
    is_three_digit_label,
    make_alpha_validation_samples,
    make_pipeline_sample,
    random_bow_label,
    render_text_mask,
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

    def test_synthetic_layout_squeezes_liberation_sans_horizontally(self):
        self.assertTrue(LIBERATION_SANS_REGULAR_PATH.is_file())
        full = synthetic_text_layout("129", 28, LIBERATION_SANS_REGULAR_PATH)
        squeezed = synthetic_text_layout(
            "129", 28, LIBERATION_SANS_REGULAR_PATH, 0.85
        )
        self.assertEqual(full["font"].getname(), ("Liberation Sans", "Regular"))
        self.assertEqual(squeezed["width"], round(full["width"] * 0.85))
        self.assertEqual(squeezed["height"], full["height"])
        mask = render_text_mask("129", squeezed)
        self.assertEqual(mask.shape, (squeezed["height"], squeezed["width"]))
        self.assertGreater(mask.max(), 0.9)

    def test_pipeline_samples_match_model_input_in_every_variant(self):
        import train_bow_crnn

        for context, sticker, low_res in [
            (0.0, 0.0, 0.0), (1.0, 1.0, 1.0), (1.0, 0.0, 1.0), (0.0, 1.0, 0.0)
        ]:
            with (
                patch.object(train_bow_crnn, "CARD_CONTEXT_FRACTION", context),
                patch.object(train_bow_crnn, "STICKER_FRACTION", sticker),
                patch.object(train_bow_crnn, "LOW_RESOLUTION_FRACTION", low_res),
            ):
                for label in ("7", "42", "129", "E128"):
                    for light_card in (True, False):
                        image = make_pipeline_sample(label, light_card=light_card)
                        self.assertEqual(image.shape, (CRNN_H, CRNN_W))
                        self.assertEqual(image.dtype, np.uint8)

    def test_three_digit_label_ignores_alpha_prefix(self):
        self.assertTrue(is_three_digit_label("129"))
        self.assertTrue(is_three_digit_label("E128"))
        self.assertFalse(is_three_digit_label("E43"))
        self.assertFalse(is_three_digit_label("7"))

    def test_real_pool_oversamples_three_digit_crops(self):
        dataset = BowCardDataset(
            n_synthetic=1, real_alpha_fraction=0.1, real_three_digit_fraction=0.2
        )
        image = np.zeros((CRNN_H, CRNN_W), dtype=np.uint8)
        dataset.real_samples = [(image, "4"), (image, "E1"), (image, "129")]
        dataset.real_alpha_samples = [(image, "E1")]
        dataset.real_three_digit_samples = [(image, "129")]
        cases = (
            (0.05, dataset.real_alpha_samples),
            (0.15, dataset.real_three_digit_samples),
            (0.35, dataset.real_samples),
        )
        for value, expected in cases:
            with patch("train_bow_crnn.random.random", return_value=value):
                self.assertIs(dataset._choose_real_pool(), expected)


if __name__ == "__main__":
    unittest.main()
