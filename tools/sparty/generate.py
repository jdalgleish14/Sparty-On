#!/usr/bin/env python3
"""Verified, bounded mascot facts. Standard library only; no network calls."""
import argparse
from collections import Counter, defaultdict
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import os

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'sleeper'))
import datafiles as df
import verify as core_verify

VERSION = '1.0.0'
PREFIX = 'window.SPARTY_RECORDS = '
TARGETS = {'games': 30, 'career': 30, 'season': 30, 'playoffs': 25,
           'rivalries': 25, 'streaks': 25, 'luck': 20, 'league': 15}
CAP = 200
MAX_BYTES = 180_000
ROUND_ORDER = {'Quarterfinal': 1, 'Semifinal': 2, 'Championship': 3}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def cents(value):
    return int(Decimal(str(value)) * 100)


def fmt(value, unit):
    if unit == 'pct':
        return f'{value * 100:.1f}%'
    if unit == 'points':
        return f'{value:.2f} points'
    if unit == 'signed':
        return f'{value:+.2f} wins'
    return str(int(value)) if value == int(value) else f'{value:.2f}'


def chronology(g):
    return (g['year'], 0 if g['stage'] == 'Regular Season' else 1,
            g['week'] if g['stage'] == 'Regular Season' else ROUND_ORDER[g['round']])


def location(g):
    return f"{g['year']} Week {g['week']}" if g['stage'] == 'Regular Season' else f"{g['year']} {g['round']}"


def fingerprint(site):
    return digest({k: site[k] for k in ('games', 'seasons', 'owners', 'championships')})


def source_check(site):
    # Compact input identity shared with the browser. No visitor-side statistics.
    values = [
        [[g[k] for k in ('game_id', 'year', 'stage', 'week', 'round', 'owner_id', 'opponent_owner_id')] +
         [cents(g['points_for']), cents(g['points_against'])] for g in site['games']],
        [[s['year'], s['status'], s['team_count'], s['regular_season_weeks'], s.get('roster_owner_ids', [])] for s in site['seasons']],
        [[o['owner_id'], o['owner_name']] for o in site['owners']],
        [[c['year'], c['champion_owner_id'], c['runner_up_owner_id'], cents(c['champion_score']), cents(c['runner_up_score'])] for c in site['championships']]]
    h = 2166136261
    for byte in json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode():
        h = ((h ^ byte) * 16777619) & 0xffffffff
    return f'{h:08x}'


def validate_source(site):
    report = site['validation_report']
    if report.get('status') != 'PASS' or not report.get('checks') or any(c['status'] != 'PASS' for c in report['checks']):
        raise ValueError('Source validation did not pass')
    seasons = {s['year']: s for s in site['seasons']}
    owners = {o['owner_id'] for o in site['owners']}
    current = [s for s in seasons.values() if s['status'] == 'Current']
    if len(current) != 1:
        raise ValueError('Expected one current season')
    cutoff = site['league']['current_season_through_week']
    if cutoff != report['publication_cutoff']['current_season_through_week']:
        raise ValueError('Cutoff mismatch')
    pairs, weeks = defaultdict(list), defaultdict(list)
    for g in site['games']:
        season = seasons[g['year']]
        if season['status'] not in ('Complete', 'Current') or g['owner_id'] not in owners or g['opponent_owner_id'] not in owners:
            raise ValueError('Unknown owner or ineligible season')
        if any(not isinstance(g[k], (int, float)) or not math.isfinite(g[k]) or g[k] < 0 or Decimal(str(g[k])) * 100 % 1 for k in ('points_for', 'points_against')):
            raise ValueError('Invalid score')
        difference = cents(g['points_for']) - cents(g['points_against'])
        result = 'W' if difference > 0 else 'L' if difference < 0 else 'T'
        if g['result'] != result or cents(g['margin']) != difference:
            raise ValueError('Result/margin contradicts score')
        if season['status'] == 'Current' and (g['stage'] != 'Regular Season' or not 1 <= g['week'] <= cutoff):
            raise ValueError('Unpublished current-season game')
        if g['stage'] == 'Regular Season':
            if not isinstance(g['week'], int) or not 1 <= g['week'] <= season['regular_season_weeks']:
                raise ValueError('Invalid regular-season week')
            weeks[(g['year'], g['week'])].append(g)
        elif g['stage'] != 'Postseason' or g['round'] not in ROUND_ORDER:
            raise ValueError('Unknown game stage/round')
        pairs[g['game_id']].append(g)
    if len(site['games']) != report['counts']['game_rows'] or len(pairs) != report['counts']['all_games']:
        raise ValueError('Source counts mismatch')
    for pair in pairs.values():
        if len(pair) != 2:
            raise ValueError('Incomplete matchup')
        a, b = pair
        if a['owner_id'] != b['opponent_owner_id'] or b['owner_id'] != a['opponent_owner_id'] or a['owner_id'] == b['owner_id'] or a['points_for'] != b['points_against'] or b['points_for'] != a['points_against'] or chronology(a) != chronology(b):
            raise ValueError('Unmirrored matchup')
    for year, season in seasons.items():
        if season['status'] not in ('Complete', 'Current'):
            continue
        end = season['regular_season_weeks'] if season['status'] == 'Complete' else cutoff
        for week in range(1, end + 1):
            rows = weeks[(year, week)]
            if len(rows) != season['team_count'] or set(g['owner_id'] for g in rows) != set(season['roster_owner_ids']):
                raise ValueError(f'Incomplete week {year}/{week}')
    for champ in site['championships']:
        rows = [g for g in site['games'] if g['year'] == champ['year'] and g['round'] == 'Championship']
        if seasons[champ['year']]['status'] != 'Complete' or len(rows) != 2 or not any(g['owner_id'] == champ['champion_owner_id'] and g['opponent_owner_id'] == champ['runner_up_owner_id'] and g['result'] == 'W' and g['points_for'] == champ['champion_score'] and g['points_against'] == champ['runner_up_score'] for g in rows):
            raise ValueError('Unverified championship')
    return seasons, weeks


class Registry:
    def __init__(self):
        self.templates = {}
        self.candidates = []

    def ranked(self, category, key, label, rows, field, unit='count', high=True, scope='all games', minimum=None):
        """One template per question; retain three distinct extrema as candidates."""
        tid = category + '.' + key
        if tid in self.templates:
            raise ValueError('Duplicate template ID')
        self.templates[tid] = {'category': category, 'label': label, 'scope': scope, 'minimum': minimum}
        valid = [dict(r, **{field: round(r[field], 10)}) for r in rows if r.get(field) is not None and math.isfinite(r[field])]
        values = sorted({r[field] for r in valid}, reverse=high)[:3]
        for ordinal, value in enumerate(values, 1):
            matches = sorted((r for r in valid if r[field] == value), key=lambda r: r['id'])
            # Explicitly represent ties without inventing an arbitrary winner.
            names = [r['name'] for r in matches]
            subject = '; '.join(names) if len(names) <= 2 else f"{names[0]} and {len(names)-1} others"
            rank = 1 + sum(r[field] > value if high else r[field] < value for r in valid)
            position = ('tied ' if len(matches) > 1 else '') + f'#{rank}'
            text = f"{subject}: {fmt(value, unit)} — {position} for {label} ({scope})."
            if minimum:
                text = text[:-2] + f'; minimum {minimum}).'
            if len(text) > 310:
                continue
            evidence = {'field': field, 'value': value, 'rank': rank, 'sources': [r['id'] for r in matches], 'scope': scope}
            self.candidates.append({'id': tid + ':' + digest(evidence)[:12], 'template': tid, 'category': category,
                                    'text': text, 'evidence': evidence, '_priority': ordinal,
                                    '_dedup': digest([category, scope, field, value, evidence['sources']])})


def aggregate(rows, name, identity):
    n = len(rows)
    pf = [cents(g['points_for']) / 100 for g in rows]
    pa = [cents(g['points_against']) / 100 for g in rows]
    w, l, t = (sum(g['result'] == x for g in rows) for x in ('W', 'L', 'T'))
    mean = sum(pf) / n
    close = [g for g in rows if abs(cents(g['margin'])) <= 500]
    result = {'id': identity, 'name': name, 'gp': n, 'wins': w, 'losses': l, 'ties': t,
              'pf': sum(pf), 'pa': sum(pa), 'avg_pf': mean, 'avg_pa': sum(pa)/n,
              'avg_margin': (sum(pf)-sum(pa))/n, 'win_pct': (w + .5*t)/n,
              'max_pf': max(pf), 'min_pf': min(pf), 'range': max(pf)-min(pf),
              'std': math.sqrt(sum((v-mean)**2 for v in pf)/(n-1)) if n > 1 else None,
              'close_wins': sum(g['result'] == 'W' for g in close),
              'close_losses': sum(g['result'] == 'L' for g in close),
              'big_wins': sum(g['result'] == 'W' and cents(g['margin']) >= 3000 for g in rows),
              'big_losses': sum(g['result'] == 'L' and cents(g['margin']) <= -3000 for g in rows)}
    for threshold in (80, 90, 100, 120, 140):
        result[f'ge{threshold}'] = sum(v >= threshold for v in pf)
        result[f'lt{threshold}'] = sum(v < threshold for v in pf)
        result[f'pct{threshold}'] = result[f'ge{threshold}']/n
    return result


def build_registry(site):
    seasons, weeks = validate_source(site)
    games = site['games']
    names = {o['owner_id']: o['owner_name'] for o in site['owners']}
    reg = Registry()
    game_rows = []
    for g in games:
        game_rows.append(dict(g, id=g['game_id'] + '/' + g['owner_id'],
                              name=f"{g['owner_name']} vs {g['opponent_owner_name']}, {location(g)}",
                              score=g['points_for'], total=(cents(g['points_for'])+cents(g['points_against']))/100,
                              abs_margin=abs(g['margin'])))
    winners = [g for g in game_rows if g['result'] == 'W']
    losers = [g for g in game_rows if g['result'] == 'L']
    regular = [g for g in game_rows if g['stage'] == 'Regular Season']
    post = [g for g in game_rows if g['stage'] == 'Postseason']
    # 15 individual-game questions.
    for key, label, rows, field, high in [
        ('high','highest score',game_rows,'score',True), ('low','lowest score',game_rows,'score',False),
        ('losing_high','highest losing score',losers,'score',True), ('winning_low','lowest winning score',winners,'score',False),
        ('winning_high','highest winning score',winners,'score',True), ('losing_low','lowest losing score',losers,'score',False),
        ('margin','largest winning margin',winners,'margin',True), ('narrow','narrowest win',winners,'margin',False),
        ('total_high','highest combined score',[g for g in game_rows if g['owner_id'] < g['opponent_owner_id']],'total',True),
        ('total_low','lowest combined score',[g for g in game_rows if g['owner_id'] < g['opponent_owner_id']],'total',False),
        ('reg_high','highest regular-season score',regular,'score',True), ('reg_low','lowest regular-season score',regular,'score',False),
        ('post_high','highest postseason score',post,'score',True), ('post_low','lowest postseason score',post,'score',False),
        ('post_narrow','narrowest postseason win',[g for g in post if g['result']=='W'],'margin',False)]:
        reg.ranked('games', key, label, rows, field, 'points', high, 'postseason' if key.startswith('post_') else 'regular season' if key.startswith('reg_') else 'regular season + postseason')
    by_owner, by_season, by_post, by_rival = (defaultdict(list) for _ in range(4))
    for g in games:
        by_owner[g['owner_id']].append(g)
        if g['stage'] == 'Regular Season':
            by_season[(g['year'],g['owner_id'])].append(g)
        else:
            by_post[g['owner_id']].append(g)
        if g['owner_id'] < g['opponent_owner_id']:
            by_rival[(g['owner_id'],g['opponent_owner_id'])].append(g)
    careers = [aggregate(rows,names[o],o) for o,rows in by_owner.items()]
    summaries = [aggregate(rows,f'{names[o]}, {y}',f'{y}/{o}') for (y,o),rows in by_season.items() if seasons[y]['status']=='Complete']
    # 17 career questions; rates require a sample of 30 games.
    for key,label,field,unit,high,rate in [
        ('wins','career wins','wins','count',True,False), ('losses','career losses','losses','count',True,False),
        ('games','career games played','gp','count',True,False), ('points','career points scored','pf','points',True,False),
        ('allowed','career points allowed','pa','points',True,False), ('win_pct','career win percentage','win_pct','pct',True,True),
        ('avg_score','career scoring average','avg_pf','points',True,True), ('avg_margin','career average margin','avg_margin','points',True,True),
        ('opponent','highest average opponent score','avg_pa','points',True,True),
        ('100','career 100+ scores','ge100','count',True,False), ('120','career 120+ scores','ge120','count',True,False),
        ('140','career 140+ scores','ge140','count',True,False), ('close_wins','career wins by 5 or fewer','close_wins','count',True,False),
        ('close_losses','career losses by 5 or fewer','close_losses','count',True,False),
        ('big_wins','career wins by 30+','big_wins','count',True,False),
        ('rate100','career share of 100+ scores','pct100','pct',True,True), ('rate120','career share of 120+ scores','pct120','pct',True,True)]:
        reg.ranked('career',key,label,[r for r in careers if not rate or r['gp']>=30],field,unit,high,'regular season + postseason','30 games' if rate else None)
    # 18 completed-season questions.
    for key,label,field,unit,high in [
        ('wins','season wins','wins','count',True), ('losses','season losses','losses','count',True),
        ('win_pct','season win percentage','win_pct','pct',True), ('worst_pct','lowest season win percentage','win_pct','pct',False),
        ('points','season points scored','pf','points',True), ('avg','season scoring average','avg_pf','points',True),
        ('low_avg','lowest season scoring average','avg_pf','points',False), ('margin','season average margin','avg_margin','points',True),
        ('low_margin','lowest season average margin','avg_margin','points',False), ('opponent','season opponent scoring average','avg_pa','points',True),
        ('100','season 100+ scores','ge100','count',True), ('120','season 120+ scores','ge120','count',True),
        ('140','season 140+ scores','ge140','count',True), ('rate100','season share of 100+ scores','pct100','pct',True),
        ('floor','highest season minimum score','min_pf','points',True), ('ceiling','highest season maximum score','max_pf','points',True),
        ('close','season wins by 5 or fewer','close_wins','count',True), ('blowouts','season wins by 30+','big_wins','count',True)]:
        reg.ranked('season',key,label,summaries,field,unit,high,'completed regular seasons')
    # 13 postseason/championship questions, with appearances inferred only from played games.
    pc = []
    champs = site['championships']
    for o,rows in by_post.items():
        r = aggregate(rows,names[o],o)
        r.update(titles=sum(c['champion_owner_id']==o for c in champs),
                 finals=sum(o in (c['champion_owner_id'],c['runner_up_owner_id']) for c in champs),
                 runner_up=sum(c['runner_up_owner_id']==o for c in champs),
                 playoff_years=len({g['year'] for g in rows}),
                 semis=sum(g['round']=='Semifinal' for g in rows))
        pc.append(r)
    for key,label,field,unit,rate in [
        ('titles','championship titles','titles','count',False), ('finals','championship appearances','finals','count',False),
        ('runner_up','runner-up finishes','runner_up','count',False), ('appearances','seasons with a postseason game','playoff_years','count',False),
        ('semis','semifinal games played','semis','count',False), ('wins','postseason wins','wins','count',False),
        ('games','postseason games played','gp','count',False), ('points','postseason points scored','pf','points',False),
        ('avg','postseason scoring average','avg_pf','points',True), ('win_pct','postseason win percentage','win_pct','pct',True)]:
        reg.ranked('playoffs',key,label,[r for r in pc if not rate or r['gp']>=5],field,unit,True,'postseason','5 playoff games' if rate else None)
    finals=[g for g in post if g['round']=='Championship' and g['result']=='W']
    for key,label,field,high in [('final_margin','championship winning margin','margin',True),('final_narrow','closest championship','margin',False),('final_score','championship winning score','score',True)]:
        reg.ranked('playoffs',key,label,finals,field,'points',high,'championship games')
    # 10 rivalry questions; one pair entry per matchup.
    rivals=[]
    for (a,b),rows in by_rival.items():
        aw=sum(g['result']=='W' for g in rows);bw=sum(g['result']=='L' for g in rows);n=len(rows)
        margins=[abs(g['margin']) for g in rows]
        dominant=a if aw>=bw else b
        rivals.append({'id':a+'/'+b,'name':f'{names[a]} vs {names[b]}', 'gp':n,'total':sum(g['points_for']+g['points_against'] for g in rows),
                       'avg_total':sum(g['points_for']+g['points_against'] for g in rows)/n,'avg_margin':sum(margins)/n,
                       'close':sum(m<=5 for m in margins),'blowout':sum(m>=30 for m in margins),'gap':abs(aw-bw),
                       'max_margin':max(margins),'min_margin':min(margins),'dominance':max(aw,bw)/n,
                       'dominant':names[dominant]})
    for key,label,field,unit,high,rate in [
        ('meetings','head-to-head meetings','gp','count',True,False),('total','head-to-head combined points','total','points',True,False),
        ('avg_total','head-to-head average combined score','avg_total','points',True,True),
        ('competitive','smallest head-to-head average margin','avg_margin','points',False,True),
        ('lopsided','largest head-to-head average margin','avg_margin','points',True,True),
        ('close','head-to-head games decided by 5 or fewer','close','count',True,False),
        ('blowouts','head-to-head games decided by 30+','blowout','count',True,False),
        ('gap','head-to-head win-count gap','gap','count',True,True),
        ('max_margin','largest head-to-head single-game margin','max_margin','points',True,False),
        ('dominance','higher-winning side share of rivalry wins','dominance','pct',True,True)]:
        eligible=[r for r in rivals if not rate or r['gp']>=5]
        if key=='dominance':
            eligible=[dict(r, name=f"{r['dominant']} in {r['name']}") for r in eligible]
        reg.ranked('rivalries',key,label,eligible,field,unit,high,'regular season + postseason','5 meetings' if rate else None)
    # 12 streak and consistency questions. Streaks follow each owner's played games,
    # through playoffs and across seasons; byes/inactive years add no games.
    streak_specs=[('wins','longest winning streak',lambda g:g['result']=='W'),('losses','longest losing streak',lambda g:g['result']=='L'),
                  ('100','longest streak scoring 100+',lambda g:g['points_for']>=100),('120','longest streak scoring 120+',lambda g:g['points_for']>=120),
                  ('under100','longest streak scoring below 100',lambda g:g['points_for']<100),
                  ('close','longest streak of games decided by 5 or fewer',lambda g:abs(g['margin'])<=5)]
    for key,label,predicate in streak_specs:
        runs=[]
        for o,rows in by_owner.items():
            ordered=sorted(rows,key=chronology);start=None;length=0
            for i,g in enumerate(ordered):
                if predicate(g):
                    if start is None:start=g
                    length+=1
                if length and (not predicate(g) or i==len(ordered)-1):
                    end=ordered[i-1] if not predicate(g) else g
                    runs.append({'id':f"{o}/{start['game_id']}/{end['game_id']}",'name':f"{names[o]}, {location(start)} to {location(end)}",'length':length})
                    length=0;start=None
        reg.ranked('streaks',key,label,runs,'length',scope='consecutive played games, regular season + postseason')
    for key,label,field,high in [('steady','lowest season score variation','std',False),('volatile','highest season score variation','std',True),
                                ('range_low','smallest season scoring range','range',False),('range_high','largest season scoring range','range',True),
                                ('floor','fewest sub-80 scores in a season','lt80',False)]:
        reg.ranked('streaks',key,label,summaries,field,'points' if field in ('std','range') else 'count',high,'completed regular seasons; variation = sample standard deviation' if field=='std' else 'completed regular seasons')
    rivalry_runs=[]
    for (a,b),rows in by_rival.items():
        ordered=sorted(rows,key=chronology);runs=[];last=None;start=None;length=0
        for i,g in enumerate(ordered):
            winner=g['owner_id'] if g['result']=='W' else g['opponent_owner_id'] if g['result']=='L' else None
            if winner!=last:
                if length:runs.append((last,start,ordered[i-1],length))
                last=winner;start=g;length=0
            if winner:length+=1
        if length:runs.append((last,start,ordered[-1],length))
        for o,start,end,n in runs:
            rivalry_runs.append({'id':f"{o}/{start['game_id']}/{end['game_id']}",'name':f"{names[o]} vs {names[b if o==a else a]}, {location(start)} to {location(end)}",'length':n})
    reg.ranked('streaks','rivalry','longest winning streak against one opponent',rivalry_runs,'length',scope='successive meetings, regular season + postseason')
    # 8 luck/oddity questions, recomputed from weekly scores, not historical cached AI fields.
    lucky=[]
    for (year,o),rows in by_season.items():
        if seasons[year]['status']!='Complete':continue
        expected=0.;top_losses=0;bottom_wins=0;second_losses=0
        for g in rows:
            wk=weeks[(year,g['week'])];n=len(wk);pf=cents(g['points_for'])
            lower=sum(cents(x['points_for'])<pf for x in wk)
            same=sum(cents(x['points_for'])==pf for x in wk)-1
            rank=1+sum(cents(x['points_for'])>pf for x in wk)
            expected+=(lower+.5*same)/(n-1)
            top_losses+=g['result']=='L' and rank<=n//2
            bottom_wins+=g['result']=='W' and rank>n//2
            second_losses+=g['result']=='L' and rank==2
        wins=sum(g['result']=='W' for g in rows)
        lucky.append({'id':f'{year}/{o}','name':f'{names[o]}, {year}','expected':expected,'luck':wins-expected,
                      'top_losses':top_losses,'bottom_wins':bottom_wins,'second_losses':second_losses})
    for key,label,field,unit,high in [('lucky','wins above all-play expectation','luck','signed',True),
                                    ('unlucky','wins below all-play expectation','luck','signed',False),
                                    ('expected','all-play expected wins','expected','count',True),
                                    ('low_expected','lowest all-play expected wins','expected','count',False),
                                    ('top_losses','losses while scoring in the weekly top half','top_losses','count',True),
                                    ('bottom_wins','wins while scoring in the weekly bottom half','bottom_wins','count',True),
                                    ('second_losses','losses with the weekly second-highest score','second_losses','count',True)]:
        reg.ranked('luck',key,label,lucky,field,unit,high,'completed regular seasons')
    unusual=[g for g in winners if g['points_for']<80]
    reg.ranked('luck','sub80','largest winning margin while scoring below 80',unusual,'margin','points',True,'regular season + postseason')
    # 10 weekly-history questions. Owner-perspective rows count scores once, not matchups twice.
    weekly=[]
    for (year,week),rows in weeks.items():
        if not rows:continue
        n=len(rows);scores=[g['points_for'] for g in rows];wm=[g for g in rows if g['result']=='W'];lm=[g for g in rows if g['result']=='L']
        weekly.append({'id':f'{year}/{week}','name':f'{year} Week {week} ({n} teams)','total':sum(scores),'average':sum(scores)/n,
                       'winner':sum(g['points_for'] for g in wm)/len(wm) if wm else None,
                       'loser':sum(g['points_for'] for g in lm)/len(lm) if lm else None,
                       'margin':sum(abs(g['margin']) for g in rows)/n,
                       'pct100':sum(v>=100 for v in scores)/n,'pct120':sum(v>=120 for v in scores)/n})
    for key,label,field,unit,high in [('high_total','weekly league scoring total','total','points',True),('low_total','lowest weekly league total','total','points',False),
                                    ('high_avg','weekly average team score','average','points',True),('low_avg','lowest weekly average team score','average','points',False),
                                    ('winner','weekly average winning score','winner','points',True),('loser','weekly average losing score','loser','points',True),
                                    ('close','smallest weekly average margin','margin','points',False),('wide','largest weekly average margin','margin','points',True),
                                    ('100','weekly share of teams scoring 100+','pct100','pct',True),('120','weekly share of teams scoring 120+','pct120','pct',True)]:
        reg.ranked('league',key,label,weekly,field,unit,high,'published regular-season weeks')
    return reg


def collection(site):
    registry=build_registry(site)
    selected=[];used=set();template_counts=Counter()
    # First cover distinct questions, then fill category targets with second/third records.
    pools={cat:sorted((r for r in registry.candidates if r['category']==cat),key=lambda r:(r['_priority'],r['template'],r['id'])) for cat in TARGETS}
    for cat,target in TARGETS.items():
        for row in pools[cat]:
            if sum(r['category']==cat for r in selected)>=target:break
            if row['_dedup'] in used:continue
            selected.append(row);used.add(row['_dedup']);template_counts[row['template']]+=1
    for row in sorted(registry.candidates,key=lambda r:(template_counts[r['template']],r['_priority'],r['id'])):
        if len(selected)>=CAP:break
        if row['_dedup'] not in used:selected.append(row);used.add(row['_dedup'])
    selected=selected[:CAP]
    for row in selected:
        for key in list(row):
            if key.startswith('_'):del row[key]
    current=next(s for s in site['seasons'] if s['status']=='Current')
    result={'version':VERSION,'source_fingerprint':fingerprint(site),'generated_at':site['league']['generated_at_utc'],
            'as_of':f"{current['year']} Week {site['league']['current_season_through_week']}",
            'cutoff':{'year':current['year'],'week':site['league']['current_season_through_week']},
            'generator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'source_check':source_check(site),'source_game_rows':len(site['games']),'template_count':len(registry.templates),
            'templates_used':len({r['template'] for r in selected}),
            'categories':dict(Counter(r['category'] for r in selected)),
            'sayings':selected}
    result['collection_sha256']=digest(result)
    validate_collection(result)
    return result


def validate_collection(result):
    checksum=result.get('collection_sha256')
    if checksum != digest({k:v for k,v in result.items() if k!='collection_sha256'}):
        raise ValueError('Collection integrity mismatch')
    rows=result['sayings']
    if not 1<=len(rows)<=CAP or len({r['id'] for r in rows})!=len(rows) or len({r['text'] for r in rows})!=len(rows):
        raise ValueError('Empty, duplicate or oversized collection')
    if len(result['source_fingerprint'])!=64 or result['version']!=VERSION:
        raise ValueError('Invalid provenance')
    for row in rows:
        if not row['evidence']['sources'] or row['category'] not in TARGETS or not 1<=len(row['text'])<=310 or not math.isfinite(row['evidence']['value']):
            raise ValueError('Invalid saying/evidence')
    if len(serialize(result).encode())>MAX_BYTES:
        raise ValueError('Dialogue payload exceeds byte budget')


def serialize(result):
    return PREFIX+json.dumps(result,ensure_ascii=True,separators=(',',':'),allow_nan=False)+';\n'


def generate(directory, output=None, verify=True):
    directory=Path(directory);output=Path(output) if output else directory/'sparty-records.js'
    if verify:
        errors=core_verify.verify_dir(str(directory))
        if errors:raise ValueError('Core validation failed: '+'; '.join(errors))
    site=df.load(str(directory)).site
    validate_source(site)
    # Avoid recalculation when inputs and generator version are unchanged. Validate
    # the stored collection's checksum as well, so an edited output is regenerated.
    if output.exists():
        try:
            old=json.loads(output.read_text()[len(PREFIX):].strip().rstrip(';'))
            validate_collection(old)
            if old['source_fingerprint']==fingerprint(site) and old['source_check']==source_check(site) and old.get('generator_sha256')==hashlib.sha256(Path(__file__).read_bytes()).hexdigest():
                return old,False
        except (ValueError, KeyError, TypeError):
            pass
    result=collection(site)
    text=serialize(result)
    if output.exists() and output.read_text()==text:
        return result,False
    output.parent.mkdir(parents=True,exist_ok=True)
    # Never truncate the last good output. Atomic replacement follows successful validation.
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=output.parent,delete=False) as stream:
        temp=Path(stream.name)
        stream.write(text)
    try:
        reread=json.loads(temp.read_text()[len(PREFIX):].strip().rstrip(';'))
        validate_collection(reread)
        if reread!=result:raise ValueError('Written collection differs')
        os.replace(temp,output)
    finally:
        temp.unlink(missing_ok=True)
    return result,True


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data-dir',default=str(ROOT/'site-data'))
    p.add_argument('--output')
    args=p.parse_args()
    try:
        result,changed=generate(args.data_dir,args.output)
        print(json.dumps({'changed':changed,'sayings':len(result['sayings']),'templates':result['template_count'],
                          'templates_used':result['templates_used'],'categories':result['categories'],'as_of':result['as_of']}))
        return 0
    except Exception as error:
        print(f'Sparty dialogue generation failed; last valid file preserved: {error}',file=sys.stderr)
        return 1

if __name__=='__main__':sys.exit(main())
