/* Independent transaction snapshot: no score-cutoff or manifest changes required. */
(() => {
  'use strict';
  const table = document.getElementById('transactions-table');
  if (!table) return;
  const status = document.getElementById('transactions-status');
  const body = document.getElementById('transactions-body');
  const keys = ['total', 'trades', 'free_agents', 'waivers'];
  let snapshot, sort = 'total', descending = true, loading = false;
  function render() {
    const rows = [...snapshot.teams].sort((a,b) => (descending ? b[sort]-a[sort] : a[sort]-b[sort]) || a.team.localeCompare(b.team));
    body.replaceChildren(...rows.map(row => {
      const tr = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row'; name.textContent = row.team; tr.append(name);
      keys.forEach(key => {
        const td = document.createElement('td');
        td.className = 'numeric'; td.textContent = row[key]; tr.append(td);
      });
      return tr;
    }));
    table.querySelectorAll('[data-tx-sort]').forEach(th => {
      if (th.dataset.txSort === sort) th.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    });
    table.hidden = false;
    document.getElementById('transactions-season').textContent = snapshot.season;
    status.textContent = 'Last change synced ' + new Date(snapshot.fetched_at_utc).toLocaleString() + '.';
  }
  table.querySelectorAll('[data-tx-sort] button').forEach(button => button.addEventListener('click', () => {
    const key = button.parentElement.dataset.txSort;
    descending = key === sort ? !descending : true;
    sort = key;
    if (snapshot) render();
  }));
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('site-data/transactions.json', {cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('Unavailable');
      const next = await response.json();
      const current = window.SPARTY_ON_DATA?.seasons?.find(s => s.status === 'Current');
      if (!Array.isArray(next.teams) || !next.teams.length || !Number.isFinite(Date.parse(next.fetched_at_utc)) || (current && next.season !== current.year)) throw new Error('Invalid snapshot');
      if (next.teams.some(r => typeof r.team !== 'string' || keys.some(k => !Number.isSafeInteger(r[k]) || r[k]<0) || r.total !== r.trades+r.free_agents+r.waivers)) throw new Error('Invalid totals');
      snapshot = next; render();
      window.dispatchEvent(new CustomEvent('sparty-sleeper-totals', {detail: next}));
    } catch (_) {
      status.textContent = snapshot ? 'Could not check for updates. Showing totals last changed ' + new Date(snapshot.fetched_at_utc).toLocaleString() + '.' : 'Transaction totals are not available yet. They will appear after the first successful sync.';
    } finally { clearTimeout(timeout); loading = false; }
  }
  refresh();
  setInterval(refresh, 5*60*1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh);
})();
