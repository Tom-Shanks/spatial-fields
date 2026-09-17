'use client';
import { useEffect, useRef, useState } from 'react';
import strata from './data/strata.json';
import styles from './canopy.module.css';

const COLORS = ['#c57525', '#af5052', '#246450', '#ad913b', '#829983'];
const LABELS = ['Ash (EAB risk)', 'Elm (DED risk)', 'Conifer', 'Maple', 'Other deciduous'];
type Crown = { x:number; y:number; radius:number; cls:number; band:number };
type Mode = 'scroll'|'plan'|'strata';

export default function TreeField({compact=false}:{compact?:boolean}) {
  const stage=useRef<HTMLDivElement>(null), canvas=useRef<HTMLCanvasElement>(null);
  const setView=useRef<(mode:Mode)=>void>(()=>{});
  const resetView=useRef<()=>void>(()=>{});
  const [mode,setMode]=useState<Mode>('scroll'), [ready,setReady]=useState(false), [failed,setFailed]=useState(false), [morph,setMorph]=useState(0);
  useEffect(()=>{
    const el=stage.current, cv=canvas.current, ctx=cv?.getContext('2d');
    if(!el||!cv||!ctx){setFailed(true);return}
    let dead=false,visible=false,frame=0,progress=0,selected:Mode='scroll',width=0,height=0,dpr=1,crowns:Crown[]=[],yaw=0,dragging=false,pendingTouch=false,lastX=0,startX=0,startY=0;
    const position=(x:number,y:number,band:number):[number,number]=>{const c=Math.cos(yaw),s=Math.sin(yaw),rx=x*c-y*s,ry=x*s+y*c;return[
      width*(.5+.37*(rx*(1-.1*progress)+ry*.27*progress)),
      height*(.5+.42*(-ry*(.86-.63*progress)+rx*.16*progress)+(1.5-band)*.205*progress)
    ]};
    const draw=()=>{
      frame=0;if(dead||!visible||document.hidden||!crowns.length||!width)return;
      const dark=document.documentElement.classList.contains('dark');
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
      const palette=dark?['#e9a85c','#e98d8f','#78ba9c','#ddc578','#91b895']:COLORS;
      for(let band=0;band<4;band++){
        const corners=[[-1,-1],[1,-1],[1,1],[-1,1]];
        ctx.beginPath();corners.forEach(([x,y],i)=>{const p=position(x,y,band);i?ctx.lineTo(...p):ctx.moveTo(...p)});ctx.closePath();
        ctx.fillStyle=dark?'rgba(17,30,32,.75)':'rgba(237,241,234,.72)';ctx.fill();ctx.strokeStyle=dark?'#51605b':'#b9c6ba';ctx.lineWidth=.7;ctx.stroke();
        ctx.strokeStyle=dark?'#283c36':'#d6ded3';ctx.lineWidth=.4;
        for(const f of [-.5,0,.5]){ctx.beginPath();ctx.moveTo(...position(-1,f,band));ctx.lineTo(...position(1,f,band));ctx.moveTo(...position(f,-1,band));ctx.lineTo(...position(f,1,band));ctx.stroke()}
        for(let cls=4;cls>=0;cls--){ctx.beginPath();for(const c of crowns){if(c.band!==band||c.cls!==cls)continue;const [x,y]=position(c.x,c.y,band),r=c.radius*Math.min(1.35,width/650);ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,Math.PI*2)}ctx.fillStyle=palette[cls];ctx.globalAlpha=cls===4?.65:.95;ctx.fill();ctx.globalAlpha=1}
        if(progress>.55){const [x,y]=position(-1,1,band);ctx.font=`${width<420?10:12}px monospace`;ctx.fillStyle=dark?'#dde8df':'#40594b';ctx.fillText(strata.bands[band].label,x,y-8)}
      }
      el.dataset.draws=String(Number(el.dataset.draws||0)+1);el.dataset.crowns=String(crowns.length);el.dataset.yaw=yaw.toFixed(3);setReady(true);
    };
    const invalidate=()=>{if(!frame&&!dead&&visible&&!document.hidden)frame=requestAnimationFrame(draw)};
    const update=()=>{const top=el.getBoundingClientRect().top;const t=selected==='strata'?1:selected==='plan'?0:Math.max(0,Math.min(1,(innerHeight*.7-top)/(innerHeight*.65)));progress=t*t*(3-2*t);setMorph(progress);invalidate()};
    const resize=()=>{const box=el.getBoundingClientRect();width=box.width;height=box.height;dpr=Math.min(devicePixelRatio||1,1.5);cv.width=Math.round(width*dpr);cv.height=Math.round(height*dpr);update()};
    setView.current=value=>{selected=value;update()};
    const capture=(e:PointerEvent)=>{try{el.setPointerCapture(e.pointerId)}catch{/* Safari can reject capture after native scrolling begins. */}};
    const release=(e:PointerEvent)=>{try{if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId)}catch{/* The pointer may already be cancelled. */}};
    const down=(e:PointerEvent)=>{lastX=startX=e.clientX;startY=e.clientY;if(e.pointerType==='touch'){pendingTouch=true;return}dragging=true;el.dataset.dragging='true';capture(e)};
    const move=(e:PointerEvent)=>{if(pendingTouch&&!dragging){const dx=e.clientX-startX,dy=e.clientY-startY;if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){pendingTouch=false;return}if(Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){pendingTouch=false;dragging=true;el.dataset.dragging='true';capture(e)}}if(!dragging)return;yaw+=(e.clientX-lastX)*.009;lastX=e.clientX;invalidate()};
    const up=(e:PointerEvent)=>{pendingTouch=false;dragging=false;el.dataset.dragging='false';release(e)};
    const key=(e:KeyboardEvent)=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){yaw+=e.key==='ArrowLeft'?-.12:.12;e.preventDefault();invalidate()}else if(e.key.toLowerCase()==='r'){yaw=0;invalidate()}};
    resetView.current=()=>{yaw=0;invalidate()};
    const io=new IntersectionObserver(e=>{visible=e[0].isIntersecting;if(visible)update();else{cancelAnimationFrame(frame);frame=0}});io.observe(el);
    const ro=new ResizeObserver(resize);ro.observe(el);const theme=new MutationObserver(invalidate);theme.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    window.addEventListener('scroll',update,{passive:true});document.addEventListener('visibilitychange',update);el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('keydown',key);
    (async()=>{try{
      const get=async(file:string)=>{const r=await fetch('/projects/denver-canopy/'+file);if(!r.ok)throw new Error('Canopy data unavailable');return r};
      const [bin,bands,meta]=await Promise.all([get('crowns.bin').then(r=>r.arrayBuffer()),get('strata.bin').then(r=>r.arrayBuffer()),get('crowns.json').then(r=>r.json())]);
      if(dead)return;if(bin.byteLength!==strata.records*10||bands.byteLength!==strata.records)throw new Error('Canopy data length mismatch');
      const data=new DataView(bin),groups=new Uint8Array(bands);
      crowns=Array.from({length:strata.records},(_,i)=>({x:data.getUint16(i*10,true)/meta.extentM[0]*2-1,y:data.getUint16(i*10+2,true)/meta.extentM[1]*2-1,radius:.8+Math.min(2,Math.sqrt(data.getUint16(i*10+6,true))/10),cls:data.getUint8(i*10+8),band:groups[i]}));
      if(crowns.some(c=>c.band>3||c.cls>4))throw new Error('Unknown canopy class');resize();
    }catch{if(!dead)setFailed(true)}})();
    return()=>{dead=true;cancelAnimationFrame(frame);io.disconnect();ro.disconnect();theme.disconnect();window.removeEventListener('scroll',update);document.removeEventListener('visibilitychange',update);el.removeEventListener('pointerdown',down);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);el.removeEventListener('keydown',key);setView.current=()=>{};resetView.current=()=>{};crowns=[]};
  },[]);
  const choose=(value:Mode)=>{setMode(value);setView.current(value)};
  return <figure className={`${styles.figure} ${compact?styles.compact:''}`} aria-label="Canopy strata in Hale, Denver">
    <div className={styles.toolbar}><span>HALE / DENVER <b>CANOPY STRATA</b></span><div className={styles.controls} role="group" aria-label="Canopy view">{(['scroll','plan','strata'] as const).map(v=><button key={v} type="button" onClick={()=>choose(v)} aria-pressed={mode===v} disabled={failed}>{v==='scroll'?'Scroll':v==='plan'?'Plan':'Layers'}</button>)}</div></div>
    <span className="sr-only" aria-live="polite">{mode==='plan'?'Plan view selected':mode==='strata'?'Separated height layers selected':'Scroll-controlled view selected'}</span>
    <div ref={stage} className={styles.field} data-canopy data-morph={morph.toFixed(2)} data-failed={failed} data-ready={ready} data-dragging="false" tabIndex={0} role="img" aria-label="Interactive canopy strata. Drag or use left and right arrow keys to rotate. Press R or double-click to reset." onDoubleClick={()=>resetView.current()}>
      <img className={styles.fallback} style={{opacity:ready?0:1}} src="/projects/denver-canopy/card_field.webp" width="900" height="560" loading="lazy" alt="Plan view of Hale crown records, colored by predicted forestry class"/><canvas ref={canvas} className={styles.canvas} aria-hidden="true" style={{opacity:ready?1:0}}/><span className={styles.axis}>{morph<.5?'Plan · 2.57 × 2.22 km · north ↑':'Oblique view · layer gaps are schematic'}</span>
      <span className={styles.dragHint} aria-hidden="true">Drag to rotate</span>
    </div>
    <figcaption><div className={styles.legend}>{LABELS.map((label,i)=><span key={label}><i style={{background:COLORS[i]}}/>{label}</span>)}</div>
      {!compact&&<ol className={styles.bands} aria-label="Source height groups">{strata.bands.map(b=><li key={b.label}><span className={styles.bandHeight}>{b.label}</span><strong>{b.count.toLocaleString('en-US')}</strong><span className={styles.share}>{(100*b.count/strata.records).toFixed(1)}% of records</span><span className={styles.bar} aria-hidden="true">{b.counts.map((n,i)=><i key={i} style={{width:`${n/b.count*100}%`,background:COLORS[i]}}/>)}</span><p>{b.summary}</p><details><summary>Class counts</summary><dl>{LABELS.map((label,i)=><div key={label}><dt>{label}</dt><dd>{b.counts[i].toLocaleString('en-US')}</dd></div>)}</dl></details></li>)}</ol>}
      <p className={styles.note}>{compact?'Maximum LiDAR height · schematic gaps · predicted classes':'18,272 exported crown records · height is each crown’s maximum in the LiDAR-derived canopy-height model. Classes are model predictions. Bands use unrounded heights; 12 zero-height records remain in 0–6 m.'}</p>{!compact&&<a className={styles.source} href="/projects/denver-canopy/strata.json">Counts, method &amp; source hashes ↗</a>}
    </figcaption>
  </figure>;
}
