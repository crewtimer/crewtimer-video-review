import json
import tempfile
import unittest
from pathlib import Path

from validate_holdout import annotations, match_boxes, metrics, score, summarize


class HoldoutValidationTest(unittest.TestCase):
    def test_duplicate_detections_are_false_positives(self):
        box = [0, 0, 10, 10]
        detections = [dict(boat=box, card=box, text='12')] * 2
        result = score([box], [dict(box=box, text='12', legible=True)], detections, .5)
        self.assertEqual(result['cards']['tp'], 1)
        self.assertEqual(result['cards']['fp'], 1)
        self.assertEqual(result['numbers'], dict(total=1, matched=1, correct=1))

    def test_missed_and_illegible_cards(self):
        cards = [dict(box=[0, 0, 10, 10], text='7', legible=True),
                 dict(box=[20, 20, 30, 30], text='', legible=False)]
        result = score([], cards, [], .5)
        self.assertEqual(result['cards']['fn'], 2)
        self.assertEqual(result['numbers'], dict(total=1, matched=0, correct=0))
        self.assertEqual(result['number_errors'][0]['reason'], 'card_missed')

    def test_correct_text_in_wrong_place_is_not_correct(self):
        result = score(None, [dict(box=[0, 0, 10, 10], text='7', legible=True)],
                       [dict(card=[30, 30, 40, 40], text='7')], .5)
        self.assertEqual(result['numbers']['correct'], 0)
        self.assertNotIn('boats', result)

    def test_wrong_text_on_matched_card(self):
        result = score(None, [dict(box=[0, 0, 10, 10], text='E7', legible=True)],
                       [dict(card=[0, 0, 10, 10], text='7')], .5)
        self.assertEqual(result['numbers'], dict(total=1, matched=1, correct=0))
        self.assertEqual(result['number_errors'][0]['reason'], 'wrong_text')

    def test_zero_denominators(self):
        self.assertIsNone(metrics(0, 0, 0)['precision'])
        self.assertIsNone(metrics(0, 0, 0)['recall'])
        self.assertEqual(match_boxes([], [], .5), [])

    def test_summarizes_each_model_run(self):
        rows = [score([], [dict(box=[0, 0, 10, 10], text='7', legible=True)],
                      [dict(boat=[0, 0, 0, 0], card=[0, 0, 10, 10],
                            text='7')], .5)]
        result = summarize(rows, 2)
        self.assertEqual(result['cards']['scored_images'], 1)
        self.assertEqual(result['cards']['unannotated_images'], 1)
        self.assertEqual(result['numbers']['end_to_end_accuracy'], 1.0)

    def test_last_digit_only_compares_expected_and_predicted_final_digits(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'card-labels').mkdir()
            image = root / 'images' / 'sample.png'
            sidecar = root / 'card-labels/sample.json'
            sidecar.write_text(json.dumps({
                'image': 'sample.png',
                'width': 100,
                'height': 50,
                'cards': [{
                    'box': {'x': 1, 'y': 2, 'width': 10, 'height': 12},
                    'value': 'E42',
                    'legible': True,
                }],
            }))
            _, cards = annotations(
                root, image, 100, 50, False, last_digit_only=True
            )
        self.assertEqual(cards[0]['text'], '2')
        detection = dict(card=[1, 2, 11, 14], text='72')
        result = score(None, cards, [detection], .5, last_digit_only=True)
        self.assertEqual(result['numbers']['correct'], 1)
        self.assertEqual(result['number_errors'], [])

        detection['text'] = '73'
        result = score(None, cards, [detection], .5, last_digit_only=True)
        self.assertEqual(result['numbers']['correct'], 0)
        self.assertEqual(result['number_errors'][0]['predicted'], '73')

    def test_annotation_coverage_and_pose_labels(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            image = root / 'images' / 'sample.png'
            self.assertEqual(annotations(root, image, 100, 50, False), (None, None))
            (root / 'labels').mkdir()
            label = root / 'labels/sample.txt'
            label.write_text('0 0.5 0.5 0.4 0.4 0.1 0.2 2\n')
            boats, cards = annotations(root, image, 100, 50, False)
            self.assertEqual(boats, [[30, 15, 70, 35]])
            self.assertIsNone(cards)
            label.write_text('')
            self.assertEqual(annotations(root, image, 100, 50, False)[0], [])
            (root / 'card-labels').mkdir()
            sidecar = root / 'card-labels/sample.json'
            sidecar.write_text(json.dumps(dict(image='sample.png', width=99, height=50, cards=[])))
            warnings = []
            self.assertEqual(annotations(root, image, 100, 50, False, warnings), ([], None))
            self.assertIn('scoring excluded', warnings[0])


if __name__ == '__main__':
    unittest.main()
