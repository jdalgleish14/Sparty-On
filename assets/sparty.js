/* Shared, opt-in Sparty controls. Trophy frames use one scale from idle to return. */
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function mount(root = document) {
    for (const button of root.querySelectorAll('.sparty-peek')) {
      const sprite = button.querySelector('.sparty-peek-sprite');
      if (!sprite || button.dataset.spartyMounted) continue;
      button.dataset.spartyMounted = 'true';
      const champion = button.classList.contains('sparty-champion');
      let interval = 0, timeout = 0, frame = 0, active = false, visible = false;
      const draw = () => {
        sprite.style.backgroundPosition = champion
          ? `-${frame * 56}px 0`
          : `-${frame * 96}px -${active ? 3 * 104 : 0}px`;
      };
      const stop = () => { clearInterval(interval); clearTimeout(timeout); interval = timeout = 0; };
      const idle = () => { stop(); frame = 0; active = false; draw(); restart(); };
      function restart() {
        clearInterval(interval); interval = 0;
        if (champion || document.hidden || !visible || reduceMotion.matches || !button.isConnected) return;
        interval = setInterval(() => {
          frame = (frame + 1) % (active ? 4 : 7);
          draw();
        }, 240);
      }
      function trophy() {
        if (active) return;
        active = true; frame = 0; draw();
        if (reduceMotion.matches) {
          frame = 6; draw(); timeout = setTimeout(idle, 2100);
          return;
        }
        let step = 1;
        function advance() {
          if (document.hidden || !button.isConnected) { idle(); return; }
          frame = step <= 7 ? step : step <= 13 ? (step % 2 ? 7 : 6) : 20 - step;
          draw();
          if (step >= 20) { timeout = setTimeout(idle, 180); return; }
          const delay = step < 7 ? 165 : step < 13 ? 350 : 180;
          step++;
          timeout = setTimeout(advance, delay);
        }
        timeout = setTimeout(advance, 150);
      }
      button.addEventListener('click', () => {
        if (champion) { trophy(); return; }
        if (reduceMotion.matches) return;
        idle(); active = true; draw(); restart();
        timeout = setTimeout(idle, 1900);
      });
      document.addEventListener('visibilitychange', () => { if (document.hidden && active) idle(); else restart(); });
      reduceMotion.addEventListener('change', () => { if (reduceMotion.matches) idle(); else restart(); });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(entries => { visible = entries[0].isIntersecting; restart(); }).observe(button);
      } else { visible = true; restart(); }
      draw();
    }
  }
  window.SpartyMascot = {mount};
  mount();
})();
