/* Site interface for the separate read-only Cloudflare question Worker. */
(() => {
  'use strict';
  const ENDPOINT = 'https://sparty.jdalgleish14.workers.dev/';
  const $ = id => document.getElementById(id);
  const form = $('ask-form'), input = $('ask-question'), button = $('ask-submit');
  const answer = $('ask-answer'), status = $('ask-status');
  const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
  const clear = element => { while (element.firstChild) element.firstChild.remove(); };
  const sprite = $('ask-mascot-sprite');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const poses = {idle:{row:0,frames:7},thinking:{row:8,frames:6},success:{row:3,frames:4},error:{row:6,frames:6}};
  let pose = 'idle', frame = 0, animation, resetPose;
  function drawMascot() {
    const {row} = poses[pose];
    sprite.style.backgroundPosition = `-${frame * 96}px -${row * 104}px`;
  }
  function startMascot() {
    clearInterval(animation);
    drawMascot();
    if (reduceMotion.matches || document.hidden) return;
    animation = setInterval(() => {
      frame = (frame + 1) % poses[pose].frames;
      drawMascot();
    }, pose === 'thinking' ? 310 : 240);
  }
  function setMascot(next, duration = 0) {
    window.SpartyAskEntrance?.finish(false);
    clearTimeout(resetPose);
    pose = next;
    frame = 0;
    startMascot();
    if (duration) resetPose = setTimeout(() => setMascot('idle'), duration);
  }
  document.addEventListener('visibilitychange', startMascot);
  reduceMotion.addEventListener('change', startMascot);
  startMascot();

  function renderTable(container, columns, rows, name) {
    clear(container);
    if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows) || !rows.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'ask-table-wrap';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', `${name}; swipe sideways to see every column`);
    const table = document.createElement('table');
    const head = document.createElement('thead'), headRow = document.createElement('tr');
    columns.forEach(column => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = String(column ?? '');
      headRow.append(th);
    });
    head.append(headRow);
    const body = document.createElement('tbody');
    rows.slice(0, 25).forEach(row => {
      if (!Array.isArray(row)) return;
      const tr = document.createElement('tr');
      columns.forEach((_, i) => {
        const td = document.createElement('td');
        td.textContent = String(row[i] ?? '—');
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(head, body);
    wrap.append(table);
    container.append(wrap);
  }

  function render(result) {
    $('answer-heading').textContent = String(result.title || 'Answer');
    $('ask-result').textContent = String(result.answer || 'No answer returned.');
    $('ask-speech').hidden = false;
    $('ask-intro').classList.add('has-answer');
    $('ask-scope').textContent = String(result.scope || '');
    renderTable($('ask-results-table'), result.columns, result.rows, 'League query results');
    const evidence = $('ask-evidence');
    clear(evidence);
    if (Array.isArray(result.evidence) && result.evidence.length) {
      const h = document.createElement('h3');
      h.className = 'ask-evidence-heading';
      h.textContent = 'Supporting records';
      evidence.append(h);
      const tableHost = document.createElement('div');
      evidence.append(tableHost);
      renderTable(tableHost, result.evidence_columns, result.evidence, 'Supporting source records');
    }
    const source = $('ask-source');
    clear(source);
    source.append(document.createTextNode(`Data cutoff: ${result.cutoff || 'published archive'} · ${result.source || 'Published league records'}`));
    if (typeof result.source_url === 'string' && /^https:\/\/jdalgleish14\.github\.io\/Sparty-On\/site-data\/[a-z_]+\.json$/.test(result.source_url)) {
      source.append(document.createTextNode(' · '));
      const link = document.createElement('a');
      link.href = result.source_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Full source file';
      source.append(link);
    }
    answer.hidden = false;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (question.length < 6 || question.length > 180) { setStatus('Enter a question between 6 and 180 characters.', true); return; }
    button.disabled = true;
    answer.hidden = true;
    $('ask-speech').hidden = true;
    $('ask-intro').classList.remove('has-answer');
    setMascot('thinking');
    setStatus('Checking the league records…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) {
        const isUnansweredQuestion = response.status === 400 && /^(?:I cannot verify|I can’t verify|I could not interpret|I couldn’t interpret|No published records|No matching|No qualifying|No championship|No consecutive weeks|No numeric values|No values were published|Those owners have no recorded|Name two owners|Please simplify|That filter could not be checked|I couldn’t identify the owners)/i.test(result.error || '');
        const message = isUnansweredQuestion
          ? "Don't ask stupid questions, try something different"
          : result.error || 'Could not check that question right now. Please try again shortly.';
        throw new Error(message);
      }
      render(result);
      setStatus('');
      setMascot('success', 1700);
    } catch (error) {
      setMascot('error', 1900);
      setStatus(error.name === 'AbortError' ? 'That question took too long. Please try again.' :
        error instanceof TypeError ? 'Could not reach the question service. Please try again shortly.' :
        error.message || 'Could not answer that question. Please try rephrasing it.', true);
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
    }
  });

  document.querySelectorAll('.ask-examples button').forEach(example => {
    example.addEventListener('click', () => {
      input.value = example.textContent.trim();
      form.requestSubmit();
    });
  });
})();
