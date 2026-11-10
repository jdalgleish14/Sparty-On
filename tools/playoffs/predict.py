"""Reproducible batch playoff forecasts; no AI, credentials, or live browser calls."""
import argparse, collections, hashlib, json, math
from pathlib import Path
import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

RULES = dict(playoff_teams=8, regular_weeks=14, playoff_weeks=[15,16,17], divisions=False, reseed=False, byes=False, tiebreaker='PF')

def read(p): return json.loads(p.read_text())
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def pairings(payload, roster_map):
    if not isinstance(payload,list) or len(payload)!=len(roster_map): raise ValueError('Incomplete weekly schedule')
    groups=collections.defaultdict(list); seen=set()
    for r in payload:
        key=str(r.get('roster_id'))
        if key not in roster_map or key in seen or not isinstance(r.get('matchup_id'),int): raise ValueError('Invalid roster or matchup ID')
        seen.add(key); groups[r['matchup_id']].append(roster_map[key])
    if any(len(g)!=2 for g in groups.values()): raise ValueError('Each matchup must have exactly two teams')
    return [sorted(g) for _,g in sorted(groups.items())]

def prepare(root, schedule_dir):
    manifest=read(root/'manifest.json')
    for name in ['games.json','current_standings.json','owner_careers.json']:
        if digest(root/name)!=manifest['files'][name]['sha256']: raise ValueError('Published checksum mismatch: '+name)
    mapping=read(root/'sleeper/owner_map.json'); year=mapping['season']
    cutoff=manifest['publication_cutoff']['current_season_through_week']
    if not 2<=cutoff<=14: raise ValueError('Forecast requires 2–14 completed regular-season weeks')
    standings=read(root/'current_standings.json'); ids=sorted(mapping['rosters'].values())
    if len(ids)!=12 or len(set(ids))!=12 or {r['owner_id'] for r in standings}!=set(ids) or len(standings)!=12: raise ValueError('Current roster mismatch')
    games=[g for g in read(root/'games.json') if g['year']==year and g['stage']=='Regular Season' and g['week']<=cutoff]
    scores=np.empty((cutoff,12)); lookup={r['owner_id']:r for r in standings}
    for i,owner in enumerate(ids):
        rows=sorted([g for g in games if g['owner_id']==owner],key=lambda r:r['week'])
        if [g['week'] for g in rows]!=list(range(1,cutoff+1)): raise ValueError('Missing or duplicated score week')
        vals=[g['points_for'] for g in rows]
        if any(not isinstance(x,(float,int)) or not math.isfinite(x) or x<0 for x in vals): raise ValueError('Invalid historical score')
        s=lookup[owner]
        if s['year']!=year or s['games_played']!=cutoff or abs(sum(vals)-s['points_for'])>.011 or any(sum(g['result']==k for g in rows)!=s[f] for k,f in [('W','wins'),('L','losses'),('T','ties')]): raise ValueError('Scores and standings disagree')
        scores[:,i]=vals
    future=[]; raw_hashes={}
    for week in range(cutoff+1,15):
        p=schedule_dir/f'week-{week:02}.json'; pairs=pairings(read(p),mapping['rosters']);raw_hashes[p.name]=digest(p)
        future.append((week,[(ids.index(a),ids.index(b)) for a,b in pairs]))
    names={o['owner_id']:o['owner_name'] for o in read(root/'owner_careers.json')}
    return dict(ids=ids,standings=[lookup[i] for i in ids],names=names,scores=scores,future=future,year=year,cutoff=cutoff,schedule_hashes=raw_hashes,source_hash=digest(root/'current_standings.json'),games_hash=digest(root/'games.json'))

def rank_bounds(units,pairs,target):
    """Certified conservative rank bounds, including future game ties and unknown PF.
    Target winning out minimizes rank; losing out maximizes it. MILP allocates every
    other game 0,1,2 half-wins. Competitors tied on record take the adverse PF order.
    No bound assumes a future scoring ceiling or freezes current PF.
    """
    n=len(units); results=[]
    for worst in [False,True]:
        base=np.array(units,dtype=float); free=[]
        for a,b in pairs:
            if target in (a,b): base[(b if a==target else a) if worst else target]+=2
            else: free.append((a,b));base[b]+=2
        m=len(free); others=[i for i in range(n) if i!=target]; count=m+len(others)
        objective=np.r_[np.zeros(m),np.full(len(others),-1 if worst else 1)]
        matrix=[];lower=[];upper=[];big=2*len(pairs)+max(units)+3
        for j,i in enumerate(others):
            row=np.zeros(count)
            for k,(a,b) in enumerate(free): row[k]=(1 if i==a else -1 if i==b else 0)
            row[m+j]=-big
            matrix.append(row)
            if worst: lower.append(base[target]-base[i]-big);upper.append(np.inf)
            else: lower.append(-np.inf);upper.append(base[target]-base[i])
        r=milp(objective,integrality=np.ones(count),bounds=Bounds(np.zeros(count),np.r_[np.full(m,2),np.ones(len(others))]),constraints=LinearConstraint(np.array(matrix),lower,upper),options={'time_limit':10,'mip_rel_gap':0})
        if not r.success: results.append(None)
        else: results.append(1+int(round(sum(r.x[m:]))))
    return results

def finish_bounds(units,pairs,target,extra_wins):
    """Conservative seed bounds at a target final record score, including tied games."""
    n=len(units);m=len(pairs);others=[i for i in range(n) if i!=target];count=m+n-1
    base=np.array(units,dtype=float);coeff=np.zeros((n,count))
    for k,(a,b) in enumerate(pairs):base[b]+=2;coeff[a,k]=1;coeff[b,k]=-1
    threshold=units[target]+2*extra_wins;big=max(units)+2*len(pairs)+3;result=[]
    for worst in [False,True]:
        matrix=[coeff[target].copy()];lo=[threshold-base[target]];hi=lo.copy()
        for j,i in enumerate(others):
            row=coeff[i].copy();row[m+j]=-big;matrix.append(row)
            lo.append(threshold-base[i]-big if worst else -np.inf)
            hi.append(np.inf if worst else threshold-base[i])
        r=milp(np.r_[np.zeros(m),np.full(n-1,-1 if worst else 1)],integrality=np.ones(count),bounds=Bounds(np.zeros(count),np.r_[np.full(m,2),np.ones(n-1)]),constraints=LinearConstraint(matrix,lo,hi),options={'time_limit':5,'mip_rel_gap':0})
        result.append(1+int(round(sum(r.x[m:]))) if r.success else None)
    return result

def forecast(d,trials=50000,seed=20261029,prior_weeks=4):
    if trials<100 or trials>1000000: raise ValueError('Use 100–1,000,000 simulations')
    rng=np.random.default_rng(seed);n=len(d['ids']); scores=d['scores'];future=d['future']
    units=np.array([2*s['wins']+s['ties'] for s in d['standings']]);pf=np.array([s['points_for'] for s in d['standings']],dtype=float)
    league_mean=float(scores.mean());means=(scores.sum(axis=0)+prior_weeks*league_mean)/(len(scores)+prior_weeks)
    # Pool score variance across teams; shrink noisy seven-week strength estimates.
    sd=max(10.,float(np.std(scores-scores.mean(axis=0),ddof=1)))
    u=np.tile(units,(trials,1));p=np.tile(pf,(trials,1));wins=np.tile(np.array([s['wins'] for s in d['standings']]),(trials,1))
    for _,pairs in future:
        draw=np.maximum(0,rng.normal(means,sd,size=(trials,n)));p+=draw
        for a,b in pairs:
            aw=draw[:,a]>draw[:,b];bw=draw[:,b]>draw[:,a];tie=~(aw|bw)
            u[:,a]+=2*aw+tie;u[:,b]+=2*bw+tie;wins[:,a]+=aw;wins[:,b]+=bw
    # Wins + half ties; PF is the only known secondary tiebreaker.
    order=np.lexsort((-p,-u),axis=1);ranks=np.empty_like(order)
    for rank in range(n): ranks[np.arange(trials),order[:,rank]]=rank+1
    if not future:
        for i in range(n):
            if any(i!=j and units[i]==units[j] and pf[i]==pf[j] for j in range(n)): raise ValueError('Final record/PF tie needs commissioner resolution')
    flat=[pair for _,pairs in future for pair in pairs];rows=[]
    for i,owner in enumerate(d['ids']):
        best,worst=rank_bounds(units.tolist(),flat,i) if future else [int(ranks[0,i])]*2
        status='Clinched' if worst is not None and worst<=8 else 'Eliminated' if best is not None and best>8 else 'Not proven'
        count=int(np.sum(ranks[:,i]<=8));prob=count/trials
        paths=[]
        for k in range(len(future)+1):
            lower,upper=finish_bounds(units.tolist(),flat,i,k) if future else (best,worst)
            paths.append(dict(extra_wins=k,total_wins=d['standings'][i]['wins']+k,best_bound=lower,worst_bound=upper,guaranteed=upper is not None and upper<=8,ruled_out=lower is not None and lower>8))
        rows.append(dict(finish_paths=paths,owner_id=owner,owner=d['names'][owner],record=f"{d['standings'][i]['wins']}–{d['standings'][i]['losses']}"+(f"–{d['standings'][i]['ties']}" if d['standings'][i]['ties'] else ''),playoff_pct=round(100*prob,3),mc_error_pp=round(100*1.96*math.sqrt(prob*(1-prob)/trials),3),projected_wins=round(float(wins[:,i].mean()),2),average_seed=round(float(ranks[:,i].mean()),2),seed_pct=[round(100*float(np.mean(ranks[:,i]==k)),3) for k in range(1,n+1)],status=status,best_rank_bound=best,worst_rank_bound=worst))
    rows.sort(key=lambda r:(-r['playoff_pct'],r['average_seed'],r['owner']))
    return dict(schema=1,rules=RULES,season=d['year'],through_week=d['cutoff'],source_hash=d['source_hash'],games_hash=d['games_hash'],schedule_hashes=d['schedule_hashes'],trials=trials,random_seed=seed,score_signature=d['scores'].tolist(),standings_signature=[[s['owner_id'],s['wins'],s['losses'],s['ties'],s['points_for']] for s in d['standings']],model=dict(name='Shrunk current-season scoring',means=means.tolist(),prior_weeks=prior_weeks,pooled_weekly_sd=round(sd,3),future_ties='Not simulated; included in proof bounds'),teams=rows,remaining_schedule=[dict(week=w,games=[[d['ids'][a],d['ids'][b]] for a,b in ps]) for w,ps in future])

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--data',type=Path,default=Path('site-data'));parser.add_argument('--schedule',type=Path);parser.add_argument('--fetch',action='store_true');parser.add_argument('--trials',type=int,default=50000);parser.add_argument('--output',type=Path,default=Path('site-data/playoff-predictor.js'));args=parser.parse_args()
    schedule=args.schedule or args.data/'playoffs/raw'
    # Forecasts apply only to an active regular season with enough scoring history.
    bundle=(args.data/'site-data.js').read_text().split('=',1)[1].strip().rstrip(';')
    site=json.loads(bundle); current=next(s for s in site['seasons'] if s['status']=='Current')
    if current.get('postseason_through_round') or site['league']['current_season_through_week'] < 2:
        print('Forecast not needed: postseason or fewer than two completed weeks.'); return
    if args.fetch:
        import sys
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'sleeper'))
        from sleeper_api import get_json
        mapping=read(args.data/'sleeper/owner_map.json');league=get_json('/league/'+mapping['league_id']);settings=league['settings']
        if int(league['season'])!=mapping['season'] or int(settings.get('playoff_week_start',0))!=15 or int(settings.get('playoff_teams',0))!=8 or settings.get('divisions',0) or settings.get('playoff_seed_type',0) or settings.get('playoff_round_type',0) or settings.get('league_average_match',0) or settings.get('start_week',1)!=1: raise ValueError('Live league settings conflict with approved rules; review before publication')
        cutoff=read(args.data/'manifest.json')['publication_cutoff']['current_season_through_week'];schedule.mkdir(parents=True,exist_ok=True)
        (schedule/'league.json').write_text(json.dumps(league,indent=2)+'\n')
        for week in range(cutoff+1,15):
            payload=get_json(f"/league/{mapping['league_id']}/matchups/{week}");pairings(payload,mapping['rosters']);(schedule/f'week-{week:02}.json').write_text(json.dumps(payload,indent=2)+'\n')
    result=forecast(prepare(args.data,schedule),args.trials)
    args.output.parent.mkdir(parents=True,exist_ok=True);tmp=args.output.with_suffix('.tmp');tmp.write_text('window.SPARTY_PLAYOFFS = '+json.dumps(result,separators=(',',':'),allow_nan=False)+';\n');tmp.replace(args.output)
    print(f"PASS: {result['season']} Week {result['through_week']}, {result['trials']:,} simulations")
if __name__=='__main__': main()
