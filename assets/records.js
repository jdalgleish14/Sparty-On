/* Record tables use only the validated local games and owner-season summaries. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num=value=>Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const location=g=>g.stage==='Postseason'?esc(g.round):`Week ${g.week}`;
  const set=(id,v)=>{$(id).textContent=v;};
  try {
    const d=window.SPARTY_ON_DATA,report=d?.validation_report;
    if(!d||report?.status!=='PASS'||!Array.isArray(report.checks)||report.checks.some(c=>c.status!=='PASS')||d.games.length!==report.counts.game_rows)throw Error('Invalid snapshot');
    const current=d.seasons.filter(s=>s.status==='Current'),week=d.league.current_season_through_week;
    if(current.length!==1||!Number.isInteger(week)||week<1||week>current[0].regular_season_weeks||week!==report.publication_cutoff.current_season_through_week||d.games.some(g=>g.year===current[0].year&&(g.stage!=='Regular Season'||g.week>week)))throw Error('Unapproved cutoff');
    const pairs=new Map();
    for(const g of d.games){if(!pairs.has(g.game_id))pairs.set(g.game_id,[]);pairs.get(g.game_id).push(g);}
    if(pairs.size!==report.counts.all_games||[...pairs.values()].some(p=>p.length!==2||p[0].owner_id!==p[1].opponent_owner_id||p[0].points_for!==p[1].points_against))throw Error('Game pairs');
    const regular=d.games.filter(g=>g.stage==='Regular Season'),completed=d.season_summaries.filter(s=>s.season_status==='Complete');
    if(completed.length+d.season_summaries.filter(s=>s.season_status==='Current').length!==d.season_summaries.length)throw Error('Season status');
    const weekly=new Map();
    for(const g of regular){const key=`${g.year}-${g.week}`;if(!weekly.has(key))weekly.set(key,[]);weekly.get(key).push(g);}
    const weeks=[...weekly.values()].map(rows=>{
      const {year,week}=rows[0],season=d.seasons.find(s=>s.year===year);
      if(!season||rows.length!==season.team_count||new Set(rows.map(g=>g.owner_id)).size!==rows.length)throw Error('Incomplete weekly scores');
      const total=rows.reduce((sum,g)=>sum+g.points_for,0),wins=rows.filter(g=>g.result==='W'),losses=rows.filter(g=>g.result==='L');
      const avg=a=>a.length?a.reduce((sum,g)=>sum+g.points_for,0)/a.length:null;
      return {year,week,teams:rows.length,total,average:total/rows.length,winner:avg(wins),loser:avg(losses),margin:rows.reduce((sum,g)=>sum+Math.abs(g.margin),0)/rows.length,count100:rows.filter(g=>g.points_for>=100).length,count120:rows.filter(g=>g.points_for>=120).length,count140:rows.filter(g=>g.points_for>=140).length};
    });
    if(weeks.length!==new Set(regular.map(g=>`${g.year}-${g.week}`)).size)throw Error('Weekly count');
    const weekTypes=[
      ['totalHigh','Highest weekly total','total',true,'Total points','Avg team score'],['totalLow','Lowest weekly total','total',false,'Total points','Avg team score'],
      ['averageHigh','Highest average team score','average',true,'Avg team score','Weekly total'],['averageLow','Lowest average team score','average',false,'Avg team score','Weekly total'],
      ['winnerHigh','Highest average winning score','winner',true,'Avg winner','Avg team score'],['winnerLow','Lowest average winning score','winner',false,'Avg winner','Avg team score'],
      ['loserHigh','Highest average losing score','loser',true,'Avg loser','Avg team score'],['loserLow','Lowest average losing score','loser',false,'Avg loser','Avg team score'],
      ['marginHigh','Least competitive weeks','margin',true,'Avg margin','Avg team score'],['marginLow','Most competitive weeks','margin',false,'Avg margin','Avg team score'],
      ['count100','Most scores of 100+','count100',true,'Teams scoring 100+','Share of teams'],['count120','Most scores of 120+','count120',true,'Teams scoring 120+','Share of teams'],['count140','Most scores of 140+','count140',true,'Teams scoring 140+','Share of teams']
    ];
    $('week-category').innerHTML=weekTypes.map(([key,title])=>`<option value="${key}">${title}</option>`).join('');
    const gameTypes={highest_scores:['Highest scores','Points scored','Top individual scores from regular-season and postseason games.'],lowest_scores:['Lowest scores','Points scored','Lowest individual scores from regular-season and postseason games.'],largest_margins:['Biggest winning margins','Winning margin','Largest margins in completed matchups.'],closest_games:['Closest games','Final margin','Narrowest final scores, including postseason games.']};
    // Totals and records require completed seasons; rate metrics also admit
    // published current-season games, matching Historical Rankings.
    const seasonTypes={
      record:['Best win percentage','Win %','record',true,false],
      worst_record:['Worst win percentage','Win %','record',false,false],
      points_for:['Most points scored','Season PF','points_for',true,false],
      least_points_for:['Fewest points scored','Season PF','points_for',false,false],
      points_against:['Most points allowed','Season PA','points_against',true,false],
      least_points_against:['Fewest points allowed','Season PA','points_against',false,false],
      average_points_for:['Highest average score','Avg PF','average_points_for',true,true],
      lowest_average_points_for:['Lowest average score','Avg PF','average_points_for',false,true],
      average_points_against:['Highest average points allowed','Avg PA','average_points_against',true,true],
      lowest_average_points_against:['Lowest average points allowed','Avg PA','average_points_against',false,true],
      average_margin:['Best average margin','Avg margin','average_margin',true,true],
      worst_average_margin:['Worst average margin','Avg margin','average_margin',false,true]
    };
    $('season-category').innerHTML=Object.entries(seasonTypes).map(([key,[title]])=>`<option value="${key}">${title}</option>`).join('');
    const streakTypes={
      wins:['Longest winning streaks',true,g=>g.result==='W'],
      losses:['Longest losing streaks',true,g=>g.result==='L'],
      hundred:['Longest 100+ scoring streaks',false,g=>g.points_for>=100],
      top:['Longest top-half scoring streaks',false,g=>weeklyRank.get(g)<=weeklyHalf.get(g)],
      bottom:['Longest streaks outside the top half',false,g=>weeklyRank.get(g)>weeklyHalf.get(g)],
      first:['Longest weekly #1 scoring streaks',false,g=>weeklyRank.get(g)===1]
    };
    // Workbook uses competition ranks: tied scores share a rank, including
    // at the top-half boundary. Scoring streaks reset at the start of a season.
    const weeklyRank=new Map(),weeklyHalf=new Map();
    for(const rows of weekly.values())for(const g of rows){
      weeklyRank.set(g,1+rows.filter(o=>o.points_for>g.points_for).length);
      weeklyHalf.set(g,Math.ceil(rows.filter(o=>o.points_for>0).length/2));
    }
    $('streak-category').innerHTML=Object.entries(streakTypes).map(([key,[title]])=>`<option value="${key}">${title}</option>`).join('');
    set('records-freshness',`${current[0].year} · Through Week ${week}`);
    set('records-footer',`${current[0].year} · Through Week ${week} · Read-only snapshot`);
    $('record-counts').innerHTML=`<div><strong>${pairs.size.toLocaleString('en-US')}</strong><span>all matchups</span></div><div><strong>${completed.length}</strong><span>completed owner-seasons</span></div><div><strong>${weeks.length}</strong><span>regular-season weeks</span></div>`;
    function gameTable(key){
      if(!Object.prototype.hasOwnProperty.call(gameTypes,key))return;
      const [title,unit,note]=gameTypes[key],rows=d.records[key];
      if(!Array.isArray(rows)||rows.length!==25||rows.some(g=>!pairs.has(g.game_id)))throw Error('Game leaderboard');
      set('game-heading',title);set('game-value-heading',unit);set('game-description',note);
      const showScores=key==='largest_margins'||key==='closest_games';
      $('final-score-heading').hidden=!showScores;
      $('game-records-table').className=showScores?'record-table with-final-score':'record-table';
      $('game-records-body').innerHTML=rows.map((g,i)=>`<tr><td class="rank-number">${i+1}</td><td class="numeric standing-record">${num(key==='closest_games'?Math.abs(g.margin):key==='largest_margins'?g.margin:g.points_for)}</td><td class="owner-cell"><strong>${esc(g.owner_name)}</strong><span class="team-name">${esc(g.team)}</span></td><td class="owner-cell"><strong>${esc(g.opponent_owner_name)}</strong><span class="team-name">${esc(g.opponent_team)}</span></td>${showScores?`<td class="numeric final-score">${num(g.points_for)}–${num(g.points_against)}</td>`:''}<td>${g.year} · ${location(g)}</td></tr>`).join('');
    }
    function seasonTable(key){
      if(!Object.prototype.hasOwnProperty.call(seasonTypes,key))return;
      const [title,unit,field,high,includeCurrent]=seasonTypes[key];
      const scope=includeCurrent?'Completed + current seasons':'Completed seasons only';
      set('season-heading',title);set('season-value-heading',unit);set('season-scope',scope.toUpperCase());
      set('season-description',field==='record'?'Regular-season win percentage among completed owner-seasons.':field==='average_margin'?'Average points scored minus average points allowed per regular-season game.':`${unit.includes('Avg')?'Points per regular-season game':'Regular-season points in a completed season'}${field.includes('against')?' scored by opponents':' scored by the team'}.`);
      set('season-notes',`Top 25 owner-seasons. ${includeCurrent?'Current-season averages include only published weeks and can change substantially early in the season.':'Current seasons cannot qualify until complete; season lengths vary.'} PF = points for; PA = points against.`);
      const value=s=>field==='record'?(s.wins+0.5*s.ties)/s.games_played:field==='average_points_for'?s.points_for/s.games_played:field==='average_points_against'?s.points_against/s.games_played:field==='average_margin'?(s.points_for-s.points_against)/s.games_played:s[field];
      const pool=includeCurrent?d.season_summaries:completed;
      const ranked=pool.filter(s=>s.games_played>0).slice().sort((a,b)=>(high?-1:1)*(value(a)-value(b))||b.points_for-a.points_for||a.year-b.year||a.owner_id.localeCompare(b.owner_id)).slice(0,25);
      $('season-records-body').innerHTML=ranked.map((s,i)=>`<tr><td class="rank-number">${i+1}</td><td class="numeric standing-record">${field==='record'?(value(s)*100).toFixed(1)+'%':num(value(s))}</td><td class="owner-cell"><strong>${esc(d.owners.find(o=>o.owner_id===s.owner_id)?.owner_name)}</strong><span class="team-name">${esc(s.team)}</span></td><td>${s.year}${s.season_status==='Current'?' <small class="record-current">Current</small>':''}</td><td class="numeric">${s.wins}–${s.losses}${s.ties?`–${s.ties}`:''}</td><td class="numeric">${s.games_played}</td></tr>`).join('');
    }
    function streakTable(key){
      if(!Object.prototype.hasOwnProperty.call(streakTypes,key))return;
      const [title,allGames,predicate]=streakTypes[key];
      set('streak-heading',title);
      set('streak-description',allGames?'Consecutive played games, including postseason. Runs can span seasons; a tie breaks a winning or losing streak.':'Consecutive regular-season weeks within one season. Tied scores share their weekly rank, including at the top-half cutoff.');
      const grouped=new Map(),runs=[];
      const roundOrder={Quarterfinal:1,Semifinal:2,Championship:3};
      const ordered=(allGames?d.games:regular).slice().sort((a,b)=>a.year-b.year||(a.stage==='Postseason'?100+roundOrder[a.round]:a.week)-(b.stage==='Postseason'?100+roundOrder[b.round]:b.week)||a.owner_id.localeCompare(b.owner_id));
      for(const g of ordered){
        const group=allGames?g.owner_id:`${g.owner_id}/${g.year}`;
        let run=grouped.get(group);
        if(!predicate(g)){grouped.delete(group);continue;}
        if(!run){run={owner_id:g.owner_id,owner_name:g.owner_name,start:g,end:g,length:0};grouped.set(group,run);runs.push(run);}
        run.length++;run.end=g;
      }
      const ranked=runs.sort((a,b)=>b.length-a.length||a.start.year-b.start.year||a.start.week-b.start.week||a.owner_id.localeCompare(b.owner_id)).slice(0,25);
      const label=g=>`${g.year} · ${location(g)}`;
      $('streak-records-body').innerHTML=ranked.map((r,i)=>`<tr><td class="rank-number">${i+1}</td><td class="numeric standing-record">${r.length}</td><td class="owner-cell"><strong>${esc(r.owner_name)}</strong><span class="team-name">${esc(r.start.team)}</span></td><td>${label(r.start)}</td><td>${label(r.end)}</td></tr>`).join('');
    }
    function weekTable(key){
      const type=weekTypes.find(row=>row[0]===key);if(!type)return;
      const [id,title,field,high,unit,context]=type;set('week-heading',title);set('week-value-heading',unit);set('week-context-heading',context);
      set('week-description',field.startsWith('count')?'Counts show how many teams cleared the score threshold; the share beside each count adjusts for 12- and 14-team seasons.':field==='total'?'Total points scored by all teams that week, with average score per team alongside.':'Regular-season weeks only. The latest fully completed current-season week is included.');
      const countMetric=field.startsWith('count');
      const selected=weeks.filter(r=>r[field]!==null).sort((a,b)=>(high?b[field]-a[field]:a[field]-b[field])||(countMetric?b.year-a.year:a.year-b.year)||(countMetric?b.week-a.week:a.week-b.week)).slice(0,25);
      $('week-records-body').innerHTML=selected.map((r,i)=>{
        const detail=field==='total'?num(r.average):field==='average'?num(r.total):field.startsWith('count')?(r[field]/r.teams*100).toFixed(1)+'%':num(r.average);
        return `<tr><td class="rank-number">${i+1}</td><td>${r.year}${r.year===current[0].year?' <small class="record-current">Current</small>':''}</td><td>Week ${r.week}</td><td class="numeric standing-record">${field.startsWith('count')?r[field]:num(r[field])}</td><td class="numeric">${r.teams}</td><td>${detail}</td></tr>`;
      }).join('');
    }
    $('game-category').addEventListener('change',event=>gameTable(event.target.value));
    $('season-category').addEventListener('change',event=>seasonTable(event.target.value));
    $('week-category').addEventListener('change',event=>weekTable(event.target.value));
    $('streak-category').addEventListener('change',event=>streakTable(event.target.value));
    gameTable('highest_scores');seasonTable('record');streakTable('wins');weekTable('totalHigh');
    $('load-status').hidden=true;$('records-page').hidden=false;
  }catch(_){$('records-page').hidden=true;$('load-status').hidden=false;set('load-status','The record book could not be loaded. Keep the extracted site together and verify the exporter output.');}
})();
