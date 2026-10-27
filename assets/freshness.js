/* Coverage and publication time describe the loaded snapshot, never a page visit. */
(() => {
  'use strict';
  const data = window.SPARTY_ON_DATA;
  if (!data || data.validation_report?.status !== 'PASS') return;
  const season = data.seasons.find(s => s.status === 'Current');
  const week = data.league.current_season_through_week;
  const published = Date.parse(data.league.generated_at_utc);
  const main = document.querySelector('main');
  if (!main || !season) return;
  const box = document.createElement('aside');
  box.className = 'snapshot-status';
  box.setAttribute('aria-label', 'League data coverage');
  const coverage = document.createElement('strong');
  coverage.textContent = `${season.year} scores through Week ${week}`;
  const detail = document.createElement('span');
  detail.textContent = Number.isFinite(published)
    ? 'Published ' + new Date(published).toLocaleString('en-US', {timeZone:'America/New_York', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'})
    : 'Publication time unavailable';
  const note = document.createElement('span');
  note.textContent = 'Completed scores update Tuesday mornings. Transactions and Max PF sync separately each day.';
  box.append(coverage, detail, note);
  const now = new Date();
  if (Number.isFinite(published) && Date.now()-published > 8*24*60*60*1000 && now.getUTCFullYear() === season.year && now.getUTCMonth() >= 8 && now.getUTCMonth() <= 11 && week < season.regular_season_weeks) {
    const warning = document.createElement('span');
    warning.className = 'snapshot-warning';
    warning.textContent = 'The score snapshot is over eight days old. A newer completed week may be awaiting publication.';
    box.append(warning);
  }
  // Place inside the loaded page so a failed snapshot never looks successful.
  const intro = main.querySelector('.intro, .landing-hero');
  if (intro) intro.insertAdjacentElement('afterend', box);
  else main.append(box);
})();
