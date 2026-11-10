#!/usr/bin/env python3
"""Verified regular season, championship playoffs and automatic linked-season rollover.

No AI or credentials. The published season stays visible until its linked successor
has a scored Week 1. Unknown owners or unsupported rules block publication.
"""
import argparse
import copy
import json
import math
import os
import re
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build as bd
import datafiles as df
import derive as dv
import sleeper_api as api
import verify as vf

ROUNDS = {1: 'Quarterfinal', 2: 'Semifinal', 3: 'Championship'}
ROOT = Path(__file__).resolve().parents[2]


def require(ok, message):
    if not ok:
        raise bd.GateError(message)


def check_rules(cur, ctx):
    require(ctx.get('playoff_week_start') == 15 and cur['regular_season_weeks'] == 14,
            'Supported format is 14 regular-season weeks, playoffs starting Week 15. Review changed rules.')
    require(ctx.get('playoff_teams') == 8 and ctx.get('total_rosters') == 12,
            'Supported format is 12 teams and 8 playoff spots. Review changed rules.')
    require(ctx.get('start_week') == 1 and not any(ctx.get(k, 0) for k in
            ('divisions', 'playoff_seed_type', 'playoff_round_type', 'league_average_match')),
            'Changed league format: only single-week rounds, no divisions, reseeding or median games are supported.')


def pin_users(mapping, ctx):
    """Stable Sleeper account IDs are pinned only after published score parity succeeds."""
    result = copy.deepcopy(mapping)
    live = {r['roster_id']: r.get('owner_id') for r in ctx['rosters']}
    require(set(live) == set(mapping['rosters']) and all(live.values()) and len(set(live.values())) == len(live),
            'Every configured roster must have one distinct Sleeper owner. Review owner_map.json.')
    old = {int(k): v for k, v in mapping.get('sleeper_user_ids', {}).items()}
    require(not old or old == live, 'Sleeper ownership changed. Review roster assignments in owner_map.json.')
    result['sleeper_user_ids'] = {str(k): v for k, v in sorted(live.items())}
    return result


def championship_tree(raw):
    """Follow only winner links from the first-place final; exclude consolation/placement games."""
    require(isinstance(raw, list) and all(isinstance(m, dict) for m in raw), 'Invalid playoff bracket response.')
    by_id = {m.get('m'): m for m in raw}
    require(len(by_id) == len(raw) and all(type(k) is int for k in by_id), 'Duplicate or invalid playoff match IDs.')
    finals = [m for m in raw if m.get('p') == 1]
    require(len(finals) == 1 and finals[0].get('r') == 3, 'Cannot identify a unique Week 17 championship.')
    result, seen = [], set()
    def visit(m, rnd):
        require(m.get('r') == rnd and m['m'] not in seen, 'Invalid or cyclic playoff progression.')
        seen.add(m['m'])
        if rnd > 1:
            for side in ('t1', 't2'):
                source = m.get(side+'_from') or (m.get(side) if isinstance(m.get(side), dict) else {})
                require(isinstance(source, dict) and set(source) == {'w'} and source['w'] in by_id,
                        'Championship progression must link to winners of earlier rounds.')
                visit(by_id[source['w']], rnd-1)
        result.append(m)
    visit(finals[0], 3)
    require(len(result) == 7, 'Expected seven championship-path games.')
    return sorted(result, key=lambda m: m['r'])  # stable order preserves the final's two branches


def normalize_playoffs(site, mapping, ctx, raw_bracket, raw_weeks):
    cur = bd.current_season(site)
    tree = championship_tree(raw_bracket)
    by_id, output = {}, []
    through = min(3, max(0, ctx['last_scored_leg'] - 14))
    names = bd.owner_names(site)
    teams = {r['owner_id']: r['team'] for r in site['current_standings']}
    seeds = {r['owner_id']: r['rank'] for r in site['current_standings']}
    rows = []
    for m in tree:
        rnd, mid = m['r'], m['m']
        owners, refs = [], []
        for side in ('t1', 't2'):
            source = m.get(side+'_from') or (m.get(side) if isinstance(m.get(side), dict) else {})
            ref = source.get('w') if source else None
            roster = m.get(side)
            if rnd > 1:
                require(ref in by_id, 'Missing earlier playoff round.')
                owner = by_id[ref]['winner_owner_id']
                if type(roster) is int and owner is not None:
                    require(mapping['rosters'].get(roster) == owner, 'Playoff participant disagrees with the previous winner.')
            else:
                require(type(roster) is int and roster in mapping['rosters'], 'Unknown quarterfinal roster.')
                owner = mapping['rosters'][roster]
            owners.append(owner); refs.append(ref)
        item = dict(match_id=mid, round=ROUNDS[rnd], week=14+rnd,
                    team1_owner_id=owners[0], team2_owner_id=owners[1],
                    from1=refs[0], from2=refs[1], team1_score=None, team2_score=None,
                    winner_owner_id=None, loser_owner_id=None)
        if rnd <= through:
            require(all(owners) and owners[0] != owners[1], 'Scored playoff game is missing its participants.')
            payload = raw_weeks[14+rnd]
            roster_ids = [rid for rid, oid in mapping['rosters'].items() if oid in owners]
            selected = [r for r in payload['matchups'] if r['roster_id'] in roster_ids]
            pairs = bd.parse_week(14+rnd, dict(payload, matchups=selected), roster_ids, mapping['league_id'], cur['year'])
            require(len(pairs) == 1, 'Playoff teams are not paired together in weekly matchups.')
            a,b,sa,sb = pairs[0]
            scores = {mapping['rosters'][a]: sa, mapping['rosters'][b]: sb}
            require(sa != sb, 'Tied playoff game requires a commissioner decision; nothing will be published.')
            winner, loser = sorted(owners, key=lambda oid: -scores[oid])
            require(mapping['rosters'].get(m.get('w')) == winner and mapping['rosters'].get(m.get('l')) == loser,
                    'Sleeper bracket winner/loser is not final or disagrees with the score.')
            item.update(team1_score=scores[owners[0]], team2_score=scores[owners[1]],
                        winner_owner_id=winner, loser_owner_id=loser)
            gid = f"{cur['year']}-postseason-bracket-{mid}"
            for oid, opp in ((owners[0], owners[1]), (owners[1], owners[0])):
                row = bd._row(cur['year'], cur['season_id'], None, teams[oid], oid, names[oid],
                              teams[opp], opp, names[opp], scores[oid], scores[opp], gid)
                row.update(stage='Postseason', round=ROUNDS[rnd], seed=seeds[oid], opponent_seed=seeds[opp])
                rows.append(row)
        by_id[mid] = item; output.append(item)
    first = [oid for m in output if m['week'] == 15 for oid in (m['team1_owner_id'],m['team2_owner_id'])]
    require(len(set(first)) == 8 and set(first) == {oid for oid, seed in seeds.items() if seed <= 8},
            'Official bracket differs from the top eight regular-season qualifiers. Review custom seeding.')
    return output, rows, through


def validate_published_postseason(site):
    """Independent publication invariants, also used by the standard verifier."""
    cur = bd.current_season(site); rnd = cur.get('postseason_through_round', 0)
    require(type(rnd) is int and 0 <= rnd <= 3, 'Invalid postseason round cutoff.')
    require(site['league']['current_season_through_week'] == 14, 'Playoffs require a full regular season.')
    bracket = cur.get('playoff_bracket', [])
    require(len(bracket) == 7 and len({m['match_id'] for m in bracket}) == 7, 'Invalid saved playoff bracket.')
    lookup = {m['match_id']: m for m in bracket}
    current_rows = [g for g in site['games'] if g['year'] == cur['year'] and g['stage'] == 'Postseason']
    expected_ids = set()
    first = [o for m in bracket if m['week'] == 15 for o in (m['team1_owner_id'],m['team2_owner_id'])]
    require(len(first) == len(set(first)) == 8 and set(first) == {s['owner_id'] for s in site['current_standings'] if s['rank'] <= 8}, 'Invalid playoff qualifiers.')
    used_refs = []
    for r, count in ((1,4),(2,2),(3,1)):
        matches = [m for m in bracket if m['week'] == 14+r and m['round'] == ROUNDS[r]]
        require(len(matches) == count, 'Wrong number of playoff games in a round.')
        for m in matches:
            for side in (1,2):
                if r > 1:
                    ref = lookup.get(m['from'+str(side)])
                    require(ref is not None and ref['week'] == m['week']-1, 'Invalid playoff source round.')
                    used_refs.append(ref['match_id'])
                    require(m[f'team{side}_owner_id'] == ref['winner_owner_id'], 'Non-winner advanced in playoffs.')
            gid = f"{cur['year']}-postseason-bracket-{m['match_id']}"
            if r > rnd:
                require(all(m.get(k) is None for k in ('team1_score','team2_score','winner_owner_id','loser_owner_id')), 'Unscored playoff results were exposed.')
                continue
            expected_ids.add(gid)
            rows = [g for g in current_rows if g['game_id'] == gid]
            require(len(rows) == 2, 'Missing or duplicate playoff game rows.')
            scores = {m['team1_owner_id']: m['team1_score'], m['team2_owner_id']: m['team2_score']}
            require(len(scores) == 2 and all(type(v) in (float,int) and math.isfinite(v) and v > 0 for v in scores.values()), 'Invalid playoff score.')
            win, lose = sorted(scores, key=lambda oid: -scores[oid])
            require(scores[win] > scores[lose] and m['winner_owner_id'] == win and m['loser_owner_id'] == lose, 'Invalid playoff winner.')
            for g in rows:
                require(g['owner_id'] in scores and g['opponent_owner_id'] in scores and g['owner_id'] != g['opponent_owner_id'] and g['points_for'] == scores[g['owner_id']] and g['points_against'] == scores[g['opponent_owner_id']] and g['round'] == ROUNDS[r] and g['week'] is None,
                        'Published playoff rows disagree with the bracket.')
    require(len(used_refs) == len(set(used_refs)) == 6, 'Repeated playoff progression link.')
    require({g['game_id'] for g in current_rows} == expected_ids and len(current_rows) == 2*len(expected_ids), 'Extra/unpublished playoff games.')
    champs = [c for c in site['championships'] if c['year'] == cur['year']]
    require((len(champs) == 1) == (rnd == 3) and len(champs) <= 1, 'Championship record and final round disagree.')
    require(cur.get('phase') == ('Complete' if rnd == 3 else 'Postseason'), 'Season phase disagrees with playoff cutoff.')
    if champs:
        final = next(m for m in bracket if m['week'] == 17); c = champs[0]
        require(c['champion_owner_id'] == final['winner_owner_id'] and c['runner_up_owner_id'] == final['loser_owner_id'], 'Champion identity disagrees with final.')
        scores = {final['team1_owner_id']:final['team1_score'], final['team2_owner_id']:final['team2_score']}
        require(c['champion_score'] == scores[c['champion_owner_id']] and c['runner_up_score'] == scores[c['runner_up_owner_id']], 'Championship scores disagree.')


def derive_postseason(base, mapping, ctx, bracket, weeks):
    ds = base.copy(); cur = bd.current_season(ds.site)
    normalized, rows, rnd = normalize_playoffs(ds.site, mapping, ctx, bracket, weeks)
    old_rows = [g for g in base['games'] if g['year'] == cur['year'] and g['stage'] == 'Postseason']
    by_key = {(g['game_id'],g['owner_id']):g for g in rows}
    require(all(by_key.get((g['game_id'],g['owner_id'])) == g for g in old_rows),
            'Previously published playoff results changed. Review the score correction before publishing.')
    cur.update(phase='Complete' if rnd == 3 else 'Postseason', postseason_through_round=rnd, playoff_bracket=normalized)
    if rnd == 3:
        final = next(m for m in normalized if m['week'] == 17)
        scores = {final['team1_owner_id']: final['team1_score'], final['team2_owner_id']: final['team2_score']}
        winner, loser = final['winner_owner_id'], final['loser_owner_id']; names = bd.owner_names(ds.site)
        champ = dict(year=cur['year'],champion_owner_id=winner,champion_owner_name=names[winner],
                     runner_up_owner_id=loser,runner_up_owner_name=names[loser],champion_score=scores[winner],runner_up_score=scores[loser])
        existing = [c for c in ds.site['championships'] if c['year'] == cur['year']]
        require(not existing or existing == [champ], 'Previously published championship changed.')
        ds['championships'] = ds.site['championships'] = [c for c in ds.site['championships'] if c['year'] != cur['year']] + [champ]
    games = [g for g in ds['games'] if not (g['year'] == cur['year'] and g['stage'] == 'Postseason')] + rows
    result = bd.derive_dataset(ds, games, 14, ctx['fetched_at_utc'])
    validate_published_postseason(result.site)
    return result


def successor(mapping, fetcher):
    """Discover by explicit previous_league_id; never guess from a league's name."""
    year = mapping['season']+1
    users = sorted(set(mapping.get('sleeper_user_ids', {}).values()))
    require(users, 'Stable Sleeper user IDs must be pinned before automatic rollover.')
    found = {}
    for uid in users:
        leagues = fetcher(f'/user/{uid}/leagues/nfl/{year}')
        require(isinstance(leagues, list), 'Invalid future-season league response.')
        for league in leagues:
            if str(league.get('previous_league_id')) == mapping['league_id'] and str(league.get('season')) == str(year):
                require(isinstance(league.get('league_id'), str), 'Successor league has no league ID.')
                found[league['league_id']] = league
    require(len(found) <= 1, 'Multiple successor leagues found. Resolve the duplicate before automatic rollover.')
    return next(iter(found.values()), None)


def rollover(base, mapping, ctx, weeks, owner_changes=None):
    ds = base.copy(); old = bd.current_season(ds.site); year = old['year']+1
    require(old.get('phase') == 'Complete' and old.get('postseason_through_round') == 3, 'Finish and verify the outgoing championship before rollover.')
    validate_published_postseason(ds.site)
    require(str(ctx.get('previous_league_id')) == mapping['league_id'] and str(ctx['season']) == str(year), 'New league is not the direct next-season successor.')
    check_rules(old, ctx)
    require(ctx['status'] in ('in_season','complete') and type(ctx.get('last_scored_leg')) is int and ctx['last_scored_leg'] >= 1,
            'Keep the finished season visible until the next season has a completed Week 1.')
    pinned = {uid: mapping['rosters'][int(rid)] for rid,uid in mapping['sleeper_user_ids'].items()}
    require(len(pinned) == len(mapping['rosters']), 'Duplicate pinned Sleeper owners.')
    require(owner_changes is None or isinstance(owner_changes,dict), 'Owner changes must be a JSON object.')
    changes = (owner_changes or {}).get('owners', {})
    if owner_changes:
        require(owner_changes.get('season') == year and owner_changes.get('league_id') == ctx['league_id'],
                'Owner changes must specify the exact new season and league ID.')
        require(isinstance(changes, dict), 'Owner changes must be a Sleeper-user-ID mapping.')
    names = bd.owner_names(ds.site)
    for uid, info in changes.items():
        require(uid not in pinned and isinstance(info, dict), 'Owner changes may only assign new Sleeper accounts.')
        oid, name = info.get('owner_id',''), info.get('owner_name','')
        require(isinstance(oid,str) and re.fullmatch(r'owner-[a-z0-9-]+',oid) and isinstance(name,str) and 0<len(name.strip())<=80,
                'Each new account requires owner_id (owner-name) and owner_name.')
        require(oid not in names or names[oid] == name, 'Existing historical owner names must not be overwritten.')
        if oid not in names:
            ds.site['owners'].append(dict(owner_id=oid,owner_name=name)); names[oid] = name
        pinned[uid] = oid
    live = ctx['rosters']; ids = [r.get('roster_id') for r in live]; users = [r.get('owner_id') for r in live]
    require(len(ids) == len(set(ids)) == old['team_count'] and set(users) <= set(pinned) and len(set(users)) == len(users) and len({pinned[u] for u in users}) == len(users),
            'New season has an unknown, missing or duplicate owner. Review roster ownership before rollover.')
    newmap = copy.deepcopy(mapping)
    newmap.update(league_id=ctx['league_id'], season=year,
                  rosters={r['roster_id']: pinned[r['owner_id']] for r in live},
                  sleeper_user_ids={str(r['roster_id']):r['owner_id'] for r in live})
    old['status'] = 'Complete'
    # Finalize outgoing season metadata; game rows and other completed seasons remain untouched.
    for r in ds['season_summaries']:
        if r['year'] == old['year']:
            r['season_status'] = 'Complete'; r.pop('rank',None)
    ds.site['season_summaries'] = ds['season_summaries']
    for key in ('ai_games','ai_all_games','ai_seasons','ai_league_years'):
        for r in ds[key]:
            if r['year'] == old['year']: r['season_status'] = 'Complete'
    cur = copy.deepcopy(old)
    cur.update(year=year,season_id=f'season-{year}',source_sheet=str(year),status='Current',phase='Regular Season')
    for k in ('postseason_through_round','playoff_bracket'): cur.pop(k,None)
    live_owners = set(newmap['rosters'].values())
    cur['roster_owner_ids'] = [o for o in old['roster_owner_ids'] if o in live_owners]
    cur['roster_owner_ids'] += [o for _,o in sorted(newmap['rosters'].items()) if o not in cur['roster_owner_ids']]
    cur['sleeper_league_id'] = ctx['league_id']
    ds.site['seasons'] = [s for s in ds.site['seasons'] if s['year'] != year] + [cur]
    ds.site['seasons'].sort(key=lambda s:s['year'])
    ds.site['league'].update(sleeper_league_id=ctx['league_id'],current_season_through_week=0)
    user_info = {u['user_id']: u for u in ctx['users']}
    names = bd.owner_names(ds.site)
    teams = {pinned[r['owner_id']]: (user_info.get(r['owner_id'],{}).get('team_name') or names[pinned[r['owner_id']]]) for r in live}
    target = min(ctx['last_scored_leg'],14)
    new_rows = []
    for w in range(1,target+1):
        pairs = bd.parse_week(w,weeks[w],sorted(newmap['rosters']),ctx['league_id'],year)
        new_rows.extend(bd.game_rows_for_week(cur,w,pairs,newmap['rosters'],names,teams))
    reg = [g for g in ds['games'] if g['stage']=='Regular Season']
    post = [g for g in ds['games'] if g['stage']=='Postseason']
    result = bd.derive_dataset(ds,reg+new_rows+post,target,ctx['fetched_at_utc'])
    return result,newmap


def bundle_text(ds, mapping):
    result = df.render(ds)
    result['sleeper/owner_map.json'] = json.dumps(mapping,indent=2)+'\n'
    return result


def run(data, fetcher=None, now=None, owner_changes=None):
    """Build and verify the complete candidate off to the side; return bytes, never write here."""
    fetcher, now = fetcher or api.get_json, now or api.utc_now
    data = Path(data); base = df.load(str(data)); ds = base
    problems = vf.verify_dir(str(data)); require(not problems, 'Existing snapshot failed verification: '+'; '.join(problems))
    mapping = bd.load_owner_map(str(data/'sleeper/owner_map.json'))
    ctx = api.fetch_context(mapping['league_id'],fetcher,now)
    cur = bd.current_season(ds.site); bd.check_mapping(cur,mapping,ctx); check_rules(cur,ctx)
    last = ctx.get('last_scored_leg'); require(type(last) is int and last >= 1, 'No completed regular-season week yet.')
    require(last >= ds.site['league']['current_season_through_week'], 'Sleeper completed-week marker moved backwards.')
    raw = {'context.json':ctx}
    weeks = {w:api.fetch_week(mapping['league_id'],w,ctx['season'],fetcher,now) for w in range(1,min(last,14)+1)}
    raw.update({f'week-{w:02}.json':p for w,p in weeks.items()})
    # The existing builder verifies every published regular-season matchup even on no-op runs.
    try: ds,_ = bd.build_from_sleeper(ds,mapping,ctx,weeks)
    except bd.NothingToPublish: pass
    mapping = pin_users(mapping,ctx)
    ds = ds.copy(); ds.site['league']['sleeper_league_id'] = mapping['league_id']
    bd.current_season(ds.site)['sleeper_league_id'] = mapping['league_id']
    if last >= 15:
        bracket = fetcher(f"/league/{mapping['league_id']}/winners_bracket")
        for w in range(15,min(last,17)+1): weeks[w] = api.fetch_week(mapping['league_id'],w,ctx['season'],fetcher,now)
        raw['winners-bracket.json'] = {'bracket':bracket}
        raw.update({f'week-{w:02}.json':p for w,p in weeks.items() if w>=15})
        ds = derive_postseason(ds,mapping,ctx,bracket,weeks)
    # Reuse the original timestamp when facts are unchanged, avoiding empty refresh commits.
    ds = bd.derive_dataset(ds,ds['games'],ds.site['league']['current_season_through_week'],base.site['league']['generated_at_utc'])
    changed_facts = df.render(ds) != df.render(base)
    if changed_facts:
        ds = bd.derive_dataset(ds,ds['games'],ds.site['league']['current_season_through_week'],ctx['fetched_at_utc'])
    notes = [f"{ctx['season']}: verified regular season through Week {ds.site['league']['current_season_through_week']}."]
    archives = {}
    if bd.current_season(ds.site).get('phase') == 'Complete':
        notes.append('Championship verified. Finished season remains visible until the next completed Week 1.')
        try:
            next_league = successor(mapping,fetcher)
        except api.FetchError:
            next_league = None
            notes.append('Next-season discovery was unavailable; retrying next scheduled run. Current scores can still publish.')
        if next_league and next_league.get('status') in ('in_season','complete'):
            nextctx = api.fetch_context(next_league['league_id'],fetcher,now)
            if type(nextctx.get('last_scored_leg')) is int and nextctx['last_scored_leg'] >= 1:
                old_ds, old_map, old_year = ds,mapping,mapping['season']
                nextweeks = {w:api.fetch_week(nextctx['league_id'],w,nextctx['season'],fetcher,now) for w in range(1,min(nextctx['last_scored_leg'],14)+1)}
                ds,mapping = rollover(ds,mapping,nextctx,nextweeks,owner_changes)
                require(nextctx['last_scored_leg'] <= 14, 'New season already reached playoffs; run rollover before its postseason.')
                archives = {f'sleeper/archive/{old_year}/{f}':t for f,t in bundle_text(old_ds,old_map).items()}
                archives.update({f'sleeper/archive/{old_year}/raw/{f}':json.dumps(value,indent=2)+'\n' for f,value in raw.items()})
                for f in ('transactions.json','sleeper-sample.js','playoff-predictor.js'):
                    if (data/f).exists(): archives[f'sleeper/archive/{old_year}/{f}'] = (data/f).read_text()
                raw = {'context.json':nextctx,**{f'week-{w:02}.json':p for w,p in nextweeks.items()}}
                ctx = nextctx
                notes.append(f"Automatically switched to {mapping['season']} using its explicit previous-league link and stable owner IDs.")
    outputs = bundle_text(ds,mapping)
    outputs.update(archives)
    for f,payload in raw.items():
        target = data/'sleeper/raw'/str(mapping['season'])/f
        # Timestamp-only changes are not new evidence; keep earlier bytes on a no-op run.
        old = json.loads(target.read_text()) if target.exists() else None
        if old is not None and api._strip_time(old) == api._strip_time(payload): payload = old
        outputs['sleeper/raw/'+str(mapping['season'])+'/'+f] = json.dumps(payload,indent=2)+'\n'
    # A fresh player preview uses the current identity; remove hardcoded week-4 payloads on rollover.
    sample_path = data/'sleeper-sample.js'
    sample = json.loads(sample_path.read_text().split('=',1)[1].strip().rstrip(';')) if sample_path.exists() else {}
    if sample.get('season') != mapping['season'] or sample.get('league_id') != mapping['league_id']:
        sample = dict(league_id=mapping['league_id'],season=mapping['season'],owner_roster={oid:rid for rid,oid in mapping['rosters'].items()},players={})
    # Preserve names and resolve new starters once on the runner, never in a browser.
    latest_payload = raw.get(f"week-{ds.site['league']['current_season_through_week']:02}.json", {})
    starter_ids = {str(pid) for row in latest_payload.get('matchups',[]) for pid in row.get('starters',[]) if str(pid) != '0'}
    missing_ids = starter_ids - set(sample.get('players',{}))
    if missing_ids:
        try: sample.setdefault('players',{}).update(api.fetch_player_names(missing_ids,fetcher))
        except api.FetchError: notes.append('Optional starter names could not refresh; verified scores remain available.')
    # The optional ticker is independent of score publication.
    outputs['sleeper-sample.js'] = 'window.SPARTY_SLEEPER_SAMPLE = '+json.dumps(sample,separators=(',',':'),ensure_ascii=False)+';\n'
    with tempfile.TemporaryDirectory(prefix='season-candidate-') as stage:
        for f,t in df.render(ds).items(): (Path(stage)/f).write_text(t)
        problems = vf.verify_dir(stage); require(not problems,'Candidate verification failed: '+'; '.join(problems))
        sys.path.insert(0,str(ROOT/'tools/sparty'))
        import generate
        generate.generate(stage)
        outputs['sparty-records.js'] = (Path(stage)/'sparty-records.js').read_text()
    # A returning run must never rewrite an already-created archive.
    for f,t in outputs.items():
        if f.startswith('sleeper/archive/') and (data/f).exists():
            require((data/f).read_text() == t, 'An existing historical archive differs; refusing to overwrite it.')
    changed = {f:t for f,t in outputs.items() if not (data/f).exists() or (data/f).read_text() != t}
    return ds,changed,notes


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data-dir',type=Path,default=ROOT/'site-data')
    p.add_argument('--report',type=Path)
    p.add_argument('--github-output',type=Path)
    p.add_argument('--dry-run',action='store_true')
    args = p.parse_args(argv)
    code,lines,fields = 0,[],{}
    try:
        owner_changes = json.loads(os.environ['ROLLOVER_OWNER_CHANGES']) if os.environ.get('ROLLOVER_OWNER_CHANGES') else None
        ds,changed,notes = run(args.data_dir,owner_changes=owner_changes)
        if not args.dry_run:
            # Every candidate byte has passed verification before any working-tree mutation.
            for f,t in changed.items():
                target = args.data_dir/f; target.parent.mkdir(parents=True,exist_ok=True)
                with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=target.parent,delete=False) as out:
                    out.write(t); temp = out.name
                os.replace(temp,target)
        cur = bd.current_season(ds.site)
        fields = dict(status='ready' if changed else 'nothing',season=cur['year'],week=ds.site['league']['current_season_through_week'],files_changed=len(changed))
        code = 0 if changed else 10
        lines = ['## Season update','',*['- '+n for n in notes],'',f"{'Dry run: would change' if args.dry_run else 'Changed'} {len(changed)} files.",'',*['- `site-data/'+f+'`' for f in changed]]
    except (bd.GateError,api.FetchError,KeyError,ValueError,TypeError,OSError) as error:
        code = 2
        fields = dict(status='blocked')
        lines = ['## Season update blocked','','Nothing was published.','',str(error),'','See docs/season-automation.md for recovery steps.']
    report = '\n'.join(lines)+'\n'; print(report)
    if args.report: args.report.write_text(report)
    if args.github_output:
        with args.github_output.open('a') as out:
            out.write(''.join(f'{k}={v}\n' for k,v in fields.items()))
    return code


if __name__ == '__main__': sys.exit(main())
