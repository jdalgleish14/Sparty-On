/* A browser-local preference; exported league data stays untouched. */
(() => {
  'use strict';
  const key='sparty-on-theme';
  const select=document.querySelector('[data-theme-select]');
  if(!select)return;
  let saved='system';
  try {const value=localStorage.getItem(key);if(['light','dark','system'].includes(value))saved=value;}catch(_){/* Browsers can block storage. */}
  const system=window.matchMedia('(prefers-color-scheme: dark)');
  function apply(){document.documentElement.dataset.theme=saved==='system'?(system.matches?'dark':'light'):saved;select.value=saved;}
  select.addEventListener('change',()=>{
    saved=select.value;
    try{localStorage.setItem(key,saved);}catch(_){/* Keep the setting for this page. */}
    apply();
  });
  system.addEventListener?.('change',()=>{if(saved==='system')apply();});
  apply();
})();
