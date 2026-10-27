/* Small table footers; publication time is never replaced by page-load time. */
(() => {
  'use strict';
  const data = window.SPARTY_ON_DATA;
  if (!data || data.validation_report?.status !== 'PASS') return;
  const zone = 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
  const format = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', {timeZone:zone, month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'}) : 'unavailable';
  const fields = date => Object.fromEntries(parts.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  function nextSync(now, daily) {
    const local = fields(now), candidates = [];
    for (let day=0; day<=8; day++) {
      const calendar = new Date(Date.UTC(local.year,local.month-1,local.day+day));
      const dow = calendar.getUTCDay();
      const times = daily ? [[9,0]] : dow === 2 ? [[6,0],[11,13],[12,43]] : dow === 3 ? [[8,13]] : [];
      for (const [hour,minute] of times) {
        const target = Date.UTC(calendar.getUTCFullYear(),calendar.getUTCMonth(),calendar.getUTCDate(),hour,minute);
        let utc = target;
        // Resolve Eastern wall time using its date-specific DST offset.
        for (let attempt=0;attempt<2;attempt++) {
          const p = fields(new Date(utc));
          utc += target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);
        }
        if (utc>now.getTime()) candidates.push(utc);
      }
    }
    return new Date(Math.min(...candidates)).toISOString();
  }
  let dailySnapshot = window.SPARTY_SLEEPER_SNAPSHOT;
  const footers = [];
  for (const table of document.querySelectorAll('main table')) {
    const daily = table.id === 'transactions-table';
    const footer = document.createElement('p');
    footer.className = 'table-sync';
    const wrapper = table.closest('.table-scroll, .analytics-scroll, .race-table-wrap');
    (wrapper || table).insertAdjacentElement('afterend', footer);
    footers.push({footer,daily});
  }
  // Explicit opt-in: only single-team standings columns stay pinned.
  for (const id of ['standings-body','bonus-body','luck-body','historic-standings','year-bonus-body','year-luck-body']) {
    const table = document.getElementById(id)?.closest('table');
    if (table) table.classList.add('compact-team-pin');
  }
  function render() {
    const now = new Date(), weeklyNext = nextSync(now,false), dailyNext = nextSync(now,true);
    for (const {footer,daily} of footers) {
      const last = daily ? dailySnapshot?.checked_at_utc || dailySnapshot?.fetched_at_utc : data.league.generated_at_utc;
      const label = daily && dailySnapshot && !dailySnapshot.checked_at_utc ? 'Last update' : 'Last sync';
      footer.textContent = `${label}: ${format(last)} · Next sync (scheduled): ${format(daily ? dailyNext : weeklyNext)}`;
      if (!daily && document.getElementById('standings-table')?.parentElement?.nextElementSibling === footer) {
        footer.textContent += ' · Max PF syncs daily at 9 AM Eastern.';
      }
    }
  }
  window.addEventListener('sparty-sleeper-totals', event => {dailySnapshot=event.detail;render();});
  render();
  setInterval(render,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
})();
