(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const p = window.SPARTY_PLAYOFFS, d = window.SPARTY_ON_DATA, api = window.SpartyScenarios;
  if (!$('playoff-predictor')) return;
  const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const fail = text => { $('playoff-status').textContent = text; $('playoff-content').hidden = true; if ($('bracket-status')) $('bracket-status').textContent = text; };
  if (!p || !api || !p.model.means) return fail('Predictions are waiting for the remaining schedule.');
  const signature = d?.current_standings?.slice().sort((a,b) => a.owner_id.localeCompare(b.owner_id)).map(s => [s.owner_id,s.wins,s.losses,s.ties,s.points_for]);
  if (!d || d.validation_report?.status !== 'PASS' || p.season !== d.current_standings?.[0]?.year || p.through_week !== d.league.current_season_through_week || JSON.stringify(signature) !== JSON.stringify(p.standings_signature)) return fail('Predictions are being refreshed. Current standings are still available.');
  const ids = p.standings_signature.map(s => s[0]);
  const scoreSignature = Array.from({length:p.through_week}, (_,w) => ids.map(id => d.games.find(g => g.year === p.season && g.stage === 'Regular Season' && g.week === w+1 && g.owner_id === id)?.points_for));
  if (JSON.stringify(scoreSignature) !== JSON.stringify(p.score_signature)) return fail('Predictions are being refreshed after a score correction.');
  const names = Object.fromEntries(p.teams.map(r => [r.owner_id,r.owner]));
  const name = id => names[id];
  const pct = x => x < .001 ? '<0.1%' : x > .999 ? '>99.9%' : (100*x).toFixed(1)+'%';
  const row = (body, values) => { const tr = el('tr'); values.forEach(v => tr.append(el('td',v))); body.append(tr); return tr; };
  let picks = {}, baseline = null, bank = null, dirty = false, computing = false, version = 0, timer;
  const controls = new Map(), weeks = new Map();

  // One distinct team per seed, ordered by the forecast's average finish.
  // Fixed paths: 1/8 meets 4/5; 2/7 meets 3/6. No reseeding.
  if ($('projected-bracket')) {
    const bracket = $('projected-bracket');
    const seeded = [...p.teams].sort((a,b) => a.average_seed-b.average_seed || b.projected_wins-a.projected_wins || a.owner_id.localeCompare(b.owner_id)).slice(0,8);
    if (seeded.length === 8) {
      const rounds = [['Quarterfinals',15],['Semifinals',16],['Championship',17]].map(([title,week]) => {
        const section = el('section'); section.className = 'bracket-round';
        section.append(el('h3',title),el('p','Week '+week));
        const games = el('div'); games.className = 'bracket-games'; section.append(games); bracket.append(section);
        return games;
      });
      const match = (round, label, entries) => {
        const game = el('article'); game.className = 'bracket-match';
        game.setAttribute('aria-label',label); game.append(el('h4',label));
        for (const [seed,text] of entries) {
          const team = el('div'); team.className = 'bracket-team';
          if (seed) { const badge = el('span',String(seed)); badge.className = 'bracket-seed'; team.append(badge); }
          team.append(el('span',text)); game.append(team);
        }
        round.append(game);
      };
      [[1,8],[4,5],[2,7],[3,6]].forEach((pair,i) => match(rounds[0],'Game '+(i+1),pair.map(seed => [seed,seeded[seed-1].owner])));
      match(rounds[1],'Semifinal 1',[[null,'Winner of Game 1'],[null,'Winner of Game 2']]);
      match(rounds[1],'Semifinal 2',[[null,'Winner of Game 3'],[null,'Winner of Game 4']]);
      match(rounds[2],'Final',[[null,'Winner of Semifinal 1'],[null,'Winner of Semifinal 2']]);
      $('bracket-status').textContent = 'Seeds based on average projected finish through Week '+p.through_week+'. No byes or reseeding.';
      bracket.hidden = false;
    } else $('bracket-status').textContent = 'Bracket is waiting for a complete forecast.';
  }

  // The published league forecast is visible immediately, before choosing a team.
  for (const r of p.teams) {
    const tr = el('tr'), owner = el('td'), button = el('button',r.owner);
    button.type = 'button'; button.className = 'playoff-owner';
    button.addEventListener('click', () => { $('playoff-team').value = r.owner_id; selectTeam(); });
    owner.append(button); tr.append(owner);
    for (const value of [r.record,pct(r.playoff_pct/100),r.projected_wins.toFixed(1),r.average_seed.toFixed(1),r.status === 'Not proven' ? 'Open' : r.status]) tr.append(el('td',value));
    $('playoff-body').append(tr);
  }
  for (const r of [...p.teams].sort((a,b) => a.owner.localeCompare(b.owner))) {
    const option = el('option',r.owner); option.value = r.owner_id; $('playoff-team').append(option);
  }
  $('playoff-team').value = '';
  for (const w of p.remaining_schedule) {
    for (const selectId of ['root-week','scenario-week']) {
      const option = el('option','Week '+w.week); option.value = String(w.week); $(selectId).append(option);
    }
    const group = el('div'); weeks.set(String(w.week),group);
    for (const pair of w.games) {
      const key = w.week+':'+pair.join(':'), label = el('label',name(pair[0])+' vs '+name(pair[1])), select = el('select');
      select.setAttribute('aria-label','Week '+w.week+': '+name(pair[0])+' vs '+name(pair[1]));
      for (const [value,text] of [['','No pick'],...pair.map(id => [id,name(id)+' wins'])]) {
        const option = el('option',text); option.value = value; select.append(option);
      }
      select.value = '';
      select.addEventListener('change', () => { if (select.value) picks[key] = select.value; else delete picks[key]; changed(); });
      controls.set(key,select); label.append(select); group.append(label);
    }
    $('scenario-games').append(group);
  }
  $('root-week').value = String(p.through_week+1);
  $('scenario-week').value = String(p.through_week+1);
  function showWeek() { weeks.forEach((group,key) => group.hidden = key !== $('scenario-week').value); }
  showWeek();
  $('scenario-week').addEventListener('change',showWeek);

  function pickLabel() {
    const count = Object.keys(picks).length;
    $('pick-count').textContent = count ? ' · '+count+(count === 1 ? ' pick' : ' picks') : '';
    $('scenario-reset').hidden = !count;
  }
  function changed() {
    dirty = true; version++; clearTimeout(timer); pickLabel();
    $('team-outlook').hidden = true; $('team-cards').replaceChildren();
    $('scenario-status').hidden = false; $('scenario-status').textContent = 'Updating outlook…';
    $('scenario-run').hidden = true;
    timer = setTimeout(update,250);
  }
  function ownPicks(win) {
    const id = $('playoff-team').value, target = ids.indexOf(id); if (target < 0) return;
    for (const g of api.setup(p).games) if (g.a === target || g.b === target) {
      const chosen = win ? id : ids[g.a === target ? g.b : g.a];
      picks[g.key] = chosen; controls.get(g.key).value = chosen;
    }
    changed();
  }
  $('scenario-winout').addEventListener('click', () => ownPicks(true));
  $('scenario-loseout').addEventListener('click', () => ownPicks(false));
  $('scenario-reset').addEventListener('click', () => {
    picks = {}; controls.forEach(select => select.value = ''); changed(); clearTimeout(timer); update();
  });

  function rootCard(g) {
    const a = ids[g.a], b = ids[g.b], fav = g.delta >= 0 ? a : b, item = el('article');
    item.append(el('h4','Week '+g.week+' · '+name(a)+' vs '+name(b)));
    const line = el('div'); line.className = 'rooting-recommendation';
    line.append(el('strong',g.confident ? 'Root for '+name(fav) : 'No clear preference'));
    if (g.confident) {
      line.append(el('span','+'+(100*Math.abs(g.delta)).toFixed(1)+' pts'));
      const button = el('button','Pick '+name(fav)); button.type = 'button';
      button.addEventListener('click', () => { picks[g.key] = fav; controls.get(g.key).value = fav; changed(); });
      line.append(button);
    }
    item.append(line);
    const detail = el('details'); detail.append(el('summary','Compare outcomes'));
    detail.append(el('p','Your playoff chance: '+(g.aN >= 300 ? pct(g.pa) : 'not enough samples')+' if '+name(a)+' wins; '+(g.bN >= 300 ? pct(g.pb) : 'not enough samples')+' if '+name(b)+' wins.'));
    const margin = Number.isFinite(g.error) ? ' Estimated margin: ±'+(100*g.error).toFixed(1)+' percentage points.' : '';
    detail.append(el('p',g.aN.toLocaleString()+' simulations with '+name(a)+' winning; '+g.bN.toLocaleString()+' with '+name(b)+' winning.'+margin));
    item.append(detail); return item;
  }
  function render() {
    const id = $('playoff-team').value; if (!id || !bank || dirty || computing) return;
    const r = p.teams.find(r => r.owner_id === id), s = api.summary(bank,id), base = api.summary(baseline,id), proof = api.proof(p,picks,id), count = Object.keys(picks).length;
    $('team-outlook').hidden = false;
    $('team-summary').textContent = r.record+' · '+d.current_standings.find(x => x.owner_id === id).points_for.toFixed(2)+' PF'+(count ? ' · With your picks' : ' · Current forecast');
    $('team-cards').replaceChildren();
    const cardData = [['Playoff chance',pct(count ? s.probability : r.playoff_pct/100)],['Expected wins',(count ? s.avgWins : r.projected_wins).toFixed(1)],['Average finish',(count ? s.avgSeed : r.average_seed).toFixed(1)]];
    if (count) {
      const change = 100*(s.probability-base.probability);
      cardData.push(['Change with picks',(Math.abs(change) < .05 ? '0.0' : (change > 0 ? '+' : '')+change.toFixed(1))+' pts']);
    }
    for (const [label,value] of cardData) { const card = el('div'); card.append(el('span',label),el('strong',value)); $('team-cards').append(card); }

    const guaranteed = r.finish_paths.find(x => x.guaranteed);
    $('clinch-path').textContent = r.status === 'Clinched' ? r.owner+' has clinched a playoff spot.' : r.status === 'Eliminated' ? r.owner+' is eliminated from playoff contention.' : guaranteed ? (guaranteed.extra_wins === 0 ? 'A playoff spot is guaranteed.' : guaranteed.extra_wins+' more '+(guaranteed.extra_wins === 1 ? 'win guarantees' : 'wins guarantee')+' '+r.owner+' a playoff spot. Fewer may be enough with help.') : 'A guaranteed win target is not available. Other results and PF may still matter.';
    $('clinch-context').textContent = 'This win target starts from the current standings, before any of your picks. It guarantees a spot regardless of other results or future PF; it is not the minimum wins needed.';
    $('scenario-proof').hidden = !count;
    $('scenario-proof').textContent = proof.status.startsWith('Clinched') ? 'With these picks, '+r.owner+' is guaranteed a playoff spot.' : proof.status.startsWith('Eliminated') ? 'With these picks, '+r.owner+' cannot make the playoffs.' : s.probability > 0 && s.probability < 1 ? 'These picks leave the spot undecided. Other results and PF can still matter.' : s.probability === 1 ? 'Every simulation puts '+r.owner+' in, but these picks do not establish a guaranteed spot.' : 'No playoff finishes appeared in this simulation. That is not a confirmed elimination.';
    $('scenario-range').textContent = count ? 'With your picks, the quick check can narrow the finish only to '+proof.best+'–'+proof.worst+'. It may take a more detailed calculation to narrow it further.' : 'With '+p.remaining_schedule.length+' weeks left, several combinations of results can change the outcome. Specific clinching combinations are not calculated in this version.';

    $('team-schedule').replaceChildren();
    for (const w of p.remaining_schedule) {
      const pair = w.games.find(g => g.includes(id)), key = w.week+':'+pair.join(':'), j = bank.games.findIndex(x => x.key === key), other = pair.find(x => x !== id);
      const comparison = s.matchups[j], isA = comparison.a === ids.indexOf(id), winN = isA ? comparison.aN : comparison.bN, loseN = isA ? comparison.bN : comparison.aN;
      row($('team-schedule'),['Week '+w.week,name(other),picks[key] ? name(picks[key])+' picked' : pct(winN/bank.trials),winN >= 300 ? pct(isA ? comparison.pa : comparison.pb) : '—',loseN >= 300 ? pct(isA ? comparison.pb : comparison.pa) : '—']);
    }
    $('seed-bars').replaceChildren();
    (count ? s.seeds : r.seed_pct.map(x => x/100)).forEach((prob,i) => {
      const wrapper = el('div'), bar = el('progress'); bar.max = 1; bar.value = prob; bar.setAttribute('aria-label','Seed '+(i+1));
      wrapper.append(el('span',(i+1)+': '+pct(prob)),bar); $('seed-bars').append(wrapper);
    });
    $('finish-paths').replaceChildren();
    for (const bin of s.byWins) {
      const path = r.finish_paths.find(x => x.total_wins === bin.wins);
      const chance = bin.n < 300 ? 'Too few samples' : pct(bin.made/bin.n)+' (±'+(100*1.96*Math.sqrt((bin.made/bin.n)*(1-bin.made/bin.n)/bin.n)).toFixed(1)+' pts)';
      row($('finish-paths'),[String(bin.wins),chance,bin.n.toLocaleString(),path?.guaranteed ? 'Guaranteed spot' : path?.ruled_out ? 'Not enough' : 'May need help / PF']);
    }
    const week = $('root-week').value, roots = s.rooting.filter(g => week === 'all' || g.week === Number(week));
    $('rooting-list').replaceChildren();
    if (!roots.length) $('rooting-list').append(el('p','No other unpicked games this week. Choose another week or clear your picks.'));
    roots.forEach(g => $('rooting-list').append(rootCard(g)));
  }
  async function update() {
    if (!$('playoff-team').value) return;
    clearTimeout(timer);
    const ticket = ++version, selected = {...picks}; computing = true;
    $('team-outlook').hidden = true; $('team-cards').replaceChildren();
    $('scenario-status').hidden = false; $('scenario-status').textContent = 'Updating outlook…'; $('scenario-run').hidden = true;
    try {
      if (!baseline) baseline = await api.simulate(p,{},20000, () => ticket !== version);
      if (ticket !== version) return;
      bank = Object.keys(selected).length ? await api.simulate(p,selected,20000, () => ticket !== version) : baseline;
      if (ticket !== version) return;
      dirty = false; computing = false; $('scenario-status').hidden = true; render();
    } catch (error) {
      if (ticket === version) { computing = false; $('scenario-status').textContent = 'Could not update. '+error.message; $('scenario-run').hidden = false; }
    }
  }
  function selectTeam() {
    const id = $('playoff-team').value;
    $('team-explorer').hidden = !id; $('team-prompt').hidden = !!id;
    if (!id) { version++; clearTimeout(timer); computing = false; return; }
    $('team-heading').textContent = name(id)+'’s outlook';
    if (!bank || dirty) update(); else if (!computing) render();
  }
  $('scenario-run').addEventListener('click',update);
  $('playoff-team').addEventListener('change',selectTeam);
  $('root-week').addEventListener('change',render);
  $('playoff-content').hidden = false;
  $('playoff-status').textContent = p.season+' · Through Week '+p.through_week;
})();
