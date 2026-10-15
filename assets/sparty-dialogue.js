/* Local dialogue only. Champions never mounts this controller. */
(() => {
  'use strict';
  const HOME = [
    'Spartans Will', 'Fuck those Wolverines', 'Victory for MSU', 'MSU we love thy Shadows',
    'On the banks of the Red Cedar...', 'FTP', 'I miss Cassius Winston',
    'Remember Schubby? What a cunt', 'What do you think happens after you die?',
    "Rick's later?", 'I could use a beer', 'WOAH He has trouble with the snap',
    'Touchdown MSU', 'He got it! He got it!', 'Pride comes before the fall',
    'Did you just touch my dick?',
    'A Michigan fan walks into a bar, what does the bartender say? Get the fuck out!'
  ];
  function queue(items) {
    let bag = [], last;
    return () => {
      if (!bag.length) {
        bag = items.slice();
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
      last = bag.pop();
      return last;
    };
  }
  function attach(button, items, context = '', duration = 4000) {
    if (button.dataset.dialogueMounted) return;
    button.dataset.dialogueMounted = 'true';
    const bubble = document.createElement('div');
    bubble.className = 'sparty-dialogue';
    bubble.hidden = true;
    bubble.id = `sparty-dialogue-${button.classList.contains('home-intro-tap') ? 'home' : 'records'}`;
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    bubble.setAttribute('aria-atomic', 'true');
    const text = document.createElement('span'), note = document.createElement('small');
    bubble.append(text, note);
    document.body.append(bubble);
    button.setAttribute('aria-controls', bubble.id);
    button.setAttribute('aria-label', 'Tap Sparty for a saying');
    const next = queue(items);
    let timer = 0, expires = 0;
    function hide() { clearTimeout(timer); bubble.hidden = true; }
    function position() {
      if (bubble.hidden) return;
      const rect = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft || 0) + 8;
      const rightEdge = leftEdge + (viewport?.width || innerWidth) - 16;
      const topEdge = (viewport?.offsetTop || 0) + 8;
      const bottomEdge = topEdge + (viewport?.height || innerHeight) - 16;
      // Navigation remains unobscured; the bubble falls below the mascot when needed.
      const header = document.querySelector('.masthead')?.getBoundingClientRect();
      const safeTop = Math.max(topEdge, header && header.bottom > topEdge && header.top < bottomEdge ? header.bottom + 8 : topEdge);
      const box = bubble.getBoundingClientRect();
      const left = Math.max(leftEdge, Math.min(rightEdge - box.width, rect.left + rect.width/2 - box.width/2));
      let top = rect.top - box.height - 12;
      const below = top < safeTop;
      if (below) top = rect.bottom + 12;
      top = Math.max(safeTop, Math.min(bottomEdge - box.height, top));
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      bubble.style.setProperty('--sparty-pointer', `${Math.max(12, Math.min(box.width-20, rect.left+rect.width/2-left))}px`);
      bubble.classList.toggle('is-below', below);
    }
    function show(message, detail = context, displayMs = duration) {
      clearTimeout(timer);
      text.textContent = message;
      note.textContent = detail;
      note.hidden = !detail;
      bubble.hidden = false;
      expires = performance.now() + displayMs;
      position();
      timer = setTimeout(hide, displayMs);
    }
    button.addEventListener('click', () => show(next()));
    button.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden || performance.now() >= expires) hide(); });
    window.addEventListener('resize', position, {passive:true});
    window.addEventListener('scroll', () => {
      const rect = button.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) hide(); else position();
    }, {passive:true});
    window.visualViewport?.addEventListener('resize', position, {passive:true});
    return {show, hide};
  }
  // Same source identity as tools/sparty/generate.py; verifies input association only.
  function sourceCheck(site) {
    const cents = value => Math.round(value * 100);
    const values = [
      site.games.map(g => ['game_id','year','stage','week','round','owner_id','opponent_owner_id'].map(k => g[k]).concat([cents(g.points_for), cents(g.points_against)])),
      site.seasons.map(s => [s.year,s.status,s.team_count,s.regular_season_weeks,s.roster_owner_ids || []]),
      site.owners.map(o => [o.owner_id,o.owner_name]),
      site.championships.map(c => [c.year,c.champion_owner_id,c.runner_up_owner_id,cents(c.champion_score),cents(c.runner_up_score)])
    ];
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(JSON.stringify(values))) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return hash.toString(16).padStart(8, '0');
  }
  function mountHome(button) { return attach(button, HOME); }
  function mountRecords() {
    const button = document.querySelector('.record-intro .sparty-peek');
    if (!button || document.getElementById('records-page')?.hidden) return;
    const data = window.SPARTY_RECORDS, site = window.SPARTY_ON_DATA;
    let sayings = [], detail = '';
    try {
      if (data?.version !== '1.0.0' || !/^[a-f0-9]{64}$/.test(data.source_fingerprint) || !/^[a-f0-9]{8}$/.test(data.source_check) ||
          !Number.isInteger(data.cutoff.year) || !Number.isInteger(data.cutoff.week) || data.cutoff.week < 1 ||
          !Array.isArray(data.sayings) || !data.sayings.length || data.sayings.length > 200 ||
          new Set(data.sayings.map(r => r.id)).size !== data.sayings.length ||
          data.sayings.some(r => typeof r.text !== 'string' || !r.text.length || r.text.length > 310 || !r.evidence?.sources?.length || !Number.isFinite(r.evidence.value))) throw Error('Invalid dialogue');
      const matches = sourceCheck(site) === data.source_check && site.games.length === data.source_game_rows;
      // Always date facts. An older retained collection makes claims only as of its cutoff.
      detail = `${matches ? 'Through' : 'Historical snapshot ·'} ${data.cutoff.year} Week ${data.cutoff.week}`;
      sayings = data.sayings.map(r => r.text);
    } catch (_) {
      sayings = ['The record book is taking a breather. Explore the verified records below.'];
    }
    const controller = attach(button, sayings, detail, 6000);
    if (!controller) return;
    button.setAttribute('aria-label', 'Tap Sparty for a random league record');
    let introduced = false, interacted = false;
    button.addEventListener('click', () => { interacted = true; });
    // Future entrance animation can call intro() on completion instead of observing visibility.
    function intro() {
      if (introduced || interacted || document.hidden) return;
      introduced = true;
      controller.show('Tap me for a random stat', '', 4000);
    }
    window.SpartyDialogue.recordsIntro = intro;
    if (window.SpartyRecordsEntrance?.active) {
      window.SpartyRecordsEntrance.onFinish = intro;
    } else if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting) && !document.hidden) { intro(); observer.disconnect(); }
      }, {threshold:0.5});
      observer.observe(button);
    } else intro();
  }
  window.SpartyDialogue = {mountHome};
  mountRecords();
})();
