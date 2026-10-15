/* Approved Records entrance; visual overlay hands back to the existing mascot and dialogue. */
(() => {
  'use strict';
  const card=document.querySelector('.record-intro');
  const button=card?.querySelector('.sparty-peek');
  if (!card || !button || document.getElementById('records-page')?.hidden) return;
  const state={active:false,onFinish:null};
  window.SpartyRecordsEntrance=state;
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  let seen=false;
  try { seen=!!sessionStorage.getItem('sparty-records-intro-seen-v1'); } catch (_) { /* Private mode may disable storage. */ }
  if (seen || reduce.matches) return;
  const canvas=document.createElement('canvas');
  canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText='position:absolute;left:0;top:-125px;width:100%;height:245px;z-index:0;pointer-events:none';
  const g=canvas.getContext('2d');
  if (!g) return;
  const sprite=new Image();
  sprite.src='assets/sparty-v2-spritesheet.png';
  state.active=true;
  let started=0,last=0,raf=0,running=false,finished=false,ratio=1,width=0;
  function size(){
    width=card.getBoundingClientRect().width;
    ratio=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(width*ratio);
    canvas.height=Math.round(245*ratio);
  }
function ease(v){v=Math.max(0,Math.min(1,v));return v*v*(3-2*v)}function line(x1,y1,x2,y2,w,col){g.strokeStyle=col;g.lineWidth=w;g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke()}function sparty(x,y,row,frame){g.imageSmoothingEnabled=false;g.drawImage(sprite,frame*192,row*208,192,208,x-2,y,62,67)}function bar(x1,y1,x2,y2,w){line(x1,y1,x2,y2,w+2,'#4b371e');line(x1,y1,x2,y2,w,'#d6a846');line(x1-1,y1-1,x2-1,y2-1,1,'#f6d88b')}
// The left upright is farther away. It is drawn before the football.
function goalFar(x,y,tilt=0){g.save();g.translate(x,y);g.rotate(tilt);bar(-37,-70,-37,-115,4);bar(-37,-70,0,-70,4);g.restore()}
// The right upright is closest to the viewer, so it covers the football as it crosses.
function goalNear(x,y,tilt=0){g.save();g.translate(x,y);g.rotate(tilt);bar(0,0,0,-38,6);bar(0,-38,0,-70,5);bar(0,-70,37,-70,4);bar(37,-70,37,-115,4);g.fillStyle='#15563d';g.fillRect(-9,-21,18,21);g.fillStyle='#e1bf76';g.fillRect(-7,-19,3,17);g.restore()}
function ball(x,y,a=0){g.save();g.translate(x,y);g.rotate(a);g.fillStyle='#28190f';g.beginPath();g.ellipse(0,0,10,6,0,0,7);g.fill();g.fillStyle='#87502a';g.beginPath();g.ellipse(0,0,8,5,0,0,7);g.fill();line(-4,0,4,0,1,'#f9eac6');for(let k=-2;k<=2;k+=2)line(k,-2,k,2,1,'#f9eac6');g.restore()}

  function paint(t){
    g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,canvas.width,canvas.height);
    g.setTransform(ratio,0,0,ratio,(width-360)*ratio,23*ratio);
    const push=ease((t-4.40)/1.16),gx=t<4.40?275:275+push*145,rot=t<4.40?0:push*.42;
    if(t<5.6)goalFar(gx,105,rot);
    if(t<1.72){line(172,105,172,96,3,'#caa36d');ball(172,91,-.28)}
    if(t>=1.72&&t<3.27){const q=(t-1.72)/1.55;ball(172+q*200,91-190*q+100*q*q,q*10)}
    if(t<5.6)goalNear(gx,105,rot);
    let x=286,row=0,f=0;
    if(t<1.42){x=-65+ease(t/1.42)*188;row=1;f=Math.floor(t*10)%8}
    else if(t<1.72){x=123;row=1;f=t<1.57?2:4}
    else if(t<2.05){x=123;row=1;f=t<1.92?4:5}
    else if(t<2.68){x=123;row=0;f=Math.floor(t*4)%7}
    else if(t<3.75){x=123;row=4;f=Math.min(4,Math.floor((t-2.68)*5))}
    else if(t<4.40){x=123+ease((t-3.75)/.65)*112;row=1;f=Math.floor(t*10)%8}
    else if(t<5.6){x=235+Math.round(push*145);row=1;f=push<.2?3:7}
    else if(t<6.72){x=380-ease((t-5.6)/1.12)*94;row=1;f=Math.floor(t*9)%8}
    sparty(x,47,row,f);
  }
  function finish(){
    if(finished)return;
    finished=true;running=false;cancelAnimationFrame(raf);
    canvas.remove();button.style.visibility='';button.style.pointerEvents='';
    state.active=false;
    state.onFinish?.();
  }
  function tick(now){
    if(!running)return;
    if(document.hidden || reduce.matches){finish();return}
    const t=(now-started)/1000;
    if(t>=6.72){finish();return}
    if(now-last>=33){paint(t);last=now}
    raf=requestAnimationFrame(tick);
  }
  function begin(){
    if(running || finished || document.hidden)return;
    if(reduce.matches){finish();return}
    try{sessionStorage.setItem('sparty-records-intro-seen-v1','1')}catch(_){}
    size();card.append(canvas);button.style.visibility='hidden';button.style.pointerEvents='none';
    running=true;started=performance.now();last=0;raf=requestAnimationFrame(tick);
  }
  sprite.decode().then(()=>{
    if(reduce.matches){finish();return}
    if('IntersectionObserver' in window){
      const observer=new IntersectionObserver(entries=>{
        if(entries.some(e=>e.isIntersecting)){observer.disconnect();begin()}
      },{threshold:.25});observer.observe(card);
    }else begin();
  }).catch(finish);
  window.addEventListener('resize',()=>{if(running)size()},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && running){finish()}});
  reduce.addEventListener('change',()=>{if(reduce.matches)finish()});
})();
