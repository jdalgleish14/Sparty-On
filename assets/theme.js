/* Theme is local to this browser; direct button clicks work at every width. */
(() => {
  'use strict';
  const key='sparty-on-theme';
  const buttons=[...document.querySelectorAll('[data-theme-choice]')];
  if(buttons.length!==3)return;
  let choice='system';
  try{const value=localStorage.getItem(key);if(['system','light','dark'].includes(value))choice=value;}catch(_){/* Storage is optional. */}
  let preference=null;
  try{preference=window.matchMedia('(prefers-color-scheme: dark)');}catch(_){/* Older browsers use light. */}
  function apply(){
    const resolved=choice==='system'?(preference?.matches?'dark':'light'):choice;
    document.documentElement.setAttribute('data-theme',resolved);
    buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===choice)));
  }
  buttons.forEach(button=>button.addEventListener('click',()=>{
    choice=button.dataset.themeChoice;
    try{localStorage.setItem(key,choice);}catch(_){/* Keep it active for this page. */}
    apply();
  }));
  if(preference){
    const onChange=()=>{if(choice==='system')apply();};
    if(preference.addEventListener)preference.addEventListener('change',onChange);
    else if(preference.addListener)preference.addListener(onChange);
  }
  apply();
})();
