import unittest

from audit_labels import model_findings, rule_findings


def reasons(findings):
    return sorted(f['reason'] for f in findings)


class RuleFindingsTest(unittest.TestCase):
    def test_clean_labels_have_no_findings(self):
        boats = [[0, 100, 500, 200]]
        cards = [dict(box=[20, 120, 60, 150], text='12', legible=True)]
        self.assertEqual(rule_findings(boats, cards, 15), [])

    def test_fence_post_card_is_too_tall_for_its_boat(self):
        boats = [[0, 100, 500, 200]]
        cards = [dict(box=[20, 105, 120, 195], text='10', legible=True)]
        self.assertEqual(reasons(rule_findings(boats, cards, 15)), ['card_too_tall'])

    def test_card_outside_every_boat(self):
        boats = [[0, 100, 500, 200]]
        cards = [dict(box=[20, 400, 60, 430], text='12', legible=True)]
        self.assertEqual(reasons(rule_findings(boats, cards, 15)),
                         ['boat_without_card', 'card_outside_boat'])

    def test_small_legible_card_but_not_small_unreadable_card(self):
        boats = [[0, 100, 500, 200]]
        small = dict(box=[20, 120, 37, 133], text='272', legible=True)
        self.assertEqual(reasons(rule_findings(boats, [small], 15)),
                         ['small_legible_card'])
        small.update(text='', legible=False)
        self.assertEqual(rule_findings(boats, [small], 15), [])

    def test_boat_without_card_only_when_cards_are_annotated(self):
        boats = [[0, 100, 500, 200], [0, 300, 500, 400]]
        cards = [dict(box=[20, 120, 60, 150], text='12', legible=True)]
        self.assertEqual(reasons(rule_findings(boats, cards, 15)), ['boat_without_card'])
        self.assertEqual(rule_findings(boats, None, 15), [])


class ModelFindingsTest(unittest.TestCase):
    boats = [[0, 100, 500, 200]]
    cards = [dict(box=[20, 120, 60, 150], text='65', legible=True)]

    def detection(self, text, confidence=0.95, boat=None, card=None):
        return dict(boat=boat or self.boats[0], card=card or self.cards[0]['box'],
                    text=text, confidence=confidence)

    def test_agreement_has_no_findings(self):
        self.assertEqual(model_findings(self.boats, self.cards,
                                        [self.detection('65')], .5, .9), [])

    def test_confident_different_reading(self):
        found = model_findings(self.boats, self.cards, [self.detection('73')], .5, .9)
        self.assertEqual(reasons(found), ['ocr_disagrees'])
        self.assertEqual((found[0]['label'], found[0]['predicted']), ('65', '73'))

    def test_low_confidence_and_trimmed_readings_are_not_flagged(self):
        for detection in (self.detection('73', confidence=0.5), self.detection('165')):
            self.assertEqual(model_findings(self.boats, self.cards, [detection], .5, .9), [])

    def test_missed_and_unlabelled_boxes(self):
        stray = self.detection('12', boat=[600, 0, 900, 90], card=[620, 10, 660, 40])
        found = model_findings(self.boats, self.cards, [stray], .5, .9)
        self.assertEqual(reasons(found), ['boat_not_detected', 'card_not_detected',
                                          'unlabelled_boat', 'unlabelled_card'])


if __name__ == '__main__':
    unittest.main()
