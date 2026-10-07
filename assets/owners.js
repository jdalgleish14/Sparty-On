/* Read-only owner histories from the validated offline export. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = value => Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + num(Math.abs(value));
  const integer = value => Number(value).toLocaleString('en-US');
  const record = ({wins,losses,ties}) => `${wins}–${losses}${ties ? `–${ties}` : ''}`;
  const set = (id,value) => { $(id).textContent=value; };
  try {
    const d=window.SPARTY_ON_DATA;
    if (!d || d.validation_report?.status !== 'PASS' || !Array.isArray(d.validation_report.checks) || d.validation_report.checks.some(c => c.status !== 'PASS') || d.games.length !== d.validation_report.counts.game_rows) throw Error('Invalid snapshot');
    const current=d.seasons.filter(s => s.status === 'Current');
    if (current.length !== 1 || !Number.isInteger(d.league.current_season_through_week) || d.league.current_season_through_week !== d.validation_report.publication_cutoff.current_season_through_week || d.league.current_season_through_week > current[0].regular_season_weeks) throw Error('Current season cutoff');
    const cutoff=d.league.current_season_through_week;
    const names=new Map(d.owners.map(o => [o.owner_id,o.owner_name]));
    const careers=[...d.owner_careers].sort((a,b) => b.wins-a.wins || b.win_percentage-a.win_percentage || a.owner_name.localeCompare(b.owner_name));
    const summaries=new Map(careers.map(c => [c.owner_id,d.season_summaries.filter(s => s.owner_id === c.owner_id).sort((a,b) => b.year-a.year)]));
    const games=new Map(careers.map(c => [c.owner_id,d.games.filter(g => g.owner_id === c.owner_id)]));
    const championships=new Map(careers.map(c => [c.owner_id,{won:d.championships.filter(ch => ch.champion_owner_id === c.owner_id),runner:d.championships.filter(ch => ch.runner_up_owner_id === c.owner_id)}]));
    if (careers.length !== names.size || careers.length !== d.validation_report.counts.owners || new Set(careers.map(c => c.owner_id)).size !== names.size || d.season_summaries.length !== d.validation_report.counts.active_season_summaries) throw Error('Owner count');
    for(const c of careers){
      const rows=games.get(c.owner_id),yearRows=summaries.get(c.owner_id);
      const wins=rows.filter(g => g.result === 'W').length,losses=rows.filter(g => g.result === 'L').length,ties=rows.length-wins-losses;
      const pf=rows.reduce((sum,g)=>sum+g.points_for,0),pa=rows.reduce((sum,g)=>sum+g.points_against,0);
      if (!rows.length || !yearRows.length || !names.has(c.owner_id) || names.get(c.owner_id)!==c.owner_name || rows.length!==c.games_played || wins!==c.wins || losses!==c.losses || ties!==c.ties || yearRows.length!==c.seasons || Math.abs(pf-c.points_for)>0.011 || Math.abs(pa-c.points_against)>0.011 || yearRows.some(s=>!d.seasons.some(y=>y.year===s.year && y.status===s.season_status)) || yearRows.reduce((sum,s)=>sum+s.games_played,0)!==rows.filter(g=>g.stage==='Regular Season').length) throw Error('Owner totals disagree');
    }
    if (d.games.some(g => g.year===current[0].year && (g.stage!=='Regular Season' || g.week>cutoff))) throw Error('Unapproved games');
    const currentLabel=`${current[0].year} · Through Week ${cutoff}`;
    set('owner-count',`${careers.length} owners · ${d.championships.length} completed seasons`);
    set('owners-footer',`${currentLabel} · Read-only snapshot`);
    $('owner-select').innerHTML='<option value="">Select an owner</option>'+[...careers].sort((a,b)=>a.owner_name.localeCompare(b.owner_name)).map(c=>`<option value="${esc(c.owner_id)}">${esc(c.owner_name)}</option>`).join('');
    function outcome(ownerId,year,status){
      if(status==='Current')return 'In progress';
      const finals=championships.get(ownerId);
      if(finals.won.some(ch=>ch.year===year))return 'Champion';
      if(finals.runner.some(ch=>ch.year===year))return 'Runner-up';
      const played=games.get(ownerId).filter(g=>g.year===year&&g.stage==='Postseason');
      if(!played.length)return 'Did not qualify';
      const last=played.find(g=>g.round==='Semifinal'&&g.result==='L') || played.find(g=>g.round==='Quarterfinal'&&g.result==='L');
      if(!last)throw Error('Postseason outcome incomplete');
      return last.round === 'Semifinal' ? 'Semifinals' : 'Quarterfinals';
    }
    function stageStats(rows){
      const wins=rows.filter(g=>g.result==='W').length,losses=rows.filter(g=>g.result==='L').length,ties=rows.length-wins-losses;
      const pf=rows.reduce((sum,g)=>sum+g.points_for,0),pa=rows.reduce((sum,g)=>sum+g.points_against,0);
      return {games_played:rows.length,wins,losses,ties,win_percentage:rows.length?wins/rows.length:0,average_points_for:rows.length?pf/rows.length:0,average_margin:rows.length?(pf-pa)/rows.length:0};
    }
    let selected=null;
    function renderDirectory(){
      $('directory-body').innerHTML=careers.map((c,i)=>{
        const latest=summaries.get(c.owner_id)[0],titleCount=championships.get(c.owner_id).won.length;
        return `<tr class="${selected===c.owner_id?'selected-owner':''}" data-owner="${esc(c.owner_id)}"><td class="rank-number">${i+1}</td><td class="owner-cell"><button type="button" class="owner-choice" data-owner="${esc(c.owner_id)}" aria-pressed="${selected===c.owner_id}">${esc(c.owner_name)}</button><span class="team-name">${esc(latest.team)} · ${latest.year}</span></td><td class="numeric">${c.seasons}</td><td class="numeric standing-record">${record(c)}</td><td class="numeric">${(c.win_percentage*100).toFixed(1)}%</td><td class="numeric">${titleCount}</td></tr>`;
      }).join('');
    }
    function renderOwner(id){
      const c=careers.find(row=>row.owner_id===id);
      if (!c) throw Error('Unknown owner');
      selected=id;
      $('owner-prompt').hidden=true;$('owner-profile-content').hidden=false;
      const yearRows=summaries.get(id),played=games.get(id),finals=championships.get(id),latest=yearRows[0];
      $('owner-select').value=id;
      set('owner-name',c.owner_name);
      set('owner-latest-team',`${latest.team} · ${latest.year}${latest.season_status==='Current'?' season in progress':''}`);
      set('owner-scope',`${yearRows[yearRows.length-1].year}–${latest.year} · ${c.seasons} seasons · Career stats include regular season and postseason${latest.season_status==='Current'?` · ${currentLabel}`:''}`);
      const post=played.filter(g=>g.stage==='Postseason'),regular=played.filter(g=>g.stage==='Regular Season');
      const metrics=[['Career record',record(c),`${integer(c.games_played)} games · all stages`],['Win percentage',`${(c.win_percentage*100).toFixed(1)}%`,'All published games'],['Championships',String(finals.won.length),'Completed seasons'],['Finals appearances',String(finals.won.length+finals.runner.length),'Completed seasons'],['Average score',num(c.average_points_for),'Points per game · all stages'],['Career points',num(c.points_for),'Regular season + postseason']];
      $('owner-metrics').innerHTML=metrics.map(([name,value,detail])=>`<div class="season-metric"><span>${name}</span><strong>${value}</strong><small>${detail}</small></div>`).join('');
      const stageRows=[['Regular season',stageStats(regular)],['Postseason',stageStats(post)],['All games',stageStats(played)]];
      $('owner-stage-body').innerHTML=stageRows.map(([name,stats])=>`<tr><td>${name}</td><td class="numeric">${stats.games_played}</td><td class="numeric">${record(stats)}</td><td class="numeric">${stats.games_played?(stats.win_percentage*100).toFixed(1)+'%':'—'}</td><td class="numeric">${stats.games_played?num(stats.average_points_for):'—'}</td><td class="numeric ${stats.average_margin>=0?'positive':'negative'}">${stats.games_played?signed(stats.average_margin):'—'}</td></tr>`).join('');
      $('owner-honors-body').innerHTML=`<div class="honors-list"><div class="honors-row"><span>Postseason record</span><strong>${post.length?record(stageStats(post)):'No games yet'}</strong></div><div class="honors-row"><span>Championships</span><strong>${finals.won.length}</strong></div><div class="honors-row"><span>Runner-up finishes</span><strong>${finals.runner.length}</strong></div><div class="honors-row"><span>Playoff appearances</span><strong>${new Set(post.map(g=>g.year)).size}</strong></div></div><p class="honors-years">${finals.won.length ? `Titles: ${finals.won.map(ch=>ch.year).join(', ')}` : 'No championship seasons recorded'}${finals.runner.length ? ` · Runner-up: ${finals.runner.map(ch=>ch.year).join(', ')}` : ''}</p>`;
      $('owner-seasons-body').innerHTML=yearRows.map(s=>`<tr class="${s.season_status==='Current'?'owner-current':''}"><td class="owner-year">${s.year}${s.season_status==='Current'?'<small>In progress</small>':''}</td><td>${esc(s.team)}</td><td class="numeric standing-record">${record(s)}</td><td class="numeric">${num(s.points_for)}</td><td class="numeric">${num(s.points_against)}</td><td class="numeric">${num(s.average_points_for)}</td><td class="numeric ${s.average_margin>=0?'positive':'negative'}">${signed(s.average_margin)}</td><td>${outcome(id,s.year,s.season_status)}</td></tr>`).join('');
      const best=yearRows.filter(s=>s.season_status==='Complete').sort((a,b)=>b.points_for/b.games_played-a.points_for/a.games_played);
      const high=Math.max(...played.map(g=>g.points_for)),highGames=played.filter(g=>g.points_for===high);
      const hCard=(title,value,detail)=>`<article class="leader-card"><h3>${title}</h3><div class="leader-number">${num(value)}</div><p class="leader-detail">${esc(detail)}</p></article>`;
      $('owner-highlights').innerHTML=hCard('Highest single-game score',high,highGames.map(g=>`${g.team} · ${g.year} ${g.stage==='Postseason'?g.round:`Week ${g.week}`}`).join(' / '))+(best.length?hCard('Best completed-season average',best[0].points_for/best[0].games_played,`${best[0].team} · ${best[0].year} · regular season`):'<article class="leader-card"><h3>Best completed-season average</h3><p>Available after a full season.</p></article>');
      renderDirectory();
    }
    $('owner-select').addEventListener('change',event=>renderOwner(event.target.value));
    $('directory-body').addEventListener('click',event=>{
      const button=event.target.closest('button[data-owner]');
      if(!button)return;
      renderOwner(button.dataset.owner);
      $('owner-name').focus();
    });
    renderDirectory();
    $('owners-page').hidden=false;$('load-status').hidden=true;
  } catch (_) {
    $('owners-page').hidden=true;$('load-status').hidden=false;
    set('load-status','Owner histories could not be loaded. Keep the extracted folder together, then run the exporter and verifier successfully.');
  }
})();
