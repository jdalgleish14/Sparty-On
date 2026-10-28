(() => {
 'use strict';
 const tabs=[...document.querySelectorAll('[data-season-tab]')];
 const select=document.getElementById('analytics-view');
 const keys=tabs.map(b=>b.dataset.seasonTab);
 function show(key,update){
  if(!keys.includes(key))key='standings';
  tabs.forEach(b=>{const active=b.dataset.seasonTab===key;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;document.getElementById('view-'+b.dataset.seasonTab).hidden=!active;});
  const analytics=select.value;
  document.querySelectorAll('[data-analytics-view]').forEach(p=>p.hidden=p.dataset.analyticsView!==analytics);
  if(update){try{history.replaceState(null,'','#'+key+(key==='analytics'?'/'+analytics:''));}catch(_){/* Navigation works with restricted local history. */}}
 }
 function fromHash(){const [key,view]=location.hash.slice(1).split('/');if([...select.options].some(o=>o.value===view))select.value=view;show(key,false);}
 tabs.forEach((button,index)=>{
  button.addEventListener('click',()=>show(button.dataset.seasonTab,true));
  button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();tabs[next].focus();show(tabs[next].dataset.seasonTab,true);});
 });
 select.addEventListener('change',()=>show('analytics',true));window.addEventListener('hashchange',fromHash);fromHash();
})();
