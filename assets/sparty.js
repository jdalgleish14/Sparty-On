/* Reuses Ask Sparty's idle and wave frames without changing its question flow. */
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function mount(root = document) {
  for (const button of root.querySelectorAll('.sparty-peek')) {
    const sprite = button.querySelector('.sparty-peek-sprite');
    if (!sprite || button.dataset.spartyMounted) continue;
    button.dataset.spartyMounted = 'true';
    let animation = 0, reset = 0, frame = 0, waving = false, visible = false;
    const champion = button.classList.contains('sparty-champion');
    const draw = () => { sprite.style.backgroundPosition = `-${frame * 96}px -${(waving ? (champion ? 4 : 3) : 0) * 104}px`; };
    const stop = () => { clearInterval(animation); animation = 0; };
    const idle = () => { clearTimeout(reset); reset = 0; waving = false; frame = 0; draw(); restart(); };
    function restart() {
      stop();
      if (document.hidden || !visible || reduceMotion.matches) return;
      animation = setInterval(() => {
        frame = (frame + 1) % (waving ? (champion ? 5 : 4) : 7);
        draw();
      }, 240);
    }
    button.addEventListener('click', () => {
      if (reduceMotion.matches) return;
      clearTimeout(reset);
      waving = true; frame = 0; draw(); restart();
      reset = setTimeout(idle, 1900);
    });
    document.addEventListener('visibilitychange', restart);
    reduceMotion.addEventListener('change', () => { if (reduceMotion.matches) idle(); else restart(); });
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        restart();
      });
      observer.observe(button);
    } else { visible = true; restart(); }
    draw();
  }
  }
  window.SpartyMascot = {mount};
  mount();
})();
