/* One page footnote; publication time is never replaced by page-load time. */
(() => {
  'use strict';
  const zone = 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
  const format = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', {timeZone:zone, month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'}) : 'unavailable';
  const fields = date => Object.fromEntries(parts.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  function nextSync(now) {
    const local = fields(now), candidates = [];
    for (let day=0; day<=8; day++) {
      const calendar = new Date(Date.UTC(local.year,local.month-1,local.day+day));
      const dow = calendar.getUTCDay();
      const times = dow === 2 ? [[6,0],[11,13],[12,43]] : dow === 3 ? [[8,13]] : [];
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
  async function start() {
    const data = window.SPARTY_ON_DATA;
    let generatedAt;
    if (data) {
      if (data.validation_report?.status !== 'PASS') return;
      generatedAt = data.league.generated_at_utc;
    } else {
      // Ask Sparty has a separate interface; load only small publication metadata.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('site-data/manifest.json', {cache:'no-store', signal:controller.signal});
        if (!response.ok) return;
        const manifest = await response.json();
        if (!manifest.files?.['games.json']?.sha256) return;
        generatedAt = manifest.generated_at_utc;
      } finally { clearTimeout(timeout); }
    }
    if (!Number.isFinite(Date.parse(generatedAt))) return;
    const footer = document.querySelector('main footer');
    if (!footer) return;
    for (const old of document.querySelectorAll('main .table-sync')) {
      if (old.id !== 'page-sync') old.remove();
    }
    let note = document.getElementById('page-sync');
    if (!note) {
      note = document.createElement('p');
      note.id = 'page-sync';
      note.className = 'table-sync page-sync';
      footer.insertAdjacentElement('afterend', note);
    }
    // Explicit opt-in: only single-team standings columns stay pinned.
    for (const id of ['standings-body','bonus-body','luck-body','historic-standings','year-bonus-body','year-luck-body']) {
      const table = document.getElementById(id)?.closest('table');
      if (table) table.classList.add('compact-team-pin');
    }
    function render() {
      note.textContent = `League results — Last sync: ${format(generatedAt)} · Next sync (scheduled): ${format(nextSync(new Date()))}`;
      if (document.getElementById('transactions-table')) {
        note.textContent += ' · Transactions / Max PF: daily at 9 AM Eastern.';
      }
    }
    render();
    setInterval(render,60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
  }
  start().catch(() => { /* Keep the page usable when publication metadata is unavailable. */ });
})();
