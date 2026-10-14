/* Shared opt-in mascot. Champion choreography uses original sprite poses. */
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function mount(root = document) {
    for (const button of root.querySelectorAll('.sparty-peek')) {
      const sprite = button.querySelector('.sparty-peek-sprite');
      if (!sprite || button.dataset.spartyMounted) continue;
      button.dataset.spartyMounted = 'true';
      const champion = button.classList.contains('sparty-champion');
      const trophy = champion ? document.createElement('span') : null;
      if (trophy) { trophy.className = 'sparty-trophy'; trophy.setAttribute('aria-hidden','true'); button.append(trophy); }
      let interval = 0, timeout = 0, frame = 0, row = 0, active = false, visible = false;
      const draw = () => { sprite.style.backgroundPosition = `-${frame * 96}px -${row * 104}px`; };
      const stop = () => { clearInterval(interval); clearTimeout(timeout); interval = timeout = 0; };
      const idle = () => { stop(); frame = row = 0; active = false; if (trophy) trophy.style.bottom = '-46px'; draw(); restart(); };
      function restart() {
        clearInterval(interval); interval = 0;
        if (document.hidden || !visible || reduceMotion.matches || active || !button.isConnected) return;
        interval = setInterval(() => { frame = (frame + 1) % 7; draw(); }, 240);
      }
      function trophyRaise() {
        if (active) return;
        active = true; stop(); frame = 0; row = 0; draw();
        if (reduceMotion.matches) {
          row = 4; frame = 2; draw(); trophy.style.bottom = '78px';
          timeout = setTimeout(idle, 2200); return;
        }
        // Source rows: idle 0, bend 5, raised arms 4. Descent retraces the lift.
        const poses = [
          [0,0,-46,180],[5,0,-46,200],[5,2,-30,190],[5,3,-15,200],
          [0,0,8,200],[4,1,35,210],[4,2,78,220],
          [4,3,78,2200],[4,2,78,190],[4,1,35,200],
          [0,0,8,200],[5,3,-15,190],[5,2,-30,190],[5,0,-46,200],
          [0,0,-46,170]
        ];
        let index = 0;
        const next = () => {
          if (document.hidden || !button.isConnected) { idle(); return; }
          const [nextRow,nextFrame,height,duration] = poses[index++];
          row = nextRow; frame = nextFrame; draw(); trophy.style.bottom = `${height}px`;
          timeout = setTimeout(index < poses.length ? next : idle, duration);
        };
        next();
      }
      button.addEventListener('click', () => {
        if (champion) { trophyRaise(); return; }
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
