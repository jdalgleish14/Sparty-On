import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import sync
from sync import count_transactions, build, max_points


def tx(id, kind='free_agent', status='complete', **kwargs):
    return dict(transaction_id=str(id), type=kind, status=status, roster_ids=[1], **kwargs)


class Counts(unittest.TestCase):
    def test_successful_unchanged_check_preserves_change_time(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'site-data').mkdir()
            target = root / 'site-data/transactions.json'
            previous = {'teams': [], 'fetched_at_utc': 'old-change'}
            target.write_text(json.dumps(previous))
            with patch.object(sync, 'ROOT', root), patch.object(sync, 'build', return_value={'teams': [], 'fetched_at_utc': 'new-fetch'}), patch.object(sync, 'utc_now', return_value='new-check'):
                sync.main()
            result = json.loads(target.read_text())
            self.assertEqual(result['fetched_at_utc'], 'old-change')
            self.assertEqual(result['checked_at_utc'], 'new-check')
            with patch.object(sync, 'ROOT', root), patch.object(sync, 'build', side_effect=RuntimeError('offline')):
                with self.assertRaises(RuntimeError):
                    sync.main()
            self.assertEqual(json.loads(target.read_text()), result)

    def test_max_points(self):
        self.assertEqual(max_points({'ppts': 1234, 'ppts_decimal': 5}), 1234.05)
        self.assertEqual(max_points({'ppts': 0}), 0)
        self.assertIsNone(max_points({}))
        for settings in ({'ppts': -1}, {'ppts': True}, {'ppts': float('nan')}, {'ppts': 1, 'ppts_decimal': 100}):
            with self.assertRaises(ValueError): max_points(settings)

    def test_counts_and_deduplication(self):
        rows = [tx(1, adds={'a':1,'b':1}), tx(2, drops={'c':1}),
                tx(3, 'waiver', adds={'d':1}), tx(4, 'waiver', 'failed', adds={'e':1}),
                tx(5, 'trade', draft_picks=[{'round':1}])]
        rows[-1]['roster_ids'] = [1,2,2]
        result = count_transactions([rows,rows], [1,2,3])
        self.assertEqual(result[1], dict(total=3,trades=1,free_agents=1,waivers=1))
        self.assertEqual(result[2]['trades'],1)
        self.assertEqual(result[3]['total'],0)

    def test_latest_status_wins(self):
        result = count_transactions([[tx(1,'trade',status_updated=1)], [tx(1,'trade','canceled',status_updated=2)]], [1])
        self.assertEqual(result[1]['total'],0)

    def test_bad_payload_fails(self):
        unknown = tx(1, 'trade')
        unknown['roster_ids'] = [99]
        for batches in ([{}], [[{}]], [[unknown]]):
            with self.assertRaises(ValueError):
                count_transactions(batches,[1])

    def test_full_fetch_and_week_zero(self):
        calls=[]
        def fetch(path):
            calls.append(path)
            if path.endswith('/rosters'):
                return [dict(roster_id=i,owner_id=str(i),settings={'ppts': 1000+i, 'ppts_decimal': 5}) for i in range(1,13)]
            if path.endswith('/users'):
                return []
            if '/transactions/' in path:
                return [tx(1,adds={'a':1})] if path.endswith('/0') else []
            return dict(league_id='1386532723459362816',season='2026',settings={'last_scored_leg': 7})
        output=build(fetch,lambda:'test')
        self.assertEqual(output['teams'][0]['total'],1)
        self.assertEqual(output['teams'][0]['max_pf'],1001.05)
        self.assertEqual(output['max_pf_through_week'],7)
        self.assertEqual(len([c for c in calls if '/transactions/' in c]),19)
        def failing(path):
            if path.endswith('/transactions/18'): raise RuntimeError('API failure')
            return fetch(path)
        with self.assertRaises(RuntimeError): build(failing)

if __name__ == '__main__': unittest.main()
