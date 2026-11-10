/* Official completed playoff results from the same verified site snapshot. */
(() => {
 'use strict';
 const d=window.SPARTY_ON_DATA, $=id=>document.getElementById(id);
 const season=d?.seasons?.find(s=>s.status==='Current');
 if(d?.validation_report?.status!=='PASS'||!season?.postseason_through_round||!$('projected-bracket'))return;
 const matches=season.playoff_bracket;
 if(!Array.isArray(matches)||matches.length!==7)return;
 const names=new Map(d.owners.map(o=>[o.owner_id,o.owner_name]));
 const seeds=new Map(d.current_standings.map(s=>[s.owner_id,s.rank]));
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const bracket=$('projected-bracket');bracket.replaceChildren();
 $('bracket-title').textContent=season.phase==='Complete'?'Final playoff bracket':'Playoff bracket';
 const champion=d.championships.find(c=>c.year===season.year);
 $('bracket-status').textContent=champion ? `${champion.champion_owner_name} wins the ${season.year} championship.` : `Official results through Week ${14+season.postseason_through_round}.`;
 for(const [round,label,week] of [['Quarterfinal','Quarterfinals',15],['Semifinal','Semifinals',16],['Championship','Championship',17]]){
  const section=el('section');section.className='bracket-round';section.append(el('h3',label),el('p','Week '+week));
  const games=el('div');games.className='bracket-games';section.append(games);bracket.append(section);
  for(const m of matches.filter(x=>x.round===round)){
   const game=el('article');game.className='bracket-match';game.append(el('h4','Game '+m.match_id+' · '+(m.winner_owner_id?'Final':'Upcoming')));
   for(const side of [1,2]){
    const id=m[`team${side}_owner_id`],team=el('div');team.className='bracket-team';
    if(id){const seed=el('span',String(seeds.get(id)));seed.className='bracket-seed';team.append(seed);}
    const source=matches.find(x=>x.match_id===m['from'+side]);
    team.append(el('span',id?names.get(id):source?`Winner of Game ${source.match_id}`:'To be determined'));
    const score=m[`team${side}_score`];
    if(score!==null){const value=el('strong',score.toFixed(2));value.className='bracket-score';team.append(value);}
    if(id&&id===m.winner_owner_id){team.className+=' bracket-winner';team.append(el('span','✓'));}
    game.append(team);
   }
   games.append(game);
  }
 }
 bracket.hidden=false;
})();
