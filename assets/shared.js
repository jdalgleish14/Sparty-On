/* Local navigation placeholders shared by the offline pages. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const descriptions = {
    'Seasons':'Explore each season’s standings, results and championship story.',
    'Owners':'Follow every owner across changing team names, seasons and eras.',
    'Records':'Browse the league’s high scores, winning margins and historical leaderboards.',
    'Head-to-Head':'Compare two owners across their shared matchup history.'
  };
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => {
    $('dialog-title').textContent = button.dataset.section;
    $('dialog-description').textContent = descriptions[button.dataset.section];
    $('section-dialog').showModal();
  }));
  $('close-dialog').addEventListener('click', () => $('section-dialog').close());
})();
