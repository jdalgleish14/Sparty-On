import unittest
from late_paths import path_window, pf_requirement

class LatePathsTests(unittest.TestCase):
    def test_search_window(self):
        self.assertFalse(path_window(7)['ready_for_detailed_search'])
        self.assertTrue(path_window(11)['ready_for_detailed_search'])
        self.assertTrue(path_window(13)['ready_for_detailed_search'])
        self.assertEqual(path_window(14)['phase'],'final')
        with self.assertRaises(ValueError):path_window(15)
    def test_threshold_is_relative_until_own_score_known(self):
        r=pf_requirement('900.00','920.00')
        self.assertEqual(r['gap'],'-20.00')
        self.assertNotIn('rival_must_score_less_than',r)
        self.assertFalse(r['proves_playoff_spot'])
    def test_fixed_threshold_requires_own_score_and_preserves_equal_pf(self):
        r=pf_requirement('900.00','920.00','120.00')
        self.assertEqual(r['rival_must_score_less_than'],'100.00')
        self.assertEqual(r['operator'],'<')
        self.assertIn('PF tied',r['equality'])
        self.assertFalse(r['proves_playoff_spot'])
    def test_impossible_and_invalid_thresholds(self):
        self.assertFalse(pf_requirement(10,110,100)['possible_with_nonnegative_scores'])
        for value in ['NaN','Infinity',-1,'10.001','abc',None,True]:
            with self.assertRaises(ValueError):pf_requirement(value,100)
if __name__=='__main__':unittest.main()
