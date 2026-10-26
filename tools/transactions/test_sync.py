import unittest
from sync import count_transactions, build


def tx(id, kind='free_agent', status='complete', **kwargs):
    return dict(transaction_id=str(id), type=kind, status=status, roster_ids=[1], **kwargs)


class Counts(unittest.TestCase):
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
                return [dict(roster_id=i,owner_id=str(i)) for i in range(1,13)]
            if path.endswith('/users'):
                return []
            if '/transactions/' in path:
                return [tx(1,adds={'a':1})] if path.endswith('/0') else []
            return dict(league_id='1386532723459362816',season='2026')
        output=build(fetch,lambda:'test')
        self.assertEqual(output['teams'][0]['total'],1)
        self.assertEqual(len([c for c in calls if '/transactions/' in c]),19)
        def failing(path):
            if path.endswith('/transactions/18'): raise RuntimeError('API failure')
            return fetch(path)
        with self.assertRaises(RuntimeError): build(failing)

if __name__ == '__main__': unittest.main()
