import unittest

from contrast_imdb import close_match, matched, norm_name


class NameMatchTests(unittest.TestCase):
    def test_accents_and_punctuation_fold(self):
        self.assertEqual(norm_name("Jesús Franco"), "jesus franco")
        self.assertEqual(norm_name("P.J. Soles"), "p j soles")
        self.assertEqual(norm_name("Bill Skarsgård"), "bill skarsgard")

    def test_close_match_accepts_a_prefix_and_rejects_a_different_surname(self):
        self.assertTrue(close_match("rob carpenter", "robert carpenter"))
        self.assertTrue(close_match("p j soles", "pj soles"))
        self.assertFalse(close_match("bob clark", "robert wise"))
        self.assertTrue(matched("rob carpenter", {"robert carpenter"}, close=True))
        self.assertFalse(matched("rob carpenter", {"robert carpenter"}, close=False))


if __name__ == "__main__":
    unittest.main()
