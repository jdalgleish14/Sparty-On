/* Offline presentation only. All scoring data comes from the validated exporter. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = value => Number(value).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + num(Math.abs(value));
  const text = (id,value) => { $(id).textContent = value; };
  const fail = () => { $('homepage').hidden = true; $('load-status').hidden = false; text('load-status', 'This snapshot could not be loaded. Keep the extracted folder together, then run the exporter and verifier successfully before reopening this page.'); };
  try {
    const d = window.SPARTY_ON_DATA;
    if (!d || d.validation_report?.status !== 'PASS' || !d.validation_report.checks.every(c => c.status === 'PASS')) throw new Error('Invalid snapshot');
    const seasons = d.seasons.filter(s => s.status === 'Current');
    if (seasons.length !== 1) throw new Error('Current season');
    const season = seasons[0], year = season.year, week = d.league.current_season_through_week;
    const standings = [...d.current_standings].sort((a,b) => a.rank - b.rank);
    const owners = new Map(d.owners.map(o => [o.owner_id,o.owner_name]));
    const currentGames = d.games.filter(g => g.year === year && g.stage === 'Regular Season');
    const pairs = new Map();
    d.games.forEach(g => { if (!pairs.has(g.game_id)) pairs.set(g.game_id, []); pairs.get(g.game_id).push(g); });
    if (!Number.isInteger(week) || week < 1 || week > season.regular_season_weeks || week !== d.validation_report.publication_cutoff.current_season_through_week || standings.length !== season.team_count || new Set(standings.map(s => s.owner_id)).size !== season.team_count || d.games.length !== d.validation_report.counts.game_rows || pairs.size !== d.validation_report.counts.all_games || [...pairs.values()].some(p => p.length !== 2) || currentGames.some(g => g.week > week) || standings.some(s => !owners.has(s.owner_id) || s.season_status !== 'Current' || s.year !== year || s.games_played !== week)) throw new Error('Snapshot mismatch');
    for (let w = 1; w <= week; w++) if (currentGames.filter(g => g.week === w).length !== season.team_count) throw new Error('Incomplete week');
    const weekGames = [...pairs.values()].filter(p => p[0].year === year && p[0].stage === 'Regular Season' && p[0].week === week).map(p => p.find(g => g.result === 'W') || p[0]);
    const hasTies = standings.some(s => s.ties > 0);
    const freshness = `${year} · Through Week ${week}`;
    text('freshness',freshness); text('footer-freshness',`${freshness} · Read-only snapshot`);
    text('era-label',`${season.era.toUpperCase()} / ${year}`);
    text('standings-context',`${standings.length} teams · ${week} games per team`);
    text('results-title',`Week ${week} results`);
    text('leaders-context',`${year} regular season · Through Week ${week} · In progress`);
    $('tie-heading').hidden = !hasTies;
    const record = s => `${s.wins}–${s.losses}${hasTies ? `–${s.ties}` : ''}`;
    let sortKey = 'rank', direction = 1;
    function renderStandings() {
      const sorted = [...standings].sort((a,b) => direction * (a[sortKey] - b[sortKey]) || a.rank - b.rank);
      $('standings-body').innerHTML = sorted.map(s => `<tr data-owner="${esc(s.owner_id)}"><td class="rank-number">${s.rank}</td><td class="owner-cell"><strong>${esc(owners.get(s.owner_id))}</strong><span class="team-name">${esc(s.team)}</span></td><td class="numeric standing-record">${record(s)}</td><td class="numeric">${num(s.points_for)}</td><td class="numeric">${num(s.points_against)}</td><td class="numeric">${num(s.average_points_for)}</td><td class="numeric ${s.average_margin >= 0 ? 'positive' : 'negative'}">${signed(s.average_margin)}</td></tr>`).join('');
      document.querySelectorAll('th[data-sort]').forEach(th => { const active = th.dataset.sort === sortKey; th.setAttribute('aria-sort', active ? (direction === 1 ? 'ascending' : 'descending') : 'none'); th.querySelector('span').textContent = active ? (direction === 1 ? '↑' : '↓') : '↕'; });
      $('reset-sort').hidden = sortKey === 'rank' && direction === 1;
    }
    renderStandings();
    document.querySelectorAll('th[data-sort] button').forEach(button => button.addEventListener('click', () => { const key = button.parentElement.dataset.sort; direction = key === sortKey ? -direction : (key === 'rank' ? 1 : -1); sortKey = key; renderStandings(); text('sort-status',`Table sorted by ${button.title || 'rank'}, ${direction === 1 ? 'ascending' : 'descending'}.`); }));
    $('reset-sort').addEventListener('click', () => { sortKey = 'rank'; direction = 1; renderStandings(); text('sort-status','Standings order restored.'); document.querySelector('th[data-sort="rank"] button').focus(); });
    const closest = Math.min(...weekGames.map(g => Math.abs(g.margin)));
    const side = (owner,team,score,winner) => `<div class="matchup-side ${winner ? 'winner' : ''}"><div><strong>${esc(owner)}${winner ? '<span class="win-label">W</span>' : ''}</strong><span class="team-name">${esc(team)}</span></div><span class="score">${num(score)}</span></div>`;
    $('matchups').innerHTML = weekGames.map(g => `<article class="matchup" data-game="${esc(g.game_id)}" aria-label="${esc(g.owner_name)} versus ${esc(g.opponent_owner_name)}"><div class="matchup-meta"><span>${g.result === 'T' ? 'Final · Tie' : Math.abs(g.margin) === closest ? 'Closest game' : 'Final'}</span><span class="margin-label">Margin ${num(Math.abs(g.margin))}</span></div>${side(g.owner_name,g.team,g.points_for,g.result === 'W')}${side(g.opponent_owner_name,g.opponent_team,g.points_against,false)}</article>`).join('');
    const weeklyTotal = weekGames.reduce((s,g) => s+g.points_for+g.points_against,0);
    $('week-summary').innerHTML = `<strong>${num(weeklyTotal)}</strong> total points · <strong>${num(weeklyTotal / (weekGames.length * 2))}</strong> per team`;
    function leadersBy(items,key) { const best = Math.max(...items.map(s => s[key])); return {best, rows:items.filter(s => s[key] === best)}; }
    const pf = leadersBy(standings,'points_for'), margin = leadersBy(standings,'average_margin'), high = leadersBy(currentGames,'points_for');
    const leaderCard = (title,value,unit,names,details) => `<article class="leader-card"><h3>${title}</h3><div class="leader-number">${value}<small>${unit}</small></div><p class="leader-name">${esc(names)}</p><p class="leader-detail">${esc(details)}</p></article>`;
    $('leaders').innerHTML = leaderCard('Most points',num(pf.best),'season PF',pf.rows.map(s => owners.get(s.owner_id)).join(' / '),pf.rows.map(s => s.team).join(' / ')) + leaderCard('Best average margin',signed(margin.best),'per game',margin.rows.map(s => owners.get(s.owner_id)).join(' / '),margin.rows.map(s => s.team).join(' / ')) + leaderCard('Highest single score',num(high.best),'points',high.rows.map(g => g.owner_name).join(' / '),high.rows.map(g => `${g.team} · Week ${g.week}`).join(' / '));
    const analytics = window.buildSeasonAnalytics(d,season,week);
    text('bonus-note',`The top ${Math.floor(season.team_count/2)} scores earn an extra win; the bottom ${season.team_count-Math.floor(season.team_count/2)} receive an extra loss. A tied cutoff follows workbook roster order. Ranked by combined wins, then points for.`);
    text('analytics-context',`${year} · Through Week ${week} · In progress`);
    const ownerCell = s => `<td class="owner-cell"><strong>${esc(owners.get(s.owner_id))}</strong><span class="team-name">${esc(s.team)}</span></td>`;
    const movement = (row,i) => { const delta=row.rank-(i+1); return `<td class="numeric rank-change ${delta>0?'positive':delta<0?'negative':''}" aria-label="${delta>0?`Up ${delta}`:delta<0?`Down ${-delta}`:'No change'} from regular standings">${delta>0?`+${delta}`:delta<0?`−${-delta}`:'—'}</td>`; };
    $('bonus-body').innerHTML = analytics.bonus.map((s,i) => `<tr data-owner="${esc(s.owner_id)}"><td class="rank-number">${i+1}</td>${ownerCell(s)}${movement(s,i)}<td class="numeric">${record(s)}</td><td class="numeric">${s.bonus_wins}–${s.bonus_losses}</td><td class="numeric standing-record">${s.adjusted_wins}–${s.adjusted_losses}${s.ties ? `–${s.ties}` : ''}</td><td class="numeric">${num(s.points_for)}</td></tr>`).join('');
    $('luck-body').innerHTML = analytics.luck.map((s,i) => `<tr data-owner="${esc(s.owner_id)}"><td class="rank-number">${i+1}</td>${ownerCell(s)}<td class="numeric">${record(s)}</td><td class="numeric">${num(s.expected_wins)}</td><td class="numeric ${s.luck>=0?'positive':'negative'}">${signed(s.luck)}</td></tr>`).join('');
    $('trends-body').innerHTML = analytics.weekly.map(s => `<tr><td>Week ${s.week}</td><td class="numeric">${s.average_winner===null?'—':num(s.average_winner)}</td><td class="numeric">${s.average_loser===null?'—':num(s.average_loser)}</td><td class="numeric">${num(s.total_points)}</td><td class="numeric">${num(s.average_margin)}</td></tr>`).join('');
    $('season-records-body').innerHTML = analytics.records.flatMap(r => r.games.length ? r.games.map(g => `<tr><td>${esc(r.title)}</td><td>Week ${g.week}</td><td class="numeric">${num(r.value)}</td><td class="owner-cell"><strong>${esc(g.owner_name)}${r.title.includes('margin') ? ` over ${esc(g.opponent_owner_name)}` : ''}</strong><span class="team-name">${esc(g.team)}${r.title.includes('margin') ? ` vs ${esc(g.opponent_team)}` : ''}</span></td></tr>`) : [`<tr><td>${esc(r.title)}</td><td>—</td><td>—</td><td>No qualifying games yet</td></tr>`]).join('');
    $('load-status').hidden = true; $('homepage').hidden = false;
  } catch (_) { fail(); }
})();
