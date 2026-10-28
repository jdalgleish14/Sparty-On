/* Team detail uses the same successful snapshot as the totals table. */
(() => {
 'use strict';
 const section=document.getElementById('transactions-section');if(!section)return;
 const panel=document.createElement('section');panel.className='tx-history';panel.setAttribute('aria-labelledby','tx-history-title');
 panel.innerHTML='<div class="tx-history-heading"><div><p class="eyebrow">THE MOVES BEHIND THE NUMBERS</p><h3 id="tx-history-title">Team transaction history</h3></div></div><div class="tx-history-controls"><label>Team<select id="tx-history-team"></select></label><label>Show<select id="tx-history-filter"><option value="all">All moves</option><option value="trade">Trades</option><option value="free_agent">Free agents</option><option value="waiver">Waivers</option></select></label></div><p id="tx-history-count" class="tx-history-count" role="status"></p><div id="tx-history-list"></div><button id="tx-history-more" class="tx-history-more" type="button" hidden>Show more</button>';
 section.append(panel);
 const team=document.getElementById('tx-history-team'),filter=document.getElementById('tx-history-filter'),list=document.getElementById('tx-history-list'),more=document.getElementById('tx-history-more');
 const labels={trade:'Trade',free_agent:'Free agent pickup',waiver:'Waiver claim'};
 let snapshot,limit=15;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 function assets(title,rows){const group=el('div','tx-assets');group.append(el('h4','',title));const ul=el('ul');if(!rows.length)ul.append(el('li','tx-muted','None'));for(const item of rows){const li=el('li','',item.label);if(item.position)li.append(el('small','tx-position',item.position));ul.append(li);}group.append(ul);return group;}
 function render(){
  if(!snapshot)return;
  const row=snapshot.teams.find(t=>String(t.roster_id)===team.value);if(!row)return;
  const history=row.history;
  list.replaceChildren();
  if(!Array.isArray(history)){document.getElementById('tx-history-count').textContent='Detailed history will appear after the next successful sync with the updated script.';more.hidden=true;return;}
  const matches=history.filter(t=>filter.value==='all'||t.type===filter.value);
  document.getElementById('tx-history-count').textContent=`${matches.length} ${matches.length===1?'move':'moves'} · Newest first`;
  if(!matches.length)list.append(el('p','tx-empty','No completed moves in this category.'));
  matches.slice(0,limit).forEach(tx=>{
   const card=el('article','tx-move');const header=el('div','tx-move-top');header.append(el('span','tx-type',labels[tx.type]||'Move'));
   const date=tx.timestamp_ms?new Date(tx.timestamp_ms):null;header.append(el('time','',date&&!isNaN(date)?date.toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Date unavailable'));card.append(header);
   if(tx.type==='trade'&&tx.partners?.length)card.append(el('p','tx-partner','With '+tx.partners.join(' · ')));
   if(tx.type==='waiver'&&typeof tx.waiver_bid==='number')card.append(el('p','tx-partner',`Winning bid: $${tx.waiver_bid}`));
   const columns=el('div','tx-asset-columns');columns.append(assets(tx.type==='trade'?'Received':'Added',tx.received||[]),assets(tx.type==='trade'?'Sent':'Dropped',tx.sent||[]));card.append(columns);list.append(card);
  });more.hidden=matches.length<=limit;
 }
 function choose(value,focus){team.value=String(value);limit=15;render();if(focus){panel.scrollIntoView({behavior:'smooth',block:'start'});team.focus({preventScroll:true});}}
 function update(next){snapshot=next;const selected=team.value;team.replaceChildren(...[...snapshot.teams].sort((a,b)=>a.team.localeCompare(b.team)).map(row=>{const option=el('option','',row.team);option.value=String(row.roster_id);return option;}));if(snapshot.teams.some(t=>String(t.roster_id)===selected))team.value=selected;render();}
 team.addEventListener('change',()=>{limit=15;render();});filter.addEventListener('change',()=>{limit=15;render();});more.addEventListener('click',()=>{limit+=15;render();});
 document.getElementById('transactions-body').addEventListener('click',event=>{const button=event.target.closest('[data-tx-team]');if(button)choose(button.dataset.txTeam,true);});
 window.addEventListener('sparty-sleeper-totals',event=>update(event.detail));if(window.SPARTY_SLEEPER_SNAPSHOT)update(window.SPARTY_SLEEPER_SNAPSHOT);
})();
