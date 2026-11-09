import itertools,unittest
import numpy as np
from predict import pairings,rank_bounds,forecast

class ProofTests(unittest.TestCase):
 def test_bounds_match_exhaustive_all_outcomes_including_ties(self):
  pairs=[(0,1),(2,3),(0,2),(1,3)]
  for units in [[0,0,0,0],[4,1,2,3],[0,6,4,2]]:
   for target in range(4):
    best=5;worst=0
    for outcomes in itertools.product(range(3),repeat=len(pairs)):
     final=list(units)
     for (a,b),x in zip(pairs,outcomes):final[a]+=x;final[b]+=2-x
     best=min(best,1+sum(v>final[target] for i,v in enumerate(final) if i!=target))
     worst=max(worst,1+sum(v>=final[target] for i,v in enumerate(final) if i!=target))
    self.assertEqual(rank_bounds(units,pairs,target),[best,worst])
 def test_duplicate_or_unpaired_schedule_rejected(self):
  mapping={'1':'a','2':'b'}
  self.assertEqual(pairings([{'roster_id':1,'matchup_id':7},{'roster_id':2,'matchup_id':7}],mapping),[['a','b']])
  for rows in [[],[{'roster_id':1,'matchup_id':1}]*2,[{'roster_id':1,'matchup_id':1},{'roster_id':2,'matchup_id':2}]]:
   with self.assertRaises(ValueError):pairings(rows,mapping)
 def test_final_equal_pf_tie_not_arbitrarily_resolved(self):
  with self.assertRaisesRegex(ValueError,'commissioner'):forecast(self.data(False),100)
 def data(self,future=True):
  n=12
  return dict(ids=list(map(str,range(n))),names={str(i):str(i) for i in range(n)},scores=np.array([[100+i for i in range(n)],[90+i for i in range(n)]]),standings=[dict(owner_id=str(i),wins=1,losses=1,ties=0,points_for=200) for i in range(n)],future=[(14,[(i,i+1) for i in range(0,n,2)])] if future else [],year=2026,cutoff=13 if future else 14,source_hash='test',games_hash='test',schedule_hashes={})
 def test_reproducibility_probability_conservation_and_proof_not_simulation(self):
  d=self.data();a=forecast(d,200);b=forecast(d,200)
  self.assertEqual(a,b)
  self.assertAlmostEqual(sum(r['playoff_pct'] for r in a['teams']),800,places=2)
  for r in a['teams']:
   self.assertAlmostEqual(sum(r['seed_pct']),100,places=2)
   self.assertEqual(r['status'],'Not proven')
 def test_locks_and_elimination(self):
  pairs=[(i,i+1) for i in range(0,12,2)]
  self.assertLessEqual(rank_bounds([20]+[4]*11,pairs,0)[1],8)
  self.assertGreater(rank_bounds([0]+[20]*11,pairs,0)[0],8)

class FinishProofTests(unittest.TestCase):
 def test_fixed_record_bounds_match_exhaustive_outcomes(self):
  from predict import finish_bounds
  pairs=[(0,1),(2,3),(0,2),(1,3)];units=[2,0,1,3]
  for target in range(4):
   for k in range(3):
    ranks=[]
    for outcomes in itertools.product(range(3),repeat=len(pairs)):
     final=list(units)
     for (a,b),x in zip(pairs,outcomes):final[a]+=x;final[b]+=2-x
     if final[target]!=units[target]+2*k:continue
     ranks.append((1+sum(v>final[target] for i,v in enumerate(final) if i!=target),1+sum(v>=final[target] for i,v in enumerate(final) if i!=target)))
    self.assertEqual(finish_bounds(units,pairs,target,k),[min(r[0] for r in ranks),max(r[1] for r in ranks)])

if __name__=='__main__':unittest.main()
