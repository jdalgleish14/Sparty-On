/* Load published data in order, then watch for new verified snapshots. */
(() => {
  'use strict';
  const onlineSite = /^https?:$/.test(location.protocol);
  const interval = 5 * 60 * 1000;
  const scrollKey = 'sparty-update-scroll';
  let checking = false, lastCheck = 0, reloading = false;

  async function manifest() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('site-data/manifest.json', {
        cache: 'no-store', signal: controller.signal
      });
      if (!response.ok) throw new Error('Snapshot unavailable');
      const value = await response.json();
      if (typeof value.generated_at_utc !== 'string' ||
          !value.files?.['games.json']?.sha256) throw new Error('Invalid snapshot');
      return value;
    } finally { clearTimeout(timeout); }
  }

  function restoreScroll() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(scrollKey) || 'null');
      sessionStorage.removeItem(scrollKey);
      if (saved && saved.path === location.pathname && Date.now() - saved.at < 60000) {
        requestAnimationFrame(() => requestAnimationFrame(() => scrollTo(saved.x, saved.y)));
      }
    } catch (_) { /* Storage may be disabled. */ }
  }

  async function check() {
    if (!onlineSite || document.hidden || checking || reloading || Date.now() - lastCheck < 30000) return;
    checking = true;
    lastCheck = Date.now();
    try {
      const latest = await manifest();
      const loaded = window.SPARTY_ON_DATA?.league?.generated_at_utc;
      if (!loaded || latest.generated_at_utc === loaded) return;
      const url = new URL(location.href);
      // A deployment in progress must not cause a repeated reload loop.
      if (url.searchParams.get('_sparty_version') === latest.generated_at_utc) return;
      url.searchParams.set('_sparty_version', latest.generated_at_utc);
      try {
        sessionStorage.setItem(scrollKey, JSON.stringify({
          path: location.pathname, x: scrollX, y: scrollY, at: Date.now()
        }));
      } catch (_) { /* Updates still work without storage. */ }
      reloading = true;
      location.replace(url.href);
    } catch (_) { /* Keep the working snapshot when offline or a request fails. */ }
    finally { checking = false; }
  }

  async function start() {
    let version = String(Date.now());
    if (onlineSite) {
      try { version = (await manifest()).generated_at_utc; }
      catch (_) { /* A unique data URL still avoids a stale browser cache. */ }
    }
    // async=false keeps the original execution order while downloads run in parallel.
    const scripts = [...document.querySelectorAll('script[data-sparty-src]')];
    await Promise.all(scripts.map(original => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const url = new URL(original.dataset.spartySrc, location.href);
      if (onlineSite && url.pathname.includes('/site-data/')) url.searchParams.set('snapshot', version);
      script.async = false;
      script.src = url.href;
      script.onload = resolve;
      script.onerror = reject;
      original.replaceWith(script);
    })));
    restoreScroll();
    if (!onlineSite) return;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    window.addEventListener('pageshow', check);
    window.addEventListener('online', check);
    setInterval(check, interval);
    check();
  }
  start().catch(() => {
    const status = document.getElementById('load-status') || document.getElementById('ticker-status');
    if (status) status.textContent = 'Unable to load league data. Please refresh to try again.';
  });
})();
