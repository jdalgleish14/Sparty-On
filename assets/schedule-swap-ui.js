/* Schedule exploration shares the verified snapshot and automatic refresh loader. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('schedule-swap-section')) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const signed = (value, decimals = false) => (value > 0 ? '+' : value < 0 ? '−' : '') + (decimals ? fmt(Math.abs(value)) : Math.abs(value));
  const record = r => `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`;
  const tone = n => n > 0 ? 'positive' : n < 0 ? 'negative' : '';
  try {
    const analysis = window.SpartyScheduleSwap.build(window.SPARTY_ON_DATA);
    const teams = new Map(analysis.teams.map(t => [t.owner_id, t]));
    let names = new Map(analysis.teams.map(t => [t.owner_id, t.team]));
    let selected = analysis.teams[0].owner_id, sortKey = 'actual', direction = -1;
    const name = id => names.get(id);
    function applyNames(snapshot) {
      if (snapshot?.season !== analysis.year || !Array.isArray(snapshot.teams) || snapshot.teams.length !== teams.size ||
          new Set(snapshot.teams.map(t => t.owner_id)).size !== teams.size || snapshot.teams.some(t => !teams.has(t.owner_id) || typeof t.team !== 'string' || !t.team.trim())) return false;
      names = new Map(snapshot.teams.map(t => [t.owner_id, t.team.trim()]));
      return true;
    }
    applyNames(window.SPARTY_SLEEPER_SNAPSHOT);
    $('swap-context').textContent = `${analysis.year} · Through Week ${analysis.weeks}`;
    $('swap-difficulty-context').textContent = $('swap-context').textContent;
    $('swap-status').hidden = true;
    if (!analysis.weeks) {
      $('swap-status').hidden = false;
      $('swap-status').textContent = 'Schedule swaps will appear after the first verified regular-season week.';
      return;
    }
    $('swap-content').hidden = false;
    $('schedule-difficulty-section').hidden = false;
    const options = () => analysis.teams.map(t => `<option value="${esc(t.owner_id)}">${esc(name(t.owner_id))}</option>`).join('');
    function selectors() {
      $('swap-team').innerHTML = options(); $('swap-team').value = selected;
    }
    function summary() {
      const compare = (a, b) => {
        if (sortKey === 'team') return name(a.owner_id).localeCompare(name(b.owner_id));
        if (['actual', 'best', 'worst'].includes(sortKey)) return -window.SpartyScheduleSwap.compareRecords(a[sortKey], b[sortKey]);
        return a[sortKey] - b[sortKey];
      };
      const rows = [...analysis.teams].sort((a, b) => direction * compare(a, b) || a.rank - b.rank);
      $('swap-summary-body').innerHTML = rows.map(t => `<tr${t.owner_id === selected ? ' class="swap-selected"' : ''}><th scope="row" class="swap-team-cell"><button type="button" data-swap-team="${esc(t.owner_id)}" aria-pressed="${t.owner_id === selected}">${esc(name(t.owner_id))}</button></th><td class="numeric">${record(t.actual)}</td><td class="numeric">${fmt(t.averageWins)}</td><td class="numeric">${record(t.best)}</td><td class="numeric">${record(t.worst)}</td><td class="numeric ${tone(t.impact)}">${signed(t.impact, true)}</td></tr>`).join('');
      $('swap-summary-table').querySelectorAll('[data-swap-sort]').forEach(th => {
        const active = th.dataset.swapSort === sortKey;
        th.setAttribute('aria-sort', active ? direction === 1 ? 'ascending' : 'descending' : 'none');
        th.querySelector('span').textContent = active ? direction === 1 ? '↑' : '↓' : '↕';
      });
    }
    function detail() {
      const team = teams.get(selected);
      $('swap-detail-title').textContent = name(selected);
      $('swap-stats').innerHTML = [['Actual',record(team.actual)],['Average wins',fmt(team.averageWins)],['Best',record(team.best)],['Worst',record(team.worst)],['Schedule impact',signed(team.impact,true)]].map(([label,value],i) => `<div><dt>${label}</dt><dd${i === 4 ? ` class="${tone(team.impact)}"` : ''}>${value}</dd></div>`).join('');
      const scenarios = [...team.scenarios].sort((a, b) => (b.schedule_id === selected) - (a.schedule_id === selected) || window.SpartyScheduleSwap.compareRecords(a, b) || name(a.schedule_id).localeCompare(name(b.schedule_id)));
      $('swap-detail-body').innerHTML = scenarios.map(s => `<tr${s.schedule_id === selected ? ' class="swap-actual"' : ''}><th scope="row">${esc(name(s.schedule_id))}${s.schedule_id === selected ? ' <span class="swap-actual-label">(Actual)</span>' : ''}</th><td class="numeric">${record(s)}</td><td class="numeric ${tone(s.difference)}">${s.schedule_id === selected ? '—' : signed(s.difference)}</td></tr>`).join('');
    }
    function difficulty() {
      const rows = [...analysis.difficulty].sort((a,b) => a.averageWins - b.averageWins || name(a.schedule_id).localeCompare(name(b.schedule_id)));
      const hardOrder = [...analysis.difficulty].sort((a,b) => a.averageWins - b.averageWins);
      $('swap-difficulty-body').innerHTML = rows.map(s => {
        const rank = hardOrder.findIndex(other => other.averageWins === s.averageWins) + 1;
        return `<tr><td class="rank-number">${rank}</td><th scope="row">${esc(name(s.schedule_id))}</th><td class="numeric">${fmt(s.averageWins)}</td></tr>`;
      }).join('');
    }
    function render() { selectors(); summary(); detail(); difficulty(); }
    function select(id) {
      if (!teams.has(id)) return;
      selected = id; $('swap-team').value = id; summary(); detail();
      $('swap-announcement').textContent = `Showing ${name(id)}'s schedule analysis.`;
    }
    $('swap-team').addEventListener('change', event => select(event.target.value));
    $('swap-summary-body').addEventListener('click', event => {
      const button = event.target.closest('button[data-swap-team]');
      if (!button) return;
      select(button.dataset.swapTeam);
      $('swap-detail-title').focus({preventScroll: true});
      $('swap-detail').scrollIntoView({block:'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    });
    $('swap-summary-table').querySelectorAll('[data-swap-sort] button').forEach(button => button.addEventListener('click', () => {
      const key = button.parentElement.dataset.swapSort;
      direction = key === sortKey ? -direction : key === 'team' ? 1 : -1;
      sortKey = key; summary();
      $('swap-announcement').textContent = `Schedule summary sorted by ${button.textContent.trim()}, ${direction === 1 ? 'ascending' : 'descending'}.`;
    }));
    window.addEventListener('sparty-sleeper-totals', event => {if (applyNames(event.detail)) render();});
    render();
  } catch (error) {
    $('swap-status').hidden = false;
    $('swap-status').textContent = `Schedule analysis is unavailable: ${error.message}`;
    $('swap-content').hidden = true;
    $('schedule-difficulty-section').hidden = true;
  }
})();
