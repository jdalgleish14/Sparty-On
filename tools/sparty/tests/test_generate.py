"""Independent statistical fixtures, bounded selection and transactional failure tests."""
import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate as gen


def fixture():
    owners=[{'owner_id':c,'owner_name':c.upper()} for c in 'abcd']
    seasons=[{'year':2024,'status':'Complete','team_count':4,'regular_season_weeks':2,'roster_owner_ids':list('abcd')},
             {'year':2025,'status':'Current','team_count':4,'regular_season_weeks':2,'roster_owner_ids':list('abcd')}]
    games=[]
    for year,week,matchups in [(2024,1,[('a','b',100,90),('c','d',110,80)]),
                               (2024,2,[('a','c',120,100),('b','d',90,80)]),
                               (2025,1,[('a','b',999,80),('c','d',90,70)])]:
        for a,b,pf,pa in matchups:
            gid=f'{year}-{week}-{a}-{b}'
            for o,opp,p,q in [(a,b,pf,pa),(b,a,pa,pf)]:
                games.append({'game_id':gid,'year':year,'stage':'Regular Season','week':week,'round':None,
                              'owner_id':o,'opponent_owner_id':opp,'owner_name':o.upper(),'opponent_owner_name':opp.upper(),
                              'team':o,'opponent_team':opp,'points_for':p,'points_against':q,'margin':p-q,
                              'result':'W' if p>q else 'L' if p<q else 'T'})
    return {'owners':owners,'seasons':seasons,'games':games,'championships':[],
            'league':{'current_season_through_week':1,'generated_at_utc':'2025-09-10T00:00:00Z'},
            'validation_report':{'status':'PASS','checks':[{'status':'PASS'}],
                                 'publication_cutoff':{'current_season_through_week':1},
                                 'counts':{'game_rows':len(games),'all_games':len(games)//2}}}


class GeneratorTests(unittest.TestCase):
    def rows(self, registry, template):
        return [r for r in registry.candidates if r['template']==template]

    def test_current_games_count_but_current_seasons_do_not(self):
        registry=gen.build_registry(fixture())
        self.assertEqual(self.rows(registry,'games.high')[0]['evidence']['value'],999)
        self.assertEqual(self.rows(registry,'season.points')[0]['evidence']['value'],220)
        self.assertEqual(self.rows(registry,'career.wins')[0]['evidence']['value'],3)
        self.assertTrue(all('2025/' not in source for r in self.rows(registry,'season.points') for source in r['evidence']['sources']))

    def test_all_play_expected_wins_and_luck(self):
        rows=self.rows(gen.build_registry(fixture()),'luck.expected')
        # A ranks second then first: 2/3 + 1 = 1 2/3 expected wins.
        self.assertAlmostEqual(rows[0]['evidence']['value'],5/3)
        row=self.rows(gen.build_registry(fixture()),'luck.lucky')[0]
        self.assertAlmostEqual(row['evidence']['value'],1/3)

    def test_matchups_not_double_counted(self):
        rows=self.rows(gen.build_registry(fixture()),'rivalries.meetings')
        self.assertEqual(rows[0]['evidence']['value'],2)
        weeks=self.rows(gen.build_registry(fixture()),'league.high_total')
        self.assertEqual(weeks[0]['evidence']['value'],1239)

    def test_equal_records_are_tied(self):
        rows=self.rows(gen.build_registry(fixture()),'games.losing_low')
        self.assertIn('ties for No. 2',rows[1]['text'])
        self.assertGreater(len(rows[1]['evidence']['sources']),1)

    def test_expected_wins_give_half_credit_for_equal_scores(self):
        site=fixture()
        # C and A now both score 100 in week one, without a tied matchup.
        for g in site['games']:
            if g['year']==2024 and g['week']==1 and g['owner_id']=='c':g['points_for']=100;g['margin']=20
            if g['year']==2024 and g['week']==1 and g['owner_id']=='d':g['points_against']=100;g['margin']=-20
        rows=self.rows(gen.build_registry(site),'luck.expected')
        self.assertAlmostEqual(rows[0]['evidence']['value'],(2.5/3)+1)

    def test_streak_crosses_year_boundary(self):
        row=self.rows(gen.build_registry(fixture()),'streaks.wins')[0]
        self.assertEqual(row['evidence']['value'],3)
        self.assertIn('2024 Week 1 to 2025 Week 1',row['text'])

    def test_rates_exclude_small_samples(self):
        registry=gen.build_registry(fixture())
        self.assertFalse(self.rows(registry,'career.win_pct'))
        self.assertFalse(self.rows(registry,'rivalries.dominance'))

    def test_rejects_partial_weeks_and_nonfinite_scores(self):
        for mode in ('partial','nan','future','margin','cutoff'):
            with self.subTest(mode=mode):
                site=fixture()
                if mode=='partial':site['games'].pop()
                if mode=='nan':site['games'][0]['points_for']=float('nan')
                if mode=='future':site['seasons'][0]['status']='Future'
                if mode=='margin':site['games'][0]['margin']=11
                if mode=='cutoff':site['league']['current_season_through_week']=2
                with self.assertRaises(ValueError):gen.collection(site)

    def test_real_collection_is_bounded_and_covers_categories(self):
        site=gen.df.load(str(gen.ROOT/'site-data')).site
        result=gen.collection(site)
        self.assertEqual(len(result['sayings']),200)
        self.assertEqual(result['categories'],gen.TARGETS)
        self.assertGreaterEqual(result['template_count'],100)
        self.assertGreaterEqual(result['templates_used'],95)
        self.assertLess(len(gen.serialize(result).encode()),gen.MAX_BYTES)
        self.assertEqual(result,gen.collection(site))

    def test_real_top_score_matches_independent_max(self):
        site=gen.df.load(str(gen.ROOT/'site-data')).site
        row=self.rows(gen.build_registry(site),'games.high')[0]
        self.assertEqual(row['evidence']['value'],max(g['points_for'] for g in site['games']))

    def test_real_career_playoff_season_and_rivalry_extrema(self):
        site=gen.df.load(str(gen.ROOT/'site-data')).site
        registry=gen.build_registry(site)
        games=site['games']
        owner_ids={g['owner_id'] for g in games}
        career_wins=max(sum(g['result']=='W' for g in games if g['owner_id']==o) for o in owner_ids)
        self.assertEqual(self.rows(registry,'career.wins')[0]['evidence']['value'],career_wins)
        complete={s['year'] for s in site['seasons'] if s['status']=='Complete'}
        totals={}
        for g in games:
            if g['year'] in complete and g['stage']=='Regular Season':
                k=(g['year'],g['owner_id']);totals[k]=totals.get(k,0)+gen.cents(g['points_for'])
        self.assertEqual(self.rows(registry,'season.points')[0]['evidence']['value'],max(totals.values())/100)
        titles={o:sum(c['champion_owner_id']==o for c in site['championships']) for o in owner_ids}
        self.assertEqual(self.rows(registry,'playoffs.titles')[0]['evidence']['value'],max(titles.values()))
        meetings={}
        for g in games:
            if g['owner_id']<g['opponent_owner_id']:
                pair=(g['owner_id'],g['opponent_owner_id']);meetings[pair]=meetings.get(pair,0)+1
        self.assertEqual(self.rows(registry,'rivalries.meetings')[0]['evidence']['value'],max(meetings.values()))

    def test_integrity_failure_regenerates_instead_of_accepting_edited_output(self):
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp)/'sparty-records.js'
            result,_=gen.generate(gen.ROOT/'site-data',output)
            changed=copy.deepcopy(result);changed['sayings'][0]['text']='Invented record'
            output.write_text(gen.serialize(changed))
            repaired,did_write=gen.generate(gen.ROOT/'site-data',output)
            self.assertTrue(did_write);self.assertEqual(result,repaired)

    def test_conversational_copy_preserves_record_context(self):
        registry=gen.build_registry(fixture())
        high=self.rows(registry,'games.high')[0]
        self.assertIn('put up 999.00 points',high['text'])
        self.assertIn('highest individual score',high['text'])
        self.assertNotIn(' — #',high['text'])
        self.assertIn('Completed regular seasons only',self.rows(registry,'season.points')[0]['text'])

    def test_failure_preserves_previous_output(self):
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp)/'sparty-records.js';output.write_text('LAST VALID COLLECTION')
            with patch.object(gen.core_verify,'verify_dir',return_value=['bad source']):
                with self.assertRaises(ValueError):gen.generate(gen.ROOT/'site-data',output)
            self.assertEqual(output.read_text(),'LAST VALID COLLECTION')
            with patch.object(gen,'validate_collection',side_effect=ValueError('invalid candidate')):
                with self.assertRaises(ValueError):gen.generate(gen.ROOT/'site-data',output)
            self.assertEqual(output.read_text(),'LAST VALID COLLECTION')

    def test_rebuild_replaces_and_no_change_does_not_write(self):
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp)/'sparty-records.js'
            first,changed=gen.generate(gen.ROOT/'site-data',output)
            self.assertTrue(changed);stamp=output.stat().st_mtime_ns
            second,changed=gen.generate(gen.ROOT/'site-data',output)
            self.assertFalse(changed);self.assertEqual(stamp,output.stat().st_mtime_ns)
            self.assertEqual(first,second)
            self.assertEqual(len(json.loads(output.read_text()[len(gen.PREFIX):].strip().rstrip(';'))['sayings']),200)

    def test_input_fingerprint_changes_on_correction(self):
        site=fixture();a=gen.source_check(site);sha=gen.fingerprint(site)
        site['games'][0]['points_for']+=1
        self.assertNotEqual(a,gen.source_check(site))
        self.assertNotEqual(sha,gen.fingerprint(site))

if __name__=='__main__':unittest.main()
