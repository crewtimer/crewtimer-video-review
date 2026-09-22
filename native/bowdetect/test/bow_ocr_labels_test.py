import unittest

from bow_ocr_labels import (
    ALPHA_PREFIXES,
    CHARACTERS,
    DIGITS,
    NUM_CLASSES,
    NUMERIC_NUM_CLASSES,
    bow_label_from_card,
    characters_for_class_count,
    is_valid_bow_label,
    normalize_bow_label,
)


class BowOcrLabelsTest(unittest.TestCase):
    def test_vocabulary_contains_only_digits_and_uppercase_letters(self):
        self.assertEqual(CHARACTERS, DIGITS + ALPHA_PREFIXES)
        self.assertNotIn("-", CHARACTERS)
        self.assertNotIn(" ", CHARACTERS)
        self.assertEqual(NUM_CLASSES, 37)
        self.assertEqual(NUMERIC_NUM_CLASSES, 11)

    def test_selects_vocabulary_from_model_class_count(self):
        self.assertEqual(characters_for_class_count(11), DIGITS)
        self.assertEqual(characters_for_class_count(37), CHARACTERS)
        with self.assertRaisesRegex(ValueError, "Unsupported bow OCR class count"):
            characters_for_class_count(12)

    def test_accepts_numeric_and_single_prefix_labels(self):
        for label in ("0", "7", "043", "A1", "E43", "Z999"):
            with self.subTest(label=label):
                self.assertTrue(is_valid_bow_label(label))

    def test_normalizes_lowercase_prefix(self):
        self.assertEqual(normalize_bow_label(" z199 "), "Z199")
        self.assertTrue(is_valid_bow_label("z199"))

    def test_rejects_non_prefix_letters_and_extra_characters(self):
        for label in ("", "A", "1A", "AA1", "A1234", "A-1", "A 1"):
            with self.subTest(label=label):
                self.assertFalse(is_valid_bow_label(label))

    def test_reads_full_value_before_numeric_component(self):
        card = {"value": "D6", "digits": "6", "prefix": "D"}
        self.assertEqual(bow_label_from_card(card), "D6")

    def test_assembles_prefix_and_digits_without_value(self):
        card = {"digits": "6", "prefix": "D"}
        self.assertEqual(bow_label_from_card(card), "D6")

    def test_ignore_alpha_removes_only_leading_letters(self):
        for value, expected in ((" ab043 ", "043"), ("009", "009"), ("A", ""), ("1A", "1A"), ("A-1", "-1")):
            with self.subTest(value=value):
                self.assertEqual(
                    bow_label_from_card({"value": value}, ignore_alpha=True), expected
                )


if __name__ == "__main__":
    unittest.main()
