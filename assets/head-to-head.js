/* Two-owner history from published paired games and the verified matchup summary. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num=value=>Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const set=(id,value)=>{$(id).textContent=value;};
  const score=(rows)=>({games:rows.length,wins:rows.filter(g=>g.result==='W').length,losses:rows.filter(g=>g.result==='L').length,ties:rows.filter(g=>g.result==='T').length,pf:rows.reduce((sum,g)=>sum+g.points_for,0),pa:rows.reduce((sum,g)=>sum+g.points_against,0)});
  const record=stats=>`${stats.wins}–${stats.losses}${stats.ties?`–${stats.ties}`:''}`;
  try {
    const d=window.SPARTY_ON_DATA,report=d?.validation_report;
    if(!d||report?.status!=='PASS'||!Array.isArray(report.checks)||report.checks.some(c=>c.status!=='PASS')||d.games.length!==report.counts.game_rows||d.owners.length!==report.counts.owners)throw Error('Invalid snapshot');
    const current=d.seasons.filter(s=>s.status==='Current'),cutoff=d.league.current_season_through_week;
    if(current.length!==1||!Number.isInteger(cutoff)||cutoff<1||cutoff>current[0].regular_season_weeks||cutoff!==report.publication_cutoff.current_season_through_week||d.games.some(g=>g.year===current[0].year&&(g.stage!=='Regular Season'||g.week>cutoff)))throw Error('Unapproved games');
    const owners=[...d.owners].sort((a,b)=>a.owner_name.localeCompare(b.owner_name)),names=new Map(owners.map(o=>[o.owner_id,o.owner_name]));
    const pairKey=(a,b)=>[a,b].sort().join('|'),byPair=new Map();
    for(const g of d.games){
      if(!names.has(g.owner_id)||!names.has(g.opponent_owner_id)||g.owner_id===g.opponent_owner_id)throw Error('Owner reference');
      const key=pairKey(g.owner_id,g.opponent_owner_id);
      if(!byPair.has(key))byPair.set(key,[]);
      byPair.get(key).push(g);
    }
    if(byPair.size!==d.head_to_head.length)throw Error('Pair count');
    const summaries=new Map();
    for(const h of d.head_to_head){
      const key=pairKey(h.owner_a_id,h.owner_b_id),rows=byPair.get(key),a=rows?.filter(g=>g.owner_id===h.owner_a_id),b=rows?.filter(g=>g.owner_id===h.owner_b_id);
      if(!a||summaries.has(key)||a.length!==h.games||b.length!==h.games||a.filter(g=>g.result==='W').length!==h.owner_a_wins||b.filter(g=>g.result==='W').length!==h.owner_b_wins||a.filter(g=>g.result==='T').length!==h.ties||Math.abs(a.reduce((sum,g)=>sum+g.points_for,0)-h.owner_a_pf)>.011||Math.abs(b.reduce((sum,g)=>sum+g.points_for,0)-h.owner_b_pf)>.011||a.some(g=>!b.some(other=>other.game_id===g.game_id&&other.points_for===g.points_against&&other.points_against===g.points_for)))throw Error('Head-to-head summary disagrees');
      summaries.set(key,h);
    }
    const teamName=(id,year,fallback)=>d.season_summaries.find(s=>s.owner_id===id&&s.year===year)?.team||fallback;
    const roundOrder={Quarterfinal:1,Semifinal:2,Championship:3};
    const recency=(a,b)=>b.year-a.year||(b.stage==='Postseason'?1:0)-(a.stage==='Postseason'?1:0)||(b.week||roundOrder[b.round]||0)-(a.week||roundOrder[a.round]||0);
    const stageName=g=>g.stage==='Postseason'?g.round:`Week ${g.week}`;
    const aSelect=$('owner-a'),bSelect=$('owner-b');
    let first='';
    let second='';
    if(owners.length<2)throw Error('Need two owners');
    set('rivalry-freshness',`${current[0].year} · Through Week ${cutoff}`);
    set('rivalry-footer',`${current[0].year} · Through Week ${cutoff} · Read-only snapshot`);
    function options(){
      aSelect.innerHTML='<option value="">Select an owner</option>'+owners.filter(o=>o.owner_id!==second).map(o=>`<option value="${esc(o.owner_id)}">${esc(o.owner_name)}</option>`).join('');
      bSelect.innerHTML='<option value="">Select an owner</option>'+owners.filter(o=>o.owner_id!==first).map(o=>`<option value="${esc(o.owner_id)}">${esc(o.owner_name)}</option>`).join('');
      aSelect.value=first;bSelect.value=second;
    }
    function gameCard(g){
      const side=(name,team,value,winner)=>`<div class="archive-side${winner?' winner':''}"><span><strong>${esc(name)}</strong><small>${esc(team)}</small></span><b>${num(value)}</b></div>`;
      return `<article class="archive-game" data-game="${esc(g.game_id)}"><p class="rivalry-game-meta">${g.year} · ${esc(stageName(g))}${g.year===current[0].year?' · In progress':''}</p>${side(names.get(first),g.team,g.points_for,g.result==='W')}${side(names.get(second),g.opponent_team,g.points_against,g.result==='L')}</article>`;
    }
    function render(){
      options();if(!first||!second){$('rivalry-prompt').hidden=false;$('rivalry-has-games').hidden=true;$('rivalry-empty').hidden=true;document.querySelector('.rivalry-hero').hidden=true;return;} $('rivalry-prompt').hidden=true;document.querySelector('.rivalry-hero').hidden=false;set('rivalry-title',`${names.get(first)} vs ${names.get(second)}`);
      const key=pairKey(first,second),summary=summaries.get(key),rows=(byPair.get(key)||[]).filter(g=>g.owner_id===first).sort(recency);
      if(!summary){
        $('rivalry-has-games').hidden=true;$('rivalry-empty').hidden=false;
        $('rivalry-score').innerHTML='<strong>0</strong><span>—</span><strong>0</strong>';
        set('rivalry-summary','No published matchups between these owners.');
        return;
      }
      const all=score(rows);
      if(all.games!==summary.games)throw Error('Missing pair');
      $('rivalry-has-games').hidden=false;$('rivalry-empty').hidden=true;
      $('rivalry-score').innerHTML=`<strong>${all.wins}</strong><span>${all.ties?`${all.ties} tie${all.ties===1?'':'s'} · `:''}${all.games} games</span><strong>${all.losses}</strong>`;
      set('rivalry-summary',`${names.get(first)}: ${num(all.pf)} total points · ${names.get(second)}: ${num(all.pa)} total points · ${rows[rows.length-1].year}–${rows[0].year}`);
      set('stage-record-heading',`${names.get(first)} W–L`);set('stage-pf-heading',`${names.get(first)} PF`);set('stage-pa-heading',`${names.get(second)} PF`);
      $('stage-body').innerHTML=[['Regular season',rows.filter(g=>g.stage==='Regular Season')],['Postseason',rows.filter(g=>g.stage==='Postseason')],['All games',rows]].map(([label,games])=>{const s=score(games);return `<tr><td>${label}</td><td class="numeric">${s.games}</td><td class="numeric standing-record">${record(s)}</td><td class="numeric">${num(s.pf)}</td><td class="numeric">${num(s.pa)}</td></tr>`;}).join('');
      const closest=[...rows].sort((a,b)=>Math.abs(a.margin)-Math.abs(b.margin)||recency(a,b))[0];
      const biggest=[...rows].sort((a,b)=>Math.abs(b.margin)-Math.abs(a.margin)||recency(a,b))[0];
      const last=rows[0],moment=(title,g,detail)=>`<div class="rivalry-moment"><span>${title}</span><strong>${esc(detail)} · ${g.year} ${esc(stageName(g))}</strong><small>${esc(g.team)} ${num(g.points_for)} – ${num(g.points_against)} ${esc(g.opponent_team)}</small></div>`;
      $('rivalry-moments-body').innerHTML=moment('Most recent',last,last.result==='T'?'Tie':`${names.get(last.result==='W'?first:second)} won`)+moment('Closest',closest,`Margin ${num(Math.abs(closest.margin))}`)+moment('Biggest margin',biggest,`Margin ${num(Math.abs(biggest.margin))}`);
      const byYear=new Map();for(const g of rows){if(!byYear.has(g.year))byYear.set(g.year,[]);byYear.get(g.year).push(g);}
      $('years-body').innerHTML=[...byYear.entries()].sort((a,b)=>b[0]-a[0]).map(([year,yearGames])=>{const s=score(yearGames),g=yearGames[0];return `<tr><td class="owner-year">${year}${year===current[0].year?'<small>In progress</small>':''}</td><td class="owner-cell"><strong>${esc(teamName(first,year,g.team))}</strong><span class="team-name">vs ${esc(teamName(second,year,g.opponent_team))}</span></td><td class="numeric">${s.games}</td><td class="numeric standing-record">${record(s)}</td><td class="numeric">${num(s.pf)}</td><td class="numeric">${num(s.pa)}</td></tr>`;}).join('');
      set('matchup-count',`${rows.length} games`);
      $('rivalry-games-body').innerHTML=rows.map(gameCard).join('');
    }
    aSelect.addEventListener('change',event=>{if(event.target.value===second||event.target.value&&!names.has(event.target.value))return;first=event.target.value;render();});
    bSelect.addEventListener('change',event=>{if(event.target.value===first||event.target.value&&!names.has(event.target.value))return;second=event.target.value;render();});
    $('swap-owners').addEventListener('click',()=>{if(!first||!second)return;[first,second]=[second,first];render();});
    render();$('rivalry-page').hidden=false;$('load-status').hidden=true;
  }catch(_){$('rivalry-page').hidden=true;$('load-status').hidden=false;set('load-status','Matchup history could not be loaded. Keep the extracted site together and verify the exporter output.');}
})();
