/* Verified results ticker with optional Sleeper starter highlights. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = value => Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  try {
    const d = window.SPARTY_ON_DATA;
    if (!d || d.validation_report?.status !== 'PASS' || !d.validation_report.checks.every(c => c.status === 'PASS')) throw new Error('Snapshot validation');
    const current = d.seasons.filter(s => s.status === 'Current');
    if (current.length !== 1) throw new Error('Current season');
    const season = current[0], week = d.league.current_season_through_week;
    if (!Number.isInteger(week) || week < 1 || week > season.regular_season_weeks || week !== d.validation_report.publication_cutoff.current_season_through_week || d.games.length !== d.validation_report.counts.game_rows) throw new Error('Cutoff');
    const currentGames = d.games.filter(g => g.year === season.year && g.stage === 'Regular Season');
    if (currentGames.some(g => g.week > week)) throw new Error('Unapproved data');
    for (let w=1; w<=week; w++) {
      const rows = currentGames.filter(g => g.week === w);
      if (rows.length !== season.team_count || new Set(rows.map(g => g.owner_id)).size !== season.team_count) throw new Error('Incomplete week');
    }
    const pairs = new Map();
    currentGames.filter(g => g.week === week).forEach(g => { if (!pairs.has(g.game_id)) pairs.set(g.game_id,[]); pairs.get(g.game_id).push(g); });
    const games = [...pairs.values()].map(p => {
      if (p.length !== 2 || p[0].owner_id !== p[1].opponent_owner_id || p[1].owner_id !== p[0].opponent_owner_id || p[0].points_for !== p[1].points_against || p[1].points_for !== p[0].points_against || !Number.isFinite(p[0].points_for) || !Number.isFinite(p[0].points_against)) throw new Error('Game pair');
      return p.find(g => g.points_for > g.points_against) || p[0];
    });
    if (games.length !== season.team_count/2 || !games.length) throw new Error('Matchups');
    const marginOf = g => Math.round(Math.abs(g.points_for-g.points_against)*100)/100;
    const closest = Math.min(...games.map(marginOf)), biggest = Math.max(...games.map(marginOf));
    const first = Math.min(...d.games.map(g => g.year));
    $('archive-years').textContent = `FANTASY FOOTBALL / EST. ${first}`;
    $('home-freshness').textContent = `${season.year} · Through Week ${week} · Season in progress`;
    $('ticker-title').textContent = `${season.year} · Week ${week}`;
    $('ticker-status').textContent = 'All games final';
    $('ticker-content').hidden = false;
    const stage = $('ticker-stage'), pause = $('ticker-pause'), leaders = $('ticker-leaders');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let paused = motion.matches, index = 0, dwellTimer = null, fadeTimer = null, scorers = null;
    const holdMs = 6000, fadeMs = 300;
    function clearTimers() { clearTimeout(dwellTimer); clearTimeout(fadeTimer); dwellTimer = null; fadeTimer = null; }
    function description(g) { return `${g.owner_name}, ${g.team}, record ${teamRecord(g.owner_id)}, ${num(g.points_for)} points. ${g.opponent_owner_name}, ${g.opponent_team}, record ${teamRecord(g.opponent_owner_id)}, ${num(g.points_against)} points. ${labels(g).join('. ')}. Margin ${num(marginOf(g))}.`; }
    function labels(g) {
      const labels = [];
      if (marginOf(g) === closest) labels.push('Closest game');
      if (marginOf(g) === biggest) labels.push('Biggest blowout');
      if (marginOf(g) === 0) labels.push('Tie');
      return labels.length ? labels : ['Final'];
    }
    function teamRecord(ownerId) {
      const rows=currentGames.filter(g => g.owner_id===ownerId);
      const wins=rows.filter(g => g.points_for>g.points_against).length;
      const losses=rows.filter(g => g.points_for<g.points_against).length;
      const ties=rows.length-wins-losses;
      return `${wins}–${losses}${ties ? `–${ties}` : ''}`;
    }
    function identity(ownerId,owner,team,away=false) {
      return `<div class="ticker-identity${away ? ' ticker-away' : ''}"><strong>${esc(team)}</strong><span class="ticker-record">${teamRecord(ownerId)} · ${esc(owner)}</span></div>`;
    }
    function render(announce=false) {
      const g = games[index];
      stage.innerHTML = `<div class="ticker-matchup">${identity(g.owner_id,g.owner_name,g.team)}<b class="ticker-score ticker-winning-score">${num(g.points_for)}</b><b class="ticker-score">${num(g.points_against)}</b>${identity(g.opponent_owner_id,g.opponent_owner_name,g.opponent_team,true)}</div><div class="ticker-game-note">${labels(g).map(label => `<span class="ticker-badge">${label}</span>`).join('')}<span>Margin ${num(marginOf(g))}</span></div>`;
      stage.setAttribute('aria-label',`Matchup ${index+1} of ${games.length}`);
      $('ticker-counter').textContent = `${index+1} / ${games.length} matchups`;
      renderLeaders(g);
      if (announce) $('ticker-announcement').textContent = description(g);
    }
    function renderLeaders(g){
      leaders.open=false;
      const a=scorers?.get(g.owner_id),b=scorers?.get(g.opponent_owner_id);
      leaders.hidden=!a||!b;
      if(leaders.hidden)return;
      const side=(team,row)=>`<div><h3>${esc(team)}</h3><ol>${window.SPARTY_SLEEPER.topScorers(row).map(p=>`<li><span>${esc(p.name)}</span><b>${num(p.points)}</b></li>`).join('')}</ol></div>`;
      $('ticker-leaders-body').innerHTML=side(g.team,a)+side(g.opponent_team,b);
    }
    function schedule() {
      clearTimeout(dwellTimer);
      if (!paused && !document.hidden && games.length > 1) dwellTimer = setTimeout(() => change(1,false),holdMs);
    }
    function change(delta,announce) {
      clearTimers();
      const next = (index+delta+games.length)%games.length;
      if (motion.matches) { index=next; render(announce); schedule(); return; }
      stage.classList.add('is-fading');
      fadeTimer = setTimeout(() => { index=next; render(announce); stage.classList.remove('is-fading'); fadeTimer=null; schedule(); },fadeMs);
    }
    function updatePause() {
      pause.textContent = paused ? 'Play' : 'Pause';
      pause.setAttribute('aria-pressed',String(paused));
      pause.setAttribute('aria-label',paused ? 'Play automatic matchup rotation' : 'Pause automatic matchup rotation');
      stage.setAttribute('aria-live',paused ? 'polite' : 'off');
    }
    pause.addEventListener('click', () => { paused=!paused; clearTimers(); stage.classList.remove('is-fading'); updatePause(); schedule(); });
    leaders.addEventListener('toggle',()=>{if(leaders.open){paused=true;clearTimers();updatePause();}});
    $('ticker-prev').addEventListener('click', () => change(-1,true));
    $('ticker-next').addEventListener('click', () => change(1,true));
    document.addEventListener('visibilitychange', () => { clearTimers(); stage.classList.remove('is-fading'); schedule(); });
    motion.addEventListener('change', () => { if (motion.matches) paused=true; clearTimers(); stage.classList.remove('is-fading'); updatePause(); schedule(); });
    render(); updatePause(); schedule();
    if(window.SPARTY_SLEEPER)window.SPARTY_SLEEPER.completedWeek(season.year,week,currentGames.filter(g=>g.week===week)).then(rows=>{scorers=rows;renderLeaders(games[index]);});
  } catch (_) {
    $('ticker-content').hidden = true;
    $('ticker-status').textContent = 'Results unavailable. Run the exporter and verifier successfully to restore this snapshot.';
  }
})();
