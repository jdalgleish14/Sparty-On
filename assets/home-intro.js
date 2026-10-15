/* Approved homepage intro; draws over the real hero without changing its layout. */
(() => {
  'use strict';
  const hero=document.querySelector('.landing-hero');
  const on=hero?.querySelector('#page-title span');
  const tagline=hero?.querySelector('.landing-tagline');
  if (!hero || !on || !tagline) return;
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas=document.createElement('canvas');
  canvas.className='home-intro-canvas';
  canvas.setAttribute('aria-hidden','true');
  hero.append(canvas);
  const tap=document.createElement('button');
  tap.className='home-intro-tap';
  tap.type='button';
  tap.setAttribute('aria-label','Wave to Sparty');
  tap.hidden=true;
  hero.append(tap);
  const dialogue=window.SpartyDialogue?.mountHome(tap);
  const c=canvas.getContext('2d',{alpha:true});
  if (!c) { canvas.remove();tap.remove();return; }
  const sprites=new Image(),foe=new Image();
  sprites.src='assets/sparty-v2-spritesheet.png';
  foe.src='assets/sparty-home-wolverine.png';
  let pixelRatio=1,scale=1,originX=0,originY=0,idleShift=0;
  let request=0,idleTimer=0,waveTimer=0,bubbleTimer=0,bubbleUntil=0,started=0,lastFrame=-Infinity,phase='waiting',visible=true;
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};
  const lerp=(a,b,t)=>a+(b-a)*t;
  function measure(){
    const heroRect=hero.getBoundingClientRect(),onRect=on.getBoundingClientRect();
    const taglineTop=tagline.getBoundingClientRect().top-heroRect.top;
    pixelRatio=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.round(heroRect.width*pixelRatio));
    canvas.height=Math.max(1,Math.round(heroRect.height*pixelRatio));
    const onLeft=onRect.left-heroRect.left;
    // Preserve the approved mobile proportions, leaving room to the right
    // for the entire final idle sprite on narrower phones.
    scale=Math.max(.4,Math.min(onRect.width/59,(heroRect.width-onLeft-4)/127,
      (heroRect.width-onLeft-onRect.width-2)/58,(taglineTop-12)/126));
    originX=onLeft-260*scale+(heroRect.width<=700?4:0);
    const titleTop=onRect.top-heroRect.top;
    // The upright flag extends above the pole attachment; keep its fabric in view.
    const showFlag=Math.max(0,(heroRect.width<=700?2:8)-(titleTop-72*scale));
    const roomBelow=Math.max(0,taglineTop-4-(titleTop+62*scale));
    originY=titleTop-319*scale+Math.min(showFlag,roomBelow);
    idleShift=Math.max(0,(onLeft+onRect.width+2-(originX+329*scale))/scale);
    tap.style.left=`${Math.min(heroRect.width-44,originX+(329+idleShift)*scale)}px`;
    tap.style.top=`${originY+318*scale}px`;
    tap.style.width=`${Math.max(44,59*scale)}px`;
    tap.style.height=`${Math.max(44,63*scale)}px`;
    if (phase==='idle' || reduceMotion.matches) frame(8400);
  }
  function sparty(row,frame,x,y){
    c.imageSmoothingEnabled=false;
    const scale=.305,cellW=192*scale,cellH=208*scale;
    c.drawImage(sprites,frame*192,row*208,192,208,Math.round(x-12),Math.round(y-2),cellW,cellH);
  }
  function plantedSparty(x,y,lean){
    // Keep both feet fixed. Shift only the original upper-body pixels into the thrust.
    const sx=0,sy=208,scale=.305,dx=Math.round(x-12),dy=Math.round(y-2);
    c.imageSmoothingEnabled=false;
    c.drawImage(sprites,sx,sy+148,192,60,dx,dy+148*scale,192*scale,60*scale);
    // Omit only the original forward fist, then replace it with that same fist farther out.
    c.drawImage(sprites,sx,sy,192,139,dx+lean*6,dy-lean*2,192*scale,139*scale);
    c.drawImage(sprites,sx,sy+139,132,26,dx+lean*6,dy-lean*2+139*scale,132*scale,26*scale);
  }
  // The same shaft rotates: flag stays on its TOP, bare BOTTOM leads the thrust.
  function pole(hx,hy,angle,attached,t,topDistance=74){
    const dx=Math.cos(angle),dy=Math.sin(angle);
    // Same 112px pole throughout; Sparty slides his grip toward the flag
    // as he braces, leaving a longer bare end for the thrust.
    const topX=hx-topDistance*dx,topY=hy-topDistance*dy;
    const baseX=hx+(112-topDistance)*dx,baseY=hy+(112-topDistance)*dy;
    c.lineCap='butt';c.strokeStyle='#18201a';c.lineWidth=6;
    c.beginPath();c.moveTo(topX,topY);c.lineTo(baseX-5*dx,baseY-5*dy);c.stroke();
    c.strokeStyle='#ac7d3b';c.lineWidth=4;c.beginPath();c.moveTo(topX,topY);c.lineTo(baseX-5*dx,baseY-5*dy);c.stroke();
    // Shape the bottom of this same wooden flagpole into a short pointed end.
    c.fillStyle='#18201a';c.beginPath();c.moveTo(baseX-7*dx-3*dy,baseY-7*dy+3*dx);
    c.lineTo(baseX,baseY);c.lineTo(baseX-7*dx+3*dy,baseY-7*dy-3*dx);c.closePath();c.fill();
    c.fillStyle='#d7b571';c.beginPath();c.moveTo(baseX-6*dx-1.5*dy,baseY-6*dy+1.5*dx);
    c.lineTo(baseX-1*dx,baseY-1*dy);c.lineTo(baseX-6*dx+1.5*dy,baseY-6*dy-1.5*dx);c.closePath();c.fill();
    // Rotate the entire fixed-size rectangular flag with the same shaft.
    c.save();c.translate(topX,topY);c.rotate(angle);
    c.fillStyle='#124e35';c.strokeStyle='#08271c';c.lineWidth=2;
    c.fillRect(0,0,23,43);c.strokeRect(0,0,23,43);
    // A subtle fabric ripple stays inside the rectangle. The S does not move.
    const wave=Math.sin(t*18)*2;
    c.save();c.beginPath();c.rect(0,0,23,43);c.clip();
    c.fillStyle='rgba(255,255,255,.1)';c.beginPath();
    c.moveTo(4+wave,0);c.lineTo(8+wave,0);
    c.lineTo(10+wave,43);c.lineTo(6+wave,43);c.closePath();c.fill();c.restore();
    c.translate(11.5,21.5);c.rotate(-Math.PI/2);
    // The supplied MSU block S, traced as a single flat pixel-style silhouette.
    c.fillStyle='#fff';c.scale(15/138,19/187);c.translate(-107,-120);
    c.beginPath();c.moveTo(62,27);c.lineTo(152,27);c.lineTo(176,50);
    c.lineTo(176,82);c.lineTo(133,82);c.lineTo(133,67);c.lineTo(83,67);
    c.lineTo(83,99);c.lineTo(133,99);c.lineTo(176,142);c.lineTo(176,191);
    c.lineTo(152,214);c.lineTo(61,214);c.lineTo(38,190);c.lineTo(38,162);
    c.lineTo(82,162);c.lineTo(82,176);c.lineTo(132,176);c.lineTo(132,141);
    c.lineTo(83,141);c.lineTo(38,98);c.lineTo(38,50);c.closePath();c.fill();c.restore();
    // Draw the whole character above the entering end: his opaque body hides
    // the inserted part of the pole, while the shaft stays visible outside him.
    if(attached)wolverine(baseX-28,baseY-30);
  }
  function wolverine(x,y,k=1){
    c.imageSmoothingEnabled=false;
    c.drawImage(foe,Math.round(x),Math.round(y),44*k,50*k);
  }
  function thrustArm(x,extension,handY){
    // Slide an unchanged crop of Sparty's real shoulder, bracer, and fist.
    // A short pixel-stepped green sleeve joins it to the planted torso;
    // the skin and hand are never redrawn or scaled to reach the pole.
    const left=Math.round(x+20+extension),top=Math.round(handY-5);
    const shoulder=Math.round(x+21),join=Math.round(left+2);
    for(let sx=shoulder;sx<join;sx+=2){
      const sy=Math.round(339+(top+5-339)*(sx-shoulder)/Math.max(1,join-shoulder));
      c.fillStyle='#122a20';c.fillRect(sx,sy-3,3,6);
      c.fillStyle='#246f4a';c.fillRect(sx,sy-2,2,4);
    }
    c.imageSmoothingEnabled=false;
    c.drawImage(sprites,128,208+130,39,36,left,top,39*.305,36*.305);
  }
  function impact(){
    // A tiny harmless contact flash helps the thrust register on mobile.
    c.strokeStyle='#f3c34e';c.lineWidth=2;c.lineCap='square';
    for(const [x1,y1,x2,y2] of [[306,294,310,289],[308,302,314,301],[304,311,306,316]]){
      c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();
    }
  }
  function bubble(){
    c.fillStyle='#fff';c.strokeStyle='#192820';c.lineWidth=2;
    c.beginPath();c.roundRect(305,276,87,29,6);c.fill();c.stroke();
    c.beginPath();c.moveTo(346,304);c.lineTo(355,315);c.lineTo(357,304);c.fill();c.stroke();
    c.fillStyle='#122218';c.font='bold 14px Arial';c.fillText('Go Green!',314,295);
  }
  function frame(ms,waveFrame=-1){
    c.setTransform(1,0,0,1,0,0);
    c.clearRect(0,0,canvas.width,canvas.height);
    c.setTransform(pixelRatio*scale,0,0,pixelRatio*scale,originX*pixelRatio,originY*pixelRatio);
    if(reduceMotion.matches){sparty(0,0,341+idleShift,320);if(bubbleUntil>performance.now())bubble();return}
    let t=ms/1000;
    if(t<3.34){
      const bob=t<.5?Math.sin(t*8)*1:0;
      wolverine(268,264+bob);
    }
    if(t<.65)return;
    if(t<2.42){
      const q=ease((t-.65)/1.77),x=lerp(-54,222,q),y=301+Math.sin(t*15)*2;
      pole(x+31,344,Math.PI/2,false,t);sparty(1,Math.floor(t*10)%8,x,y);return;
    }
    if(t<2.98){
      const q=ease((t-2.42)/.56);
      pole(lerp(252,242,q),lerp(344,338,q),lerp(Math.PI/2,-.9,q),false,t,lerp(74,60,q));
      plantedSparty(222,301,0);thrustArm(222,0,lerp(340,339,q));return;
    }
    if(t<3.42){
      const q=ease((t-2.98)/.44),extension=10*q;
      pole(242+16*q+extension,338-4*q,-.9,q>.92,t,60);
      plantedSparty(222,301,q);thrustArm(222+6*q,extension,lerp(339,335,q));
      if(! (q>.92) && t>=3.12)wolverine(268,264);
      return;
    }
    if(t<3.78){
      const q=ease((t-3.42)/.36),lean=lerp(1,.35,q),extension=lerp(10,4,q);
      pole(252+6*lean+extension,338-4*lean,-.9,true,t,60);
      plantedSparty(222,301,lean);thrustArm(222+6*lean,extension,lerp(335,339,q));
      return;
    }
    if(t<4.08){
      const q=ease((t-3.78)/.30);
      pole(260-8*q,334+4*q,-.9,true,t,60);
      plantedSparty(222,301,-.15*q);thrustArm(222-2*q,4,339);return;
    }
    if(t<4.36){
      const q=ease((t-4.08)/.28);
      // Feet plant; torso and original-pixel arm drive the SAME pole forward.
      pole(252+16*q,338-8*q,lerp(-.9,-.35,q),true,t,60);
      plantedSparty(222,301,1.1*q);thrustArm(222+6*q,10*q,lerp(339,331,q));return;
    }
    if(t<4.88){
      const q=ease((t-4.36)/.52);
      pole(268+q*330,330-q*42,-.35,true,t,60);
      // Follow-through in Sparty's original forward-running sprite poses.
      sparty(1,Math.min(6,4+Math.floor(q*3)),222,301);return;
    }
    if(t<5.58){
      const q=(t-4.88)/.70;
      sparty(4,q<.13?0:q<.28?1:q<.55?2:q<.80?3:4,222,301);return;
    }
    if(t<6.30){const q=ease((t-5.58)/.72);sparty(1,Math.floor(t*12)%8,lerp(222,341+idleShift,q),lerp(301,320,q));return}
    sparty(waveFrame>=0?3:0,waveFrame>=0?waveFrame:Math.floor((t-6.30)*4)%7,341+idleShift,320);
    if((phase==='playing' && t>6.82 && t<9.82) || bubbleUntil>performance.now())bubble();
  }

  function stop(){
    cancelAnimationFrame(request);clearInterval(idleTimer);clearInterval(waveTimer);
    request=idleTimer=waveTimer=0;
  }
  function idle(){
    stop();phase='idle';frame(8400);
    tap.hidden=false;
    if (reduceMotion.matches || document.hidden || !visible) return;
    let idleFrame=0;
    idleTimer=setInterval(()=>{
      if (!document.hidden && visible && !reduceMotion.matches) {
        idleFrame=(idleFrame+1)%7;
        frame(7050+idleFrame*250);
      }
    },250);
  }
  function animate(now){
    if (phase!=='playing') return;
    const elapsed=Math.min(now-started,8400);
    if (now-lastFrame>=38 || elapsed===8400) {
      frame(elapsed);lastFrame=now;
    }
    if (elapsed===8400) { bubbleUntil=now+1420;idle(); }
    else request=requestAnimationFrame(animate);
  }
  function begin(){
    if (phase!=='waiting' || !visible || document.hidden) return;
    try {
      if (sessionStorage.getItem('sparty-home-intro-seen-v1')) { idle();return; }
      sessionStorage.setItem('sparty-home-intro-seen-v1','1');
    } catch (_) { /* Private browsing still gets an intro. */ }
    phase='playing';started=performance.now();lastFrame=-Infinity;
    tap.hidden=true;
    request=requestAnimationFrame(animate);
  }
  tap.addEventListener('click',()=>{
    if (phase!=='idle' && phase!=='waving') return;
    if (dialogue) {
      bubbleUntil=0;
      clearTimeout(bubbleTimer);
      if (phase==='waving') return;
    }
    bubbleUntil=dialogue?0:performance.now()+3000;
    clearTimeout(bubbleTimer);
    bubbleTimer=setTimeout(()=>{if(phase==='idle')frame(8400)},3050);
    if (reduceMotion.matches) {frame(8400);return;}
    stop();phase='waving';tap.hidden=false;
    let count=0;
    frame(8400,0);
    waveTimer=setInterval(()=>{
      count++;
      if (count>=8) idle();
      else frame(8400,count%4);
    },240);
  });
  Promise.all([sprites.decode(),foe.decode()]).then(()=>{
    measure();
    if (reduceMotion.matches) { idle();return; }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries=>{
        visible=entries[0].isIntersecting;
        if (visible) {
          if (phase==='waiting') begin();
          else if (phase==='idle') idle();
        } else if (phase==='idle') {clearInterval(idleTimer);idleTimer=0;}
      },{threshold:.1}).observe(hero);
    } else begin();
  }).catch(()=>{canvas.remove();tap.remove();});
  window.addEventListener('resize',()=>{if(phase!=='waiting')measure();},{passive:true});
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) {if(phase==='playing' || phase==='waving')idle();else stop();}
    else if (phase==='waiting')begin();
    else if (phase==='idle')idle();
  });
  reduceMotion.addEventListener('change',()=>{
    if (reduceMotion.matches) idle();
    else if (phase==='waiting') begin();
    else if (phase==='idle') idle();
  });
})();
