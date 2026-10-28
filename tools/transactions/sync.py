"""Rebuild current Sleeper-season transaction totals; publish only complete fetches."""
import json
import math
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'sleeper'))
from sleeper_api import get_json, utc_now

CATEGORIES = {'trade': 'trades', 'free_agent': 'free_agents', 'waiver': 'waivers'}


def count_transactions(batches, roster_ids):
    totals = {int(r): dict(total=0, trades=0, free_agents=0, waivers=0) for r in roster_ids}
    latest = {}
    for batch in batches:
        if not isinstance(batch, list):
            raise ValueError('Invalid transactions response')
        for tx in batch:
            if not isinstance(tx, dict) or not tx.get('transaction_id'):
                raise ValueError('Transaction missing ID')
            key = str(tx['transaction_id'])
            if key not in latest or (tx.get('status_updated') or 0) > (latest[key].get('status_updated') or 0):
                latest[key] = tx
    for tx in latest.values():
        category = CATEGORIES.get(tx.get('type'))
        if tx.get('status') != 'complete' or category is None:
            continue
        participants = {int(r) for r in (tx.get('roster_ids') or [])}
        if not participants or not participants.issubset(totals):
            raise ValueError('Unknown transaction roster')
        if category != 'trades':
            # Drop-only transactions share the free_agent type. Only recipients count.
            participants = {int(r) for r in (tx.get('adds') or {}).values()}
            if not participants.issubset(totals):
                raise ValueError('Unknown pickup recipient')
        for roster in participants:
            totals[roster][category] += 1
            totals[roster]['total'] += 1
    return totals


def transaction_histories(batches, roster_ids, players, names):
    """Resolve completed, counted moves from each participating team's perspective."""
    histories = {int(r): [] for r in roster_ids}
    latest = {}
    for batch in batches:
        for tx in batch:
            key = str(tx['transaction_id'])
            if key not in latest or (tx.get('status_updated') or 0) > (latest[key].get('status_updated') or 0):
                latest[key] = tx
    def player(pid):
        info = players.get(str(pid)) or {}
        name = info.get('full_name') or ' '.join(filter(None, [info.get('first_name'), info.get('last_name')])) or f'Player {pid}'
        return dict(kind='player', player_id=str(pid), label=name, position=info.get('position'))
    for tx in latest.values():
        counted = count_transactions([[tx]], roster_ids)
        participants = [rid for rid, totals in counted.items() if totals['total']]
        if not participants:
            continue
        stamp = tx.get('status_updated') or tx.get('created')
        if stamp is not None and (type(stamp) not in (int, float) or not math.isfinite(stamp) or stamp < 0):
            raise ValueError('Invalid transaction timestamp')
        for rid in participants:
            received, sent = [], []
            for field, destination in [('adds', received), ('drops', sent)]:
                for pid, owner in (tx.get(field) or {}).items():
                    if int(owner) == rid:
                        destination.append(player(pid))
            for pick in tx.get('draft_picks') or []:
                origin = int(pick['roster_id'])
                receiver = int(pick['owner_id'])
                sender = int(pick['previous_owner_id']) if 'previous_owner_id' in pick else None
                if sender is None:
                    raise ValueError('Draft pick missing previous owner')
                if any(v not in histories for v in (origin, sender, receiver)):
                    raise ValueError('Unknown pick roster')
                asset = dict(kind='pick', label=f"{pick['season']} Round {pick['round']} ({names[origin]})")
                if receiver == rid: received.append(asset)
                if sender == rid: sent.append(asset)
            for budget in tx.get('waiver_budget') or []:
                sender, receiver = int(budget['sender']), int(budget['receiver'])
                amount = budget['amount']
                if sender not in histories or receiver not in histories or type(amount) not in (int, float) or not math.isfinite(amount) or amount < 0:
                    raise ValueError('Invalid FAAB transfer')
                asset = dict(kind='faab', label=f'${amount:g} FAAB')
                if receiver == rid: received.append(asset)
                if sender == rid: sent.append(asset)
            histories[rid].append(dict(transaction_id=str(tx['transaction_id']), type=tx['type'], timestamp_ms=stamp,
                partners=[names[p] for p in participants if p != rid], received=received, sent=sent,
                waiver_bid=(tx.get('settings') or {}).get('waiver_bid') if tx['type'] == 'waiver' else None))
    for rows in histories.values():
        rows.sort(key=lambda t: (t['timestamp_ms'] or 0, t['transaction_id']), reverse=True)
    return histories


def max_points(settings):
    """Sleeper stores potential points as whole points plus hundredths."""
    whole = settings.get('ppts')
    decimal = settings.get('ppts_decimal', 0)
    if whole is None:
        return None
    if (type(whole) not in (int, float) or not math.isfinite(whole) or whole < 0
            or type(decimal) is not int or not 0 <= decimal <= 99):
        raise ValueError('Invalid Sleeper Max PF')
    return round(whole + decimal / 100, 2)


def build(fetch=get_json, now=utc_now):
    config = json.loads((ROOT / 'site-data/sleeper/owner_map.json').read_text())
    league_id = config['league_id']
    league = fetch(f'/league/{league_id}')
    if str(league.get('league_id')) != league_id or int(league['season']) != config['season']:
        raise ValueError('League/season differs from pinned owner map; review rollover first')
    rosters = fetch(f'/league/{league_id}/rosters')
    users = {u['user_id']: u for u in fetch(f'/league/{league_id}/users')}
    if {str(r['roster_id']) for r in rosters} != set(config['rosters']):
        raise ValueError('Roster map mismatch')
    # Include week 0 and every NFL leg, independent of the published scoring cutoff.
    batches = [fetch(f'/league/{league_id}/transactions/{week}') for week in range(0, 19)]
    totals = count_transactions(batches, config['rosters'])
    rows = []
    for roster in rosters:
        rid = roster['roster_id']
        user = users.get(roster.get('owner_id'), {})
        name = (user.get('metadata') or {}).get('team_name') or user.get('display_name') or f'Team {rid}'
        settings = roster.get('settings') or {}
        rows.append(dict(max_pf=max_points(settings), roster_id=rid, owner_id=config['rosters'][str(rid)], team=name, **totals[rid]))
    players = fetch('/players/nfl')
    if not isinstance(players, dict):
        raise ValueError('Invalid player directory')
    histories = transaction_histories(batches, config['rosters'], players, {row['roster_id']: row['team'] for row in rows})
    for row in rows:
        row['history'] = histories[row['roster_id']]
    return dict(history_version=1, max_pf_through_week=(league.get('settings') or {}).get('last_scored_leg'), league_id=league_id, season=config['season'], fetched_at_utc=now(), weeks_scanned=list(range(19)), teams=sorted(rows, key=lambda r: r['roster_id']))


def main():
    result = build()  # All requests and validation finish before touching published data.
    target = ROOT / 'site-data/transactions.json'
    previous = json.loads(target.read_text()) if target.exists() else None
    # Record successful checks even when totals have not changed. Keep the
    # original change timestamp for consumers that already use it.
    if previous and {k:v for k,v in previous.items() if k not in ('fetched_at_utc', 'checked_at_utc')} == {k:v for k,v in result.items() if k not in ('fetched_at_utc', 'checked_at_utc')}:
        result['fetched_at_utc'] = previous['fetched_at_utc']
    result['checked_at_utc'] = utc_now()
    fd, temporary = tempfile.mkstemp(dir=target.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(result, stream, indent=2)
            stream.write('\n')
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == '__main__':
    main()
