/* The suggestion button opens a local, dismissible joke dialog. */
(() => {
  'use strict';
  const dialog=document.getElementById('suggestion-dialog');
  document.querySelector('.suggestion-trigger')?.addEventListener('click',()=>dialog.showModal());
})();
