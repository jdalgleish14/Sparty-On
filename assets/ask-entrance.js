/* Approved Ask entrance. Reuses the original character sheet and pixel can. */
(() => {
 'use strict';
 const canvas=document.getElementById('ask-entrance');
 const idle=document.getElementById('ask-mascot-sprite');
 const trigger=document.getElementById('ask-mascot-trigger');
 const greeting=document.getElementById('ask-greeting');
 if(!canvas||!idle||!trigger||!greeting)return;
 const g=canvas.getContext('2d');
 if(!g)return;
 const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
 const sprite=new Image();
 const sessionKey='sparty:ask-arrival:v2';
 let start=0,request=0,active=false,bubbleTimer=0,cancelled=false;
 function showGreeting(){
   clearTimeout(bubbleTimer);greeting.hidden=false;
   bubbleTimer=setTimeout(()=>{greeting.hidden=true},4000);
 }
 function finish(greet=false){
   active=false;cancelAnimationFrame(request);canvas.hidden=true;idle.style.visibility='';
   if(greet)showGreeting();
   else{cancelled=true;clearTimeout(bubbleTimer);greeting.hidden=true}
 }
 function schedule(){if(active)request=requestAnimationFrame(draw)}
 function begin(){
   if(cancelled)return;
   let seen=false;
   try{seen=sessionStorage.getItem(sessionKey)==='1';sessionStorage.setItem(sessionKey,'1')}catch{}
   if(seen)return;
   if(reduce.matches){showGreeting();return}
   active=true;canvas.hidden=false;idle.style.visibility='hidden';start=performance.now();schedule();
 }
 window.SpartyAskEntrance={finish};
 trigger.addEventListener('click',()=>{if(!active)showGreeting()});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)finish(false)});
 reduce.addEventListener('change',()=>{if(reduce.matches&&active)finish(true)});
const ease=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v)};
function pose(x,y,row,frame){g.imageSmoothingEnabled=false;g.drawImage(sprite,frame*192,row*208,192,208,Math.round(x),Math.round(y),77,84)}
function can(x,y,angle=0,held=true){
 g.save();g.translate(Math.round(x),Math.round(y));g.rotate(angle);
 // Compact can on the sprite's pixel scale; fingertips sit over its near face.
 g.fillStyle='#203331';g.fillRect(-4,-7,8,14);
 g.fillStyle='#eeeade';g.fillRect(-3,-6,6,12);
 g.fillStyle='#b9bcb4';g.fillRect(-3,-7,6,1);
 g.fillStyle='#e0d9bf';g.fillRect(-3,5,6,1);
 g.fillStyle='#182d4a';g.fillRect(-2,-4,1,3);g.fillRect(-1,-2,3,1);g.fillRect(1,-4,1,2);
 g.fillStyle='#ba984d';g.fillRect(-2,0,4,3);
 g.fillStyle='#a84532';g.fillRect(-1,0,2,2);
 if(held){
   g.fillStyle='#293731';g.fillRect(-2,3,5,3);
   g.fillStyle='#f3b575';g.fillRect(-2,3,4,2);
   g.fillStyle='#cf8d53';g.fillRect(0,4,2,1);
 }
 g.restore()
}
function draw(now){
 const elapsed=(now-start)/1000,t=reduce.matches?5:elapsed;
 g.clearRect(0,0,360,190);
 const y=80;let x=267,row=0,frame=Math.floor(Math.max(0,t-4.45)*4)%7;
 if(t<1.35){
   x=392-ease(t/1.35)*125;row=2;frame=Math.floor(t*10)%7;
   pose(x,y,row,frame);
   can(x+[53,56,56,51,58,42,56][frame],y+[57,54,53,58,50,56,53][frame]);
   schedule();return;
 }
 if(t<1.75){
   pose(x,y,0,0);can(319,134);
   schedule();return;
 }
 if(t<2.45){
   const q=ease((t-1.75)/.7);row=7;frame=q<.45?0:1;
   pose(x,y,row,frame);can(319+2*q,134-7*q,-.9*q);
   schedule();return;
 }
 if(t<3.35){
   const sip=Math.round(Math.sin((t-2.45)*13));row=7;frame=1;
   pose(x,y+sip,row,frame);can(321,127+sip,-.9+Math.sin((t-2.45)*13)*.04);schedule();return;
 }
 if(t<3.65){
   row=3;frame=t<3.5?0:1;const q=ease((t-3.35)/.3);
   pose(x,y,row,frame);can(321+11*q,127-13*q,-.9+.9*q);
   schedule();return;
 }
 if(t<4.45){
   row=3;frame=t<3.95?2:3;pose(x,y,row,frame);
   const q=(t-3.65)/.8;can(332+q*82,114-69*Math.sin(q*Math.PI*.75),q*9,false);
   schedule();return;
 }
 finish(true);
}

 sprite.onload=begin;
 sprite.onerror=()=>finish(false);
 sprite.src='assets/sparty-v2-spritesheet.png';
})();
