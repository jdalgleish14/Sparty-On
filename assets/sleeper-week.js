/* Live Sleeper display: deliberately separate from the verified standings. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=value=>Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const service=window.SPARTY_SLEEPER,data=window.SPARTY_ON_DATA;
  if(!service||!data||data.validation_report?.status!=='PASS')return;
  const season=data.seasons.find(s=>s.status==='Current'),verified=data.league.current_season_through_week;
  if(!season||season.year!==service.sample.season||verified>=season.regular_season_weeks)return;
  const section=$('sleeper-week'),status=$('sleeper-status'),games=$('sleeper-games'),detail=$('sleeper-detail'),select=$('sleeper-team');
  const byOwner=new Map(data.current_standings.map(s=>[s.owner_id,s]));
  if(byOwner.size!==season.team_count||Object.keys(service.sample.owner_roster).some(id=>!byOwner.has(id)))return;
  const positions=['QB','RB','RB','WR','WR','TE','FLEX','SUPER FLEX'];
  let state=null,choice='',refreshing=false;
  function owner(row){return service.ownerFor(row.roster_id);}
  function name(row){return byOwner.get(owner(row))?.team||'Team unavailable';}
  function score(row){return Number(row.custom_points??row.points);}
  function allZero(){return state.pairs.every(pair=>pair.every(row=>score(row)===0));}
  function label(){return state.source==='sample'?'Saved preview':state.complete?'Sleeper final · awaiting verified export':allZero()?'Not started':'Sleeper score · in progress';}
  function playerLine(id,slot,points){
    const p=service.player(id),empty=String(id)==='0';
    return `<li><span class="sleeper-slot">${esc(slot)}</span><span><strong>${empty?'Empty slot':esc(p.name)}</strong><small>${empty?'No player selected':esc([p.position,p.team].filter(Boolean).join(' · '))}</small></span>${points===null?'':`<b>${num(points)}</b>`}</li>`;
  }
  function roster(row){
    const team=name(row),current=state.rosters.find(r=>r.roster_id===row.roster_id),starters=new Set(row.starters.map(String));
    const reserve=new Set((current?.reserve||[]).map(String)),taxi=new Set((current?.taxi||[]).map(String));
    const bench=(current?.players||row.players||[]).filter(id=>!starters.has(String(id))&&!reserve.has(String(id))&&!taxi.has(String(id)));
    const list=(ids,title)=>ids?.length?`<details class="sleeper-roster-group"><summary>${title} <span>${ids.length}</span></summary><ul>${ids.map(id=>playerLine(id,service.player(id).position||'—',null)).join('')}</ul></details>`:'';
    const hasPoints=!allZero()||state.complete;
    return `<article class="sleeper-roster"><h4>${esc(team)} <span>${num(score(row))}</span></h4><p>Starting lineup${hasPoints?' · Sleeper points':''}</p><ul>${row.starters.map((id,i)=>playerLine(id,positions[i]||'FLEX',hasPoints?Number(row.starters_points[i]):null)).join('')}</ul>${list(bench,'Bench')}${list(current?.reserve,'Reserve')}${list(current?.taxi,'Taxi')}</article>`;
  }
  function renderDetail(){
    const chosen=state.pairs.find(pair=>pair.some(row=>owner(row)===choice));
    if(!chosen){detail.hidden=true;select.parentElement.after(detail);return;}
    detail.hidden=false;
    const selected=select.value===choice?chosen.find(row=>owner(row)===choice):null;
    if(window.matchMedia('(max-width:700px)').matches&&!selected){
      const button=[...games.querySelectorAll('button[data-owner]')].find(item=>item.dataset.owner===owner(chosen[0]));
      if(button)button.after(detail);
    }else select.parentElement.after(detail);
    detail.innerHTML=`<div class="sleeper-detail-heading"><h3>${selected?esc(name(selected)):`${esc(name(chosen[0]))} vs ${esc(name(chosen[1]))}`}</h3><button type="button" id="sleeper-close">Close</button></div><div class="sleeper-rosters">${(selected?[selected]:chosen).map(roster).join('')}</div>`;
    $('sleeper-close').addEventListener('click',()=>{choice='';select.value='';renderDetail();renderGames();});
  }
  function renderGames(){
    games.innerHTML=state.pairs.map(pair=>{
      const expanded=pair.some(row=>owner(row)===choice)&&select.value!==choice;
      return `<button class="sleeper-game" type="button" data-owner="${esc(owner(pair[0]))}" aria-expanded="${expanded}" aria-controls="sleeper-detail" aria-label="${esc(name(pair[0]))} versus ${esc(name(pair[1]))}, ${expanded?'close':'view'} lineups"><span class="sleeper-game-top">Week ${state.week} · ${label()}</span><span class="sleeper-game-side"><strong>${esc(name(pair[0]))}</strong><b>${state.source==='sample'&&allZero()?'—':num(score(pair[0]))}</b></span><span class="sleeper-game-side"><strong>${esc(name(pair[1]))}</strong><b>${state.source==='sample'&&allZero()?'—':num(score(pair[1]))}</b></span><span class="sleeper-game-action">${expanded?'Close lineups':'View lineups'}</span></button>`;
    }).join('');
  }
  function render(result){
    if(result?.unavailable||!result?.pairs){section.hidden=false;games.innerHTML='';select.parentElement.hidden=true;detail.hidden=true;status.textContent='Sleeper is unavailable. Verified standings remain below.';return;}
    state=result;section.hidden=false;select.parentElement.hidden=false;
    $('sleeper-title').textContent=`Week ${state.week} on Sleeper`;
    status.textContent=state.source==='sample'?`Saved preview · Oct 7 · Not live`:`${label()} · Checked ${state.updated.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
    const sorted=[...byOwner.values()].sort((a,b)=>a.team.localeCompare(b.team));
    const selectedFromMenu=select.value===choice;
    select.innerHTML='<option value="">Select a team</option>'+sorted.map(s=>`<option value="${esc(s.owner_id)}">${esc(s.team)}</option>`).join('');
    select.value=selectedFromMenu&&sorted.some(s=>s.owner_id===choice)?choice:'';
    renderGames();renderDetail();
  }
  games.addEventListener('click',event=>{
    const button=event.target.closest('button[data-owner]');if(!button||!state)return;
    const next=button.dataset.owner;choice=next===choice&&select.value!==choice?'':next;select.value='';renderGames();renderDetail();
    if(!detail.hidden&&window.matchMedia('(max-width:700px)').matches)detail.scrollIntoView({block:'nearest'});
  });
  select.addEventListener('change',()=>{choice=select.value;renderGames();renderDetail();});
  async function refresh(){
    if(refreshing||document.hidden)return;
    refreshing=true;
    try{render(await service.liveWeek(season.year,verified,season.team_count,season.regular_season_weeks));}
    catch(_){status.textContent='Sleeper is unavailable. Verified standings remain below.';}
    finally{refreshing=false;}
  }
  section.hidden=false;refresh();
  setInterval(refresh,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
