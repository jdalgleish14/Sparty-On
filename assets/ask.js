/* Site interface for the separate read-only Cloudflare question Worker. */
(() => {
  'use strict';
  const ENDPOINT = 'https://sparty.jdalgleish14.workers.dev/';
  const $ = id => document.getElementById(id);
  const form = $('ask-form'), input = $('ask-question'), button = $('ask-submit');
  const answer = $('ask-answer'), status = $('ask-status');
  const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
  const clear = element => { while (element.firstChild) element.firstChild.remove(); };

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
      if (!response.ok) throw new Error(result.error || 'No verified answer was available for that question.');
      render(result);
      setStatus('');
    } catch (error) {
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
