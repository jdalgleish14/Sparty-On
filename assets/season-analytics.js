/* Presentation calculations match the workbook's yearly season formulas.
   Inputs are validated, cutoff-limited exported records; no manual site inputs. */
(() => {
  'use strict';
  window.buildSeasonAnalytics = (data, season, throughWeek) => {
    const roster=season.roster_owner_ids;
    if (!Array.isArray(roster) || roster.length!==season.team_count || new Set(roster).size!==roster.length) throw new Error('Missing roster order');
    const rosterPosition=new Map(roster.map((id,i)=>[id,i]));
    const games=data.games.filter(g=>g.year===season.year && g.stage==='Regular Season' && g.week<=throughWeek);
    const source=season.status==='Complete'?data.season_summaries.filter(s=>s.year===season.year):data.current_standings;
    const standings=source.map(s=>({...s,bonus_wins:0,bonus_losses:0,expected_wins:0,roster_position:rosterPosition.get(s.owner_id)}));
    if (standings.length!==roster.length || standings.some(s=>s.roster_position===undefined)) throw new Error('Roster mismatch');
    const byOwner=new Map(standings.map(s=>[s.owner_id,s])), weekly=[];
    for (let week=1;week<=throughWeek;week++) {
      const rows=games.filter(g=>g.week===week);
      if (rows.length!==roster.length || new Set(rows.map(g=>g.owner_id)).size!==roster.length || rows.some(g=>!byOwner.has(g.owner_id))) throw new Error('Incomplete scoring week');
      // A score tied at the top-half cutoff goes to the earlier workbook roster row.
      const ordered=[...rows].sort((a,b)=>b.points_for-a.points_for || rosterPosition.get(a.owner_id)-rosterPosition.get(b.owner_id));
      const positives=rows.filter(g=>g.points_for>0).length;
      ordered.forEach((g,i)=>{
        const s=byOwner.get(g.owner_id);
        if(i<Math.floor(roster.length/2))s.bonus_wins++;else s.bonus_losses++;
        // Replicate the workbook's zero-score guard and half-credit score ties.
        if(g.points_for!==0 && positives>1){
          const beaten=rows.filter(o=>o.points_for<g.points_for).length;
          const tied=rows.filter(o=>o.points_for===g.points_for).length-1;
          s.expected_wins+=(beaten+0.5*tied)/(positives-1);
        }
      });
      const wins=rows.filter(g=>g.result==='W'), losses=rows.filter(g=>g.result==='L');
      const avg=(a,key)=>a.length?a.reduce((sum,g)=>sum+g[key],0)/a.length:null;
      weekly.push({week,average_winner:avg(wins,'points_for'),average_loser:avg(losses,'points_for'),total_points:rows.reduce((s,g)=>s+g.points_for,0),average_margin:rows.reduce((s,g)=>s+Math.abs(g.margin),0)/rows.length});
    }
    standings.forEach(s=>{s.adjusted_wins=s.wins+s.bonus_wins;s.adjusted_losses=s.losses+s.bonus_losses;s.luck=s.wins-s.expected_wins;});
    // Workbook sort helpers use PF, then later roster row, for exact bonus ties;
    // Luck uses its unrounded value + worksheet row / 1,000,000.
    const bonus=[...standings].sort((a,b)=>b.adjusted_wins-a.adjusted_wins || b.points_for-a.points_for || b.roster_position-a.roster_position);
    const luck=[...standings].sort((a,b)=>(b.luck+(b.roster_position+4)/1e6)-(a.luck+(a.roster_position+4)/1e6));
    const choose=(title,rows,key,max=true)=>{
      if(!rows.length)return {title,value:null,games:[]};
      const value=(max?Math.max:Math.min)(...rows.map(g=>g[key]));
      return {title,value,games:rows.filter(g=>g[key]===value)};
    };
    const wins=games.filter(g=>g.result==='W'),losses=games.filter(g=>g.result==='L');
    const unique=[...new Map(games.map(g=>[g.game_id,g.result==='W'?g:data.games.find(other=>other.game_id===g.game_id&&other.result==='W')||g])).values()];
    const records=[choose('Highest score',games,'points_for'),choose('Lowest score',games,'points_for',false),choose('Highest loss',losses,'points_for'),choose('Lowest win',wins,'points_for',false),choose('Biggest margin',wins,'margin'),choose('Smallest margin',unique.map(g=>({...g,margin:Math.abs(g.margin)})),'margin',false)];
    return {bonus,luck,weekly,records};
  };
})();
