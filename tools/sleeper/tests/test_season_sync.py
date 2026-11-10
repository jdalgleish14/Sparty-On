"""End-to-end synthetic season transitions; no network or live-data writes."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fixtures as fx
import build as bd
import datafiles as df
import season_sync as ss
import verify as vf


def regular14():
    base=fx.load_base(); mapping=fx.owner_map(); ctx=fx.context(last_scored=14,start_week=1,playoff_week_start=15,playoff_teams=8)
    weeks=fx.raw_weeks(base)
    weeks.update({w:fx.synthetic_week(w) for w in range(5,15)})
    ds,_=bd.build_from_sleeper(base,mapping,ctx,weeks)
    return ds,mapping,ctx,weeks


def playoffs(ds,mapping):
    rid={oid:rid for rid,oid in mapping['rosters'].items()}
    seeds={r['rank']:rid[r['owner_id']] for r in ds['current_standings']}
    bracket=[]; weeks={}; win={}; lose={}
    def game(mid,rnd,a,b,refs=None,place=None):
        m=dict(m=mid,r=rnd,t1=a,t2=b,w=a,l=b)
        if refs:m.update(t1_from={'w':refs[0]},t2_from={'w':refs[1]})
        if place:m['p']=place
        bracket.append(m);win[mid]=a;lose[mid]=b
        week=14+rnd
        payload=weeks.setdefault(week,dict(league_id=mapping['league_id'],season=str(mapping['season']),week=week,matchups=[]))
        payload['matchups'].extend([dict(roster_id=a,matchup_id=mid,points=120+mid,custom_points=None),dict(roster_id=b,matchup_id=mid,points=90+mid,custom_points=None)])
    for i,(a,b) in enumerate(((1,8),(4,5),(2,7),(3,6)),1):game(i,1,seeds[a],seeds[b])
    game(5,2,win[1],win[2],(1,2));game(6,2,win[3],win[4],(3,4))
    game(7,3,win[5],win[6],(5,6),1)
    # Sleeper may include placement matches in the winners bracket; these must not count.
    bracket.append(dict(m=8,r=3,t1=lose[5],t2=lose[6],w=lose[5],l=lose[6],t1_from={'l':5},t2_from={'l':6},p=3))
    weeks[17]['matchups'].extend([dict(roster_id=lose[5],matchup_id=8,points=150,custom_points=None),dict(roster_id=lose[6],matchup_id=8,points=100,custom_points=None)])
    return bracket,weeks


def finished():
    ds,m,ctx,weeks=regular14(); bracket,post=playoffs(ds,m)
    ctx.update(last_scored_leg=17)
    m=ss.pin_users(m,ctx)
    return ss.derive_postseason(ds,m,ctx,bracket,post),m,ctx,{**weeks,**post},bracket


def write_dataset(ds,m,path):
    path=Path(path)
    for f,t in ss.bundle_text(ds,m).items():
        p=path/f;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(t)


class SeasonAutomation(unittest.TestCase):
    def test_rounds_advance_and_ignore_placement_games(self):
        ds,m,ctx,weeks=regular14(); old_history=[g for g in ds['games'] if g['year']<2026]
        bracket,post=playoffs(ds,m)
        for last,count in ((15,8),(16,12),(17,14)):
            ctx['last_scored_leg']=last
            ds=ss.derive_postseason(ds,m,ctx,bracket,post)
            self.assertEqual(len([g for g in ds['games'] if g['year']==2026 and g['stage']=='Postseason']),count)
            self.assertEqual([g for g in ds['games'] if g['year']<2026],old_history)
            with tempfile.TemporaryDirectory() as path:
                write_dataset(ds,m,path);self.assertEqual(vf.verify_dir(path),[])
        self.assertEqual(len([c for c in ds['championships'] if c['year']==2026]),1)
        self.assertEqual(bd.current_season(ds.site)['phase'],'Complete')
        again=ss.derive_postseason(ds,m,ctx,bracket,post)
        self.assertEqual(df.render(ds),df.render(again))

    def test_unscored_rounds_do_not_leak_api_winners(self):
        ds,m,ctx,_=regular14();bracket,post=playoffs(ds,m);ctx['last_scored_leg']=15
        out=ss.derive_postseason(ds,m,ctx,bracket,post)
        matches=bd.current_season(out.site)['playoff_bracket']
        self.assertTrue(all(x['winner_owner_id'] is None and x['team1_score'] is None for x in matches if x['week']>15))
        self.assertEqual(out['championships'],ds['championships'])

    def test_ties_missing_results_and_score_corrections_block(self):
        ds,m,ctx,_=regular14();bracket,post=playoffs(ds,m);ctx['last_scored_leg']=15
        for change in ('tie','winner','missing','duplicate'):
            b=copy.deepcopy(bracket);w=copy.deepcopy(post)
            if change=='tie':w[15]['matchups'][1]['points']=w[15]['matchups'][0]['points']
            if change=='winner':b[0]['w']=None
            if change=='missing':w[15]['matchups'].pop()
            if change=='duplicate':b.append(copy.deepcopy(b[0]))
            with self.subTest(change=change),self.assertRaises(bd.GateError):ss.derive_postseason(ds,m,ctx,b,w)
        ds=ss.derive_postseason(ds,m,ctx,bracket,post)
        post[15]['matchups'][0]['points']+=1
        with self.assertRaisesRegex(bd.GateError,'Previously published'):ss.derive_postseason(ds,m,ctx,bracket,post)

    def test_verifier_rejects_added_or_changed_postseason(self):
        ds,m,_,_,_=finished()
        for mutation in ('score','cutoff','champion','extra','advance'):
            out=ds.copy();cur=bd.current_season(out.site)
            if mutation=='score':cur['playoff_bracket'][0]['team1_score']+=1
            if mutation=='cutoff':cur['postseason_through_round']=2
            if mutation=='champion':out.site['championships'][-1]['champion_owner_id']='owner-ryan'
            if mutation=='extra':out.site['games'].append(copy.deepcopy(out.site['games'][-1]))
            if mutation=='advance':cur['playoff_bracket'][-1]['team1_owner_id']='owner-ryan'
            with self.subTest(mutation=mutation),self.assertRaises(bd.GateError):ss.validate_published_postseason(out.site)

    def test_rollover_initializes_week_one_and_remaps_by_stable_user(self):
        ds,m,ctx,weeks,_=finished(); old_games=copy.deepcopy(ds['games'])
        ctx=copy.deepcopy(ctx);ctx.update(league_id='999999',previous_league_id=m['league_id'],season='2027',last_scored_leg=1)
        # A different roster numbering must preserve the person, not assume old roster IDs.
        for roster in ctx['rosters']:roster['roster_id']+=20
        ctx['users']=[dict(user_id=r['owner_id'],team_name='New team '+r['owner_id']) for r in ctx['rosters']]
        week=copy.deepcopy(weeks[1]);week.update(league_id='999999',season='2027')
        for r in week['matchups']:r['roster_id']+=20
        out,newmap=ss.rollover(ds,m,ctx,{1:week})
        self.assertEqual(newmap['rosters'][21],m['rosters'][1])
        self.assertEqual(bd.current_season(out.site)['year'],2027)
        self.assertEqual(out.site['league']['current_season_through_week'],1)
        self.assertEqual([g for g in out['games'] if g['year']<=2026],old_games)
        self.assertEqual(next(s for s in out.site['seasons'] if s['year']==2026)['status'],'Complete')
        self.assertTrue(all(s['season_status']=='Complete' for s in out['ai_seasons'] if s['year']==2026))
        self.assertTrue(all(s['score_std_dev'] is None for s in out['ai_seasons'] if s['year']==2027))
        self.assertEqual(len([s for s in out['ai_league_years'] if s['year']==2027]),1)
        with tempfile.TemporaryDirectory() as path:
            write_dataset(out,newmap,path);self.assertEqual(vf.verify_dir(path),[])
            # A subsequent completed week resumes the established incremental sync.
            week2=copy.deepcopy(weeks[2]);week2.update(league_id='999999',season='2027')
            for r in week2['matchups']:r['roster_id']+=20
            ctx['last_scored_leg']=2
            nextds,_=bd.build_from_sleeper(out,newmap,ctx,{1:week,2:week2})
            write_dataset(nextds,newmap,path);self.assertEqual(vf.verify_dir(path),[])

    def test_unknown_owner_unlinked_league_and_rules_block_rollover(self):
        ds,m,ctx,weeks,_=finished()
        for change in ('owner','link','rules','preseason'):
            c=copy.deepcopy(ctx);c.update(league_id='9999',previous_league_id=m['league_id'],season='2027',last_scored_leg=1,start_week=1,playoff_week_start=15,playoff_teams=8)
            if change=='owner':c['rosters'][0]['owner_id']='stranger'
            if change=='link':c['previous_league_id']='other'
            if change=='rules':c['playoff_teams']=6
            if change=='preseason':c['last_scored_leg']=0
            with self.subTest(change=change),self.assertRaises(bd.GateError):ss.rollover(ds,m,c,weeks)

    def test_discovery_requires_direct_link_and_unique_successor(self):
        _,m,_,_,_=finished()
        wrong=dict(league_id='999',season='2027',previous_league_id='unrelated',name='Sparty On')
        self.assertIsNone(ss.successor(m,lambda _: [wrong]))
        good=dict(wrong,previous_league_id=m['league_id'])
        self.assertEqual(ss.successor(m,lambda _: [wrong,good])['league_id'],'999')
        with self.assertRaisesRegex(bd.GateError,'Multiple'):ss.successor(m,lambda _: [good,dict(good,league_id='1000')])

    def test_explicit_owner_changes_add_new_member_without_rewriting_history(self):
        ds,m,ctx,weeks,_=finished();ctx=copy.deepcopy(ctx)
        ctx.update(league_id='9999',previous_league_id=m['league_id'],season='2027',last_scored_leg=1)
        ctx['rosters'][0]['owner_id']='new-user'
        ctx['users']=[dict(user_id='new-user',team_name='New member team')]
        week=copy.deepcopy(weeks[1]);week.update(league_id='9999',season='2027')
        changes=dict(season=2027,league_id='9999',owners={'new-user':dict(owner_id='owner-new-member',owner_name='New Member')})
        out,newmap=ss.rollover(ds,m,ctx,{1:week},changes)
        self.assertEqual(newmap['rosters'][1],'owner-new-member')
        self.assertIn('owner-new-member',bd.current_season(out.site)['roster_owner_ids'])
        self.assertNotIn(m['rosters'][1],bd.current_season(out.site)['roster_owner_ids'])
        self.assertEqual([g for g in out['games'] if g['year']<=2026],ds['games'])
        with tempfile.TemporaryDirectory() as path:
            write_dataset(out,newmap,path);self.assertEqual(vf.verify_dir(path),[])
        changes['season']=2028
        with self.assertRaises(bd.GateError):ss.rollover(ds,m,ctx,{1:week},changes)

    def test_full_runner_rolls_over_archives_and_survives_a_second_run(self):
        ds,m,ctx,weeks,bracket=finished()
        newctx=copy.deepcopy(ctx);newctx.update(league_id='9999',previous_league_id=m['league_id'],season='2027',last_scored_leg=1)
        nextweek=copy.deepcopy(weeks[1]);nextweek.update(league_id='9999',season='2027')
        responses={'/state/nfl':{}}
        for c in (ctx,newctx):
            lid=c['league_id']
            responses[f'/league/{lid}']=dict(league_id=lid,season=c['season'],status=c['status'],total_rosters=12,previous_league_id=c.get('previous_league_id'),settings={k:c[k] for k in ('start_week','playoff_week_start','playoff_teams','last_scored_leg')})
            responses[f'/league/{lid}/rosters']=c['rosters'];responses[f'/league/{lid}/users']=c['users']
        for w,value in weeks.items():responses[f"/league/{m['league_id']}/matchups/{w}"]=value['matchups']
        responses[f"/league/{m['league_id']}/winners_bracket"]=bracket
        responses['/league/9999/matchups/1']=nextweek['matchups']
        for uid in m['sleeper_user_ids'].values():responses[f'/user/{uid}/leagues/nfl/2027']=[responses['/league/9999']]
        with tempfile.TemporaryDirectory() as path:
            write_dataset(ds,m,path)
            out,changed,notes=ss.run(path,lambda p:responses[p],lambda:'2027-09-14T12:00:00+00:00')
            self.assertEqual(bd.current_season(out.site)['year'],2027)
            self.assertIn('sleeper/archive/2026/site-data.js',changed)
            self.assertIn('sleeper/archive/2026/raw/winners-bracket.json',changed)
            self.assertIn('sleeper/raw/2027/week-01.json',changed)
            for f,t in changed.items():
                target=Path(path)/f;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(t)
            self.assertEqual(vf.verify_dir(path),[])
            self.assertEqual(vf.verify_dir(str(Path(path)/'sleeper/archive/2026')),[])
            _,changed,_=ss.run(path,lambda p:responses[p],lambda:'2027-09-15T12:00:00+00:00')
            self.assertEqual(changed,{})

    def test_end_to_end_run_publishes_no_bytes_until_verified_and_is_idempotent(self):
        base=fx.load_base();m=fx.owner_map();ctx=fx.context(last_scored=4)
        league=dict(league_id=m['league_id'],season='2026',status='in_season',total_rosters=12,
                    settings=dict(last_scored_leg=4,start_week=1,playoff_week_start=15,playoff_teams=8))
        responses={f"/league/{m['league_id']}":league,f"/league/{m['league_id']}/rosters":ctx['rosters'],f"/league/{m['league_id']}/users":[], '/state/nfl':{}}
        for w,p in fx.raw_weeks(base).items():responses[f"/league/{m['league_id']}/matchups/{w}"]=p['matchups']
        with tempfile.TemporaryDirectory() as path:
            write_dataset(base,m,path)
            before={str(p.relative_to(path)):p.read_bytes() for p in Path(path).rglob('*') if p.is_file()}
            _,outputs,_=ss.run(path,lambda p:responses[p],lambda:'2026-10-08T12:00:00+00:00')
            self.assertEqual(before,{str(p.relative_to(path)):p.read_bytes() for p in Path(path).rglob('*') if p.is_file()})
            for f,t in outputs.items():
                p=Path(path)/f;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(t)
            _,outputs,_=ss.run(path,lambda p:responses[p],lambda:'2026-10-09T12:00:00+00:00')
            self.assertEqual(outputs,{})
            responses[f"/league/{m['league_id']}/matchups/1"][0]['points']+=20
            with self.assertRaises(bd.GateError):ss.run(path,lambda p:responses[p])
            self.assertEqual(vf.verify_dir(path),[])


if __name__=='__main__':unittest.main()
