/* Small reusable mascot controller. No league calculations or dialogue live here. */
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  for (const button of document.querySelectorAll('.sparty-peek')) {
    const sprite = button.querySelector('.sparty-peek-sprite');
    if (!sprite) continue;
    let timer = 0, reset = 0, frame = 0;
    const draw = () => { sprite.style.backgroundPosition = `-${frame * 96}px -${button.classList.contains('is-waving') ? 3 * 104 : 0}px`; };
    const stop = () => { clearInterval(timer); clearTimeout(reset); timer = reset = 0; };
    const idle = () => { stop(); button.classList.remove('is-waving'); frame = 0; draw(); };
    button.addEventListener('click', () => {
      idle();
      if (reduceMotion.matches) return;
      button.classList.add('is-waving');
      draw();
      timer = setInterval(() => { frame = (frame + 1) % 4; draw(); }, 240);
      reset = setTimeout(idle, 1900);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) idle(); });
    reduceMotion.addEventListener('change', () => { if (reduceMotion.matches) idle(); });
    draw();
  }
})();
