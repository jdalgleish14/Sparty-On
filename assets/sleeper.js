/* Optional player highlights for the latest completed, verified week. */
(() => {
  'use strict';
  const sample=window.SPARTY_SLEEPER_SAMPLE;
  if(!sample||sample.league_id!=='1386532723459362816')return;
  const ownerFor=roster=>Object.keys(sample.owner_roster).find(id=>sample.owner_roster[id]===roster);
  const player=id=>sample.players[String(id)]||{name:`Player ${id}`};
  function topScorers(row,limit=3){
    return row.starters.map((id,i)=>({id:String(id),...player(id),points:Number(row.starters_points[i])})).filter(p=>p.id!=='0'&&Number.isFinite(p.points)).sort((a,b)=>b.points-a.points).slice(0,limit);
  }
  async function completedWeek(year,week,gameRows){
    if(year!==sample.season)return null;
    try{
      let rows;
      if(week===4)rows=sample.week4;
      else{
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
        try{
          const response=await fetch(`https://api.sleeper.app/v1/league/${sample.league_id}/matchups/${week}`,{signal:controller.signal,cache:'no-store'});
          if(!response.ok)return null;
          rows=await response.json();
        }finally{clearTimeout(timer);}
      }
      if(!Array.isArray(rows)||rows.length!==gameRows.length||new Set(rows.map(r=>r.roster_id)).size!==rows.length)return null;
      for(const row of rows){
        const official=gameRows.find(g=>g.owner_id===ownerFor(row.roster_id));
        if(!official||!Number.isFinite(Number(row.points))||!Array.isArray(row.starters)||!Array.isArray(row.starters_points)||row.starters.length!==row.starters_points.length||Math.abs(Number(row.custom_points??row.points)-official.points_for)>.011)return null;
      }
      return new Map(rows.map(row=>[ownerFor(row.roster_id),row]));
    }catch(_){return null;}
  }
  window.SPARTY_SLEEPER={completedWeek,topScorers};
})();
