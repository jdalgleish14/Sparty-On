/* Shared mascot; trophy sequence retains the exact original idle sprite. */
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function mount(root = document) {
    for (const button of root.querySelectorAll('.sparty-peek')) {
      const sprite = button.querySelector('.sparty-peek-sprite');
      if (!sprite || button.dataset.spartyMounted) continue;
      button.dataset.spartyMounted = 'true';
      const champion = button.classList.contains('sparty-champion');
      let interval = 0, timeout = 0, frame = 0, row = 0, active = false, visible = false;
      const draw = () => { sprite.style.backgroundPosition = champion && active
        ? `-${frame * 77}px 0`
        : `-${frame * 96}px -${row * 104}px`; };
      const stop = () => { clearInterval(interval); clearTimeout(timeout); interval = timeout = 0; };
      const idle = () => { stop(); active = false; frame = row = 0; button.classList.remove('is-trophy'); draw(); restart(); };
      function restart() {
        clearInterval(interval); interval = 0;
        if (document.hidden || !visible || reduceMotion.matches || active || !button.isConnected) return;
        interval = setInterval(() => { frame = (frame + 1) % 7; draw(); }, 240);
      }
      function trophy() {
        if (active) return;
        stop(); active = true; frame = 0; button.classList.add('is-trophy'); draw();
        if (reduceMotion.matches) { frame = 6; draw(); timeout = setTimeout(idle, 2200); return; }
        // Seven lift frames, a two-second overhead hold, then reverse to idle.
        const sequence = [1,2,3,4,5,6,7,6,5,4,3,2,1,0];
        let index = 0;
        function next() {
          if (document.hidden || !button.isConnected) { idle(); return; }
          frame = sequence[index++]; draw();
          if (index === 7) { timeout = setTimeout(next, 2100); return; }
          timeout = setTimeout(index < sequence.length ? next : idle, index <= 7 ? 170 : 190);
        }
        timeout = setTimeout(next, 170);
      }
      button.addEventListener('click', () => {
        if (champion) { trophy(); return; }
        if (reduceMotion.matches) return;
        idle(); active = true; row = 3; draw();
        interval = setInterval(() => { frame = (frame + 1) % 4; draw(); }, 240);
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
