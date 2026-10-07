/* Season history reads only the validated local exporter snapshot. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = value => Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + num(Math.abs(value));
  const set = (id,value) => { $(id).textContent = value; };
  try {
    const d = window.SPARTY_ON_DATA;
    if (!d || d.validation_report?.status !== 'PASS' || !Array.isArray(d.validation_report.checks) || d.validation_report.checks.some(c => c.status !== 'PASS')) throw Error('Invalid snapshot');
    const current = d.seasons.filter(s => s.status === 'Current');
    if (current.length !== 1 || d.league.current_season_through_week !== d.validation_report.publication_cutoff.current_season_through_week || d.games.length !== d.validation_report.counts.game_rows) throw Error('Snapshot cutoff');
    const cutoff = d.league.current_season_through_week;
    if (!Number.isInteger(cutoff) || cutoff < 1 || cutoff > current[0].regular_season_weeks) throw Error('Invalid week');
    const seasons = d.seasons.filter(s => s.status === 'Complete' || s.status === 'Current').sort((a,b) => b.year-a.year);
    if (seasons.length < 2 || new Set(seasons.map(s => s.year)).size !== seasons.length || d.games.some(g => g.year === current[0].year && (g.stage !== 'Regular Season' || g.week > cutoff))) throw Error('Unapproved season');
    const owners = new Map(d.owners.map(o => [o.owner_id,o.owner_name]));
    const pairs = new Map();
    for (const g of d.games) { if (!pairs.has(g.game_id)) pairs.set(g.game_id,[]); pairs.get(g.game_id).push(g); }
    if (pairs.size !== d.validation_report.counts.all_games || [...pairs.values()].some(p => p.length !== 2 || p[0].owner_id !== p[1].opponent_owner_id || p[1].owner_id !== p[0].opponent_owner_id || p[0].points_for !== p[1].points_against || p[1].points_for !== p[0].points_against)) throw Error('Game integrity');
    const games = [...pairs.values()].map(p => p.find(g => g.result === 'W') || p[0]);
    const byYear = new Map(seasons.map(s => [s.year, {
      season:s, summary:d.season_summaries.filter(row => row.year === s.year),
      games:games.filter(g => g.year === s.year), championship:d.championships.find(row => row.year === s.year)
    }]));
    for (const entry of byYear.values()) {
      const {season,summary,games:yearGames,championship} = entry;
      const regular=yearGames.filter(g => g.stage === 'Regular Season');
      const weeks=season.status === 'Current' ? cutoff : season.regular_season_weeks;
      if (summary.length !== season.team_count || new Set(summary.map(s => s.owner_id)).size !== summary.length || summary.some(s => !owners.has(s.owner_id) || s.season_status !== season.status || s.games_played !== weeks) || !Array.isArray(season.roster_owner_ids) || season.roster_owner_ids.length !== season.team_count || new Set(season.roster_owner_ids).size !== season.team_count || season.roster_owner_ids.some(id => !summary.some(row => row.owner_id === id)) || regular.length !== weeks * season.team_count/2 || regular.some(g => !Number.isInteger(g.week) || g.week < 1 || g.week > weeks) || (season.status === 'Complete') !== !!championship || (season.status === 'Current' && yearGames.length !== regular.length)) throw Error('Season inconsistency');
      for (let week=1;week<=weeks;week++) if (regular.filter(g => g.week === week).length !== season.team_count/2) throw Error('Incomplete week');
      if (championship && !yearGames.some(g => g.round === 'Championship' && g.owner_id === championship.champion_owner_id && g.opponent_owner_id === championship.runner_up_owner_id && g.points_for === championship.champion_score && g.points_against === championship.runner_up_score)) throw Error('Championship mismatch');
    }
    $('year-select').innerHTML = seasons.map(s => `<option value="${s.year}">${s.year}${s.status === 'Current' ? ' · In progress' : ''}</option>`).join('');
    const gameCard = g => {
      const win = g.points_for > g.points_against, tie = g.points_for === g.points_against;
      const side = (name,team,score,isWinner) => `<div class="archive-side${isWinner ? ' winner' : ''}"><span><strong>${esc(name)}</strong><small>${esc(team)}</small></span><b>${num(score)}</b></div>`;
      return `<article class="archive-game" aria-label="${esc(g.owner_name)} ${num(g.points_for)}, ${esc(g.opponent_owner_name)} ${num(g.points_against)}${tie ? ', tie' : ''}">${side(g.owner_name,g.team,g.points_for,win)}${side(g.opponent_owner_name,g.opponent_team,g.points_against,!win && !tie)}</article>`;
    };
    function renderWeek(entry,preferred) {
      const {season,games:yearGames} = entry, weeks=season.status === 'Current' ? cutoff : season.regular_season_weeks;
      const selected=Number(preferred);
      const week=Number.isInteger(selected) && selected >= 1 && selected <= weeks ? selected : weeks;
      $('week-select').innerHTML = Array.from({length:weeks},(_,i) => `<option value="${i+1}">Week ${i+1}</option>`).join('');
      $('week-select').value=String(week);
      const rows=yearGames.filter(g => g.stage === 'Regular Season' && g.week === week);
      set('weekly-context',`${season.year} · Week ${week} · ${rows.length} completed matchups${season.status === 'Current' ? ' · In progress' : ''}`);
      $('season-week-games').innerHTML=rows.map(gameCard).join('');
    }
    function renderYear(year) {
      const entry=byYear.get(Number(year)); if (!entry) throw Error('Invalid selection');
      const {season,summary,games:yearGames,championship}=entry;
      const isCurrent=season.status === 'Current', weeks=isCurrent ? cutoff : season.regular_season_weeks;
      $('year-select').value=String(year);
      set('season-era',`${season.era.toUpperCase()} / ${season.team_count} TEAMS`);
      set('season-heading',`${year} season`);
      set('season-subtitle',isCurrent ? `Through Week ${cutoff} · Regular season in progress` : `${season.regular_season_weeks} regular-season weeks · Championship decided`);
      set('season-state',isCurrent ? 'CURRENT · IN PROGRESS' : 'COMPLETED SEASON');
      set('standings-chip',isCurrent ? `Through Week ${cutoff}` : 'Final regular season');
      set('postseason-chip',isCurrent ? 'Not yet played' : 'Final');
      set('season-footer',`${year} · ${isCurrent ? `Through Week ${cutoff} · In progress` : 'Completed season'} · Read-only snapshot`);
      const regular=yearGames.filter(g => g.stage === 'Regular Season');
      const sum=regular.reduce((total,g) => total+g.points_for+g.points_against,0);
      const metrics=[['Teams',season.team_count],['Weeks played',weeks],['Games played',regular.length],['Average team score',num(sum/(regular.length*2))]];
      $('season-metrics').innerHTML=metrics.map(([label,value]) => `<div class="season-metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
      const ranked=[...summary].sort((a,b) => b.wins-a.wins || a.losses-b.losses || b.points_for-a.points_for || a.owner_id.localeCompare(b.owner_id));
      $('historic-standings').innerHTML=ranked.map((row,i) => `<tr data-owner="${esc(row.owner_id)}"><td class="rank-number">${i+1}</td><td class="owner-cell"><strong>${esc(owners.get(row.owner_id))}</strong><span class="team-name">${esc(row.team)}</span></td><td class="numeric standing-record">${row.wins}–${row.losses}–${row.ties}</td><td class="numeric">${num(row.points_for)}</td><td class="numeric">${num(row.points_against)}</td><td class="numeric">${num(row.average_points_for)}</td><td class="numeric ${row.average_margin >= 0 ? 'positive' : 'negative'}">${signed(row.average_margin)}</td></tr>`).join('');
      const winnerTeam=championship && summary.find(row => row.owner_id===championship.champion_owner_id)?.team;
      $('season-honors').innerHTML=championship ? `<div class="honors-card"><small>CHAMPION</small><strong>${esc(championship.champion_owner_name)}</strong><span>${esc(winnerTeam)} · defeated ${esc(championship.runner_up_owner_name)} ${num(championship.champion_score)}–${num(championship.runner_up_score)}</span></div>` : '<p class="honors-empty">No postseason results yet. The season is in progress.</p>';
      const rounds=['Quarterfinal','Semifinal','Championship'];
      $('postseason-rounds').innerHTML=rounds.map(round => {
        const rows=yearGames.filter(g => g.stage === 'Postseason' && g.round === round);
        return rows.length ? `<div class="round-block"><h3>${round === 'Quarterfinal' ? 'Quarterfinals' : round === 'Semifinal' ? 'Semifinals' : 'Championship'} · ${rows.length} ${rows.length===1 ? 'game' : 'games'}</h3><div class="round-games">${rows.map(gameCard).join('')}</div></div>` : '';
      }).join('');
      const analytics = window.buildSeasonAnalytics(d,season,weeks);
      set('year-detail-context',`${year} regular season · ${isCurrent ? `Through Week ${cutoff} · In progress` : 'Completed season'}`);
      set('year-bonus-note',`The top ${Math.floor(season.team_count/2)} weekly scores earn a bonus win; the rest receive a bonus loss. Ties at the cutoff follow workbook roster order. Ranked by combined wins, then points for.`);
      const ownerCell = row => `<td class="owner-cell"><strong>${esc(owners.get(row.owner_id))}</strong><span class="team-name">${esc(row.team)}</span></td>`;
      const record = row => `${row.wins}–${row.losses}${row.ties ? `–${row.ties}` : ''}`;
      const regularRank=new Map(ranked.map((row,i)=>[row.owner_id,i+1]));
      const movement=(row,i)=>{const delta=regularRank.get(row.owner_id)-(i+1);return `<td class="numeric rank-change ${delta>0?'positive':delta<0?'negative':''}" aria-label="${delta>0?`Up ${delta}`:delta<0?`Down ${-delta}`:'No change'} from regular standings">${delta>0?`+${delta}`:delta<0?`−${-delta}`:'—'}</td>`;};
      $('year-bonus-body').innerHTML=analytics.bonus.map((row,i) => `<tr data-owner="${esc(row.owner_id)}"><td class="rank-number">${i+1}</td>${ownerCell(row)}${movement(row,i)}<td class="numeric">${record(row)}</td><td class="numeric">${row.bonus_wins}–${row.bonus_losses}</td><td class="numeric standing-record">${row.adjusted_wins}–${row.adjusted_losses}${row.ties ? `–${row.ties}` : ''}</td><td class="numeric">${num(row.points_for)}</td></tr>`).join('');
      $('year-luck-body').innerHTML=analytics.luck.map((row,i) => `<tr data-owner="${esc(row.owner_id)}"><td class="rank-number">${i+1}</td>${ownerCell(row)}${movement(row,i)}<td class="numeric">${record(row)}</td><td class="numeric">${num(row.expected_wins)}</td><td class="numeric ${row.luck >= 0 ? 'positive' : 'negative'}">${signed(row.luck)}</td></tr>`).join('');
      $('year-records-body').innerHTML=analytics.records.flatMap(r => r.games.length ? r.games.map(g => `<tr><td>${esc(r.title)}</td><td>Week ${g.week}</td><td class="numeric">${num(r.value)}</td><td class="owner-cell"><strong>${esc(g.owner_name)}${r.title.includes('margin') ? ` over ${esc(g.opponent_owner_name)}` : ''}</strong><span class="team-name">${esc(g.team)}${r.title.includes('margin') ? ` vs ${esc(g.opponent_team)}` : ''}</span></td></tr>`) : [`<tr><td>${esc(r.title)}</td><td>—</td><td>—</td><td>No qualifying games</td></tr>`]).join('');
      const extremes=[['Most points scored','points_for',true],['Fewest points scored','points_for',false],['Most points allowed','points_against',true],['Fewest points allowed','points_against',false]];
      $('year-extremes-body').innerHTML=extremes.flatMap(([title,key,highest]) => {
        const value=(highest ? Math.max : Math.min)(...summary.map(row => row[key]));
        return summary.filter(row => Math.abs(row[key]-value)<0.000001).map(row => `<tr><td>${title}</td>${ownerCell(row)}<td class="numeric">${num(row[key])}</td><td class="numeric">${num(row[key]/row.games_played)}</td></tr>`);
      }).join('');
      renderWeek(entry);
    }
    $('year-select').addEventListener('change',event => renderYear(event.target.value));
    $('week-select').addEventListener('change',event => renderWeek(byYear.get(Number($('year-select').value)),event.target.value));
    renderYear(seasons.find(s => s.status === 'Complete').year);
    $('load-status').hidden=true; $('seasons-page').hidden=false;
  } catch (_) {
    $('seasons-page').hidden=true; $('load-status').hidden=false;
    set('load-status','This season archive could not be loaded. Keep the extracted folder together, then run the exporter and verifier successfully.');
  }
})();
