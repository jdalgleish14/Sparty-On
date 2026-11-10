"""Synthetic snapshots shared by page integration checks."""
import copy
import json
import sys
import test_season_sync as fixture
import season_sync as ss

phase=sys.argv[1]
ds,m,ctx,weeks=fixture.regular14()
bracket,post=fixture.playoffs(ds,m)
ctx['last_scored_leg']=15 if phase=='quarterfinal' else 17
m=ss.pin_users(m,ctx)
ds=ss.derive_postseason(ds,m,ctx,bracket,post)
if phase=='week1':
    ctx=copy.deepcopy(ctx);ctx.update(league_id='9999',previous_league_id=m['league_id'],season='2027',last_scored_leg=1)
    week=copy.deepcopy(weeks[1]);week.update(league_id='9999',season='2027')
    ds,m=ss.rollover(ds,m,ctx,{1:week})
print(json.dumps(ds.site))
