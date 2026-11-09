/* Seeded, bounded conditional score simulations; works offline and in Node tests. */
(function(root){
 'use strict';
 function random(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
 function normal(rng){return Math.sqrt(-2*Math.log(Math.max(1e-12,rng())))*Math.cos(2*Math.PI*rng());}
 function setup(p){const ids=p.standings_signature.map(s=>s[0]);const games=p.remaining_schedule.flatMap(w=>w.games.map(g=>({week:w.week,a:ids.indexOf(g[0]),b:ids.indexOf(g[1]),key:w.week+':'+g.join(':')})));return {ids,games};}
 async function simulate(p,picks={},trials=20000,cancelled=()=>false){
  if(!Number.isInteger(trials)||trials<100||trials>50000)throw Error('Invalid simulation count');
  const {ids,games}=setup(p),n=ids.length,m=games.length,rng=random(p.random_seed),sd=p.model.pooled_weekly_sd,means=p.model.means;
  if(Object.entries(picks).some(([key,id])=>!games.some(g=>g.key===key&&[ids[g.a],ids[g.b]].includes(id))))throw Error('Invalid game selection');
  const ranks=new Uint8Array(trials*n),wins=new Uint8Array(trials*n),outcomes=new Uint8Array(trials*m);
  for(let t=0;t<trials;t++){
   if(t%250===0){if(cancelled())throw Error('Cancelled');await new Promise(resolve=>setTimeout(resolve,0));}
   const u=p.standings_signature.map(s=>2*s[1]+s[3]),pf=p.standings_signature.map(s=>s[4]),w=p.standings_signature.map(s=>s[1]);
   for(let j=0;j<m;j++){
    const g=games[j],pick=picks[g.key];let sa,sb,accepted=false;
    // Rejection samples the actual score model conditional on the selected winner.
    for(let attempt=0;attempt<10000;attempt++){
     sa=Math.max(0,means[g.a]+sd*normal(rng));sb=Math.max(0,means[g.b]+sd*normal(rng));
     if(sa===sb)continue;
     if(!pick||(sa>sb?ids[g.a]:ids[g.b])===pick){accepted=true;break;}
    }
    if(!accepted)throw Error('This outcome was too rare to simulate reliably. Remove that pick.');
    const winner=sa>sb?g.a:g.b;u[winner]+=2;w[winner]++;pf[g.a]+=sa;pf[g.b]+=sb;outcomes[t*m+j]=winner;
   }
   const order=ids.map((_,i)=>i).sort((a,b)=>u[b]-u[a]||pf[b]-pf[a]);
   order.forEach((i,k)=>{ranks[t*n+i]=k+1;wins[t*n+i]=w[i];});
  }
  return {ids,games,trials,ranks,wins,outcomes,picks:{...picks}};
 }
 function summary(bank,target){
  const i=bank.ids.indexOf(target);if(i<0)throw Error('Unknown team');const n=bank.ids.length,m=bank.games.length;
  let made=0,winSum=0,seedSum=0;const seeds=Array(n).fill(0),byWins=new Map(),roots=bank.games.map(()=>({aN:0,aMade:0,bN:0,bMade:0}));
  for(let t=0;t<bank.trials;t++){
   const rank=bank.ranks[t*n+i],qualified=rank<=8,w=bank.wins[t*n+i];made+=qualified;winSum+=w;seedSum+=rank;seeds[rank-1]++;
   const bin=byWins.get(w)||{wins:w,n:0,made:0};bin.n++;bin.made+=qualified;byWins.set(w,bin);
   for(let j=0;j<m;j++){const r=roots[j],a=bank.outcomes[t*m+j]===bank.games[j].a;if(a){r.aN++;r.aMade+=qualified;}else{r.bN++;r.bMade+=qualified;}}
  }
  const matchups=roots.map((r,j)=>{
   const g=bank.games[j],pa=r.aMade/r.aN,pb=r.bMade/r.bN,delta=pa-pb;
   const error=1.96*Math.sqrt(pa*(1-pa)/r.aN+pb*(1-pb)/r.bN);
   return {...g,...r,pa,pb,delta,error,confident:r.aN>=300&&r.bN>=300&&Number.isFinite(error)&&Math.abs(delta)>error};
  });
  const rooting=matchups.filter(g=>g.a!==i&&g.b!==i&&!bank.picks[g.key]).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  return {probability:made/bank.trials,avgWins:winSum/bank.trials,avgSeed:seedSum/bank.trials,seeds:seeds.map(x=>x/bank.trials),matchups,byWins:[...byWins.values()].sort((a,b)=>a.wins-b.wins),rooting};
 }
 function proof(p,picks,target){
  const {ids,games}=setup(p),i=ids.indexOf(target),lower=p.standings_signature.map(s=>2*s[1]+s[3]),left=ids.map(()=>0);
  for(const g of games){const pick=picks[g.key];if(pick)lower[ids.indexOf(pick)]+=2;else{left[g.a]++;left[g.b]++;}}
  const upper=lower.map((v,k)=>v+2*left[k]),best=1+lower.filter((v,k)=>k!==i&&v>upper[i]).length,worst=1+upper.filter((v,k)=>k!==i&&v>=lower[i]).length;
  return {best,worst,status:worst<=8?'Clinched under these picks':best>8?'Eliminated under these picks':'Not established by the scenario proof'};
 }
 const api={simulate,summary,proof,setup};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SpartyScenarios=api;
})(typeof window==='undefined'?globalThis:window);
