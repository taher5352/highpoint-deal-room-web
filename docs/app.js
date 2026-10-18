'use strict';
const navigation=[...document.querySelectorAll('nav a[href^="#"]')].map(link=>({link,target:document.getElementById(link.getAttribute('href').slice(1))})).filter(item=>item.target);
function activateNavigation(active){navigation.forEach(item=>{const selected=item===active;item.link.classList.toggle('active',selected);if(selected)item.link.setAttribute('aria-current','location');else item.link.removeAttribute('aria-current');});}
function navigationFromScroll(){
 if(!navigation.length)return;
 const viewport=window.innerHeight||document.documentElement.clientHeight,readingLine=Math.min(180,viewport*.25);
 let active=navigation[0];
 for(const item of navigation){const bounds=item.target.getBoundingClientRect();if(bounds.height>0&&bounds.top<=readingLine)active=item;}
 // Short final sections cannot always reach the reading line before scrolling ends.
 if(document.documentElement.scrollHeight>viewport+2&&window.scrollY+viewport>=document.documentElement.scrollHeight-2)active=navigation[navigation.length-1];
 activateNavigation(active);
}
let navigationFrame=0;
function queueNavigation(){if(!navigationFrame)navigationFrame=requestAnimationFrame(()=>{navigationFrame=0;navigationFromScroll();});}
function syncNavigation(){const item=navigation.find(item=>item.link.getAttribute('href')===(location.hash||'#overview'));if(item)activateNavigation(item);queueNavigation();}
navigation.forEach(item=>item.link.addEventListener('click',()=>{activateNavigation(item);queueNavigation();}));
window.addEventListener('hashchange',syncNavigation);
window.addEventListener('scroll',queueNavigation,{passive:true});
window.addEventListener('resize',queueNavigation);
window.addEventListener('load',queueNavigation);
if(typeof ResizeObserver!=='undefined'){const navigationResize=new ResizeObserver(queueNavigation);navigation.forEach(item=>navigationResize.observe(item.target));}
syncNavigation();
function watchInitialAnchor(){
 const initialHash=location.hash;
 const anchorHash=initialHash||(new URLSearchParams(location.search).has('estimate')?'#renovation':'');
 let target;try{target=anchorHash&&document.getElementById(decodeURIComponent(anchorHash.slice(1)));}catch{}
 if(!target)return()=>{};
 const required=new Set();
 if(document.getElementById('public-records'))required.add('records');
 if(document.getElementById('renovation'))required.add('renovation');
 const inputs=['wheel','touchstart','pointerdown','keydown'];
 let pending=true,queued=false;
 function cancel(){pending=false;inputs.forEach(type=>window.removeEventListener(type,cancel,true));window.removeEventListener('hashchange',cancel);document.removeEventListener('highpoint:initial-render',rendered);}
 function ready(part){
  if(!pending)return;required.delete(part);
  if(required.size||queued)return;queued=true;
  // Let both tables finish layout and the browser's original anchor jump settle.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
   if(!pending||location.hash!==initialHash)return;
   cancel();target.scrollIntoView({block:'start',behavior:'auto'});queueNavigation();
  }));
 }
 function rendered(event){ready(event.detail?.section);}
 inputs.forEach(type=>window.addEventListener(type,cancel,{capture:true,passive:true}));
 window.addEventListener('hashchange',cancel);
 document.addEventListener('highpoint:initial-render',rendered);
 return ready;
}
const initialNavigationReady=watchInitialAnchor();
