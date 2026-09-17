'use client';
import { useEffect, useRef, useState } from 'react';
import styles from './adsb.module.css';

// 60,000 real ADS-B contacts received by a single RTL-SDR in Denver, plotted around the
// receiver. Scrolling re-plots the same points by altitude instead of distance, in the
// spirit of Shimizu's time-distance maps: one dataset, a different quantity on the radius.
const VERT = `
attribute vec4 a;            // bearing(rad), range(0..1), altitude(0..1), source category
uniform float u_morph, u_size, u_yaw, u_pitch;
uniform vec2 u_scale;
void main(){
  float r = a.y * mix(0.92,0.55,u_morph);
  vec3 p = vec3(sin(a.x)*r,(a.z-0.5)*1.35*u_morph,cos(a.x)*r);
  p.xz = mat2(cos(u_yaw),-sin(u_yaw),sin(u_yaw),cos(u_yaw)) * p.xz;
  p.yz = mat2(cos(u_pitch),-sin(u_pitch),sin(u_pitch),cos(u_pitch)) * p.yz;
  float perspective = 2.8 / (2.8-p.z);
  gl_Position = vec4(p.x*u_scale.x*perspective,p.y*u_scale.y*perspective,0.0,1.0);
  gl_PointSize = u_size * perspective;
}`;
const FRAG = `
precision mediump float;
uniform vec3 u_color;
uniform float u_alpha;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float m = smoothstep(0.5, 0.28, length(d));
  gl_FragColor = vec4(u_color, u_alpha * m);
}`;

type Meta = { records: number; maxRangeKm: number; plotRangeKm: number; maxAltitudeFt: number; keptCounts: Record<string, number>; counts: Record<string, number> };

export default function AdsbField({compact=false}:{compact?:boolean}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const resetView = useRef<()=>void>(()=>{});
  const [meta, setMeta] = useState<Meta | null>(null);
  const [morph, setMorph] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    if (!el || !cv) return;
    let dead = false, frame = 0, visible = true, count = 0;
    let gl: WebGLRenderingContext | null = null, uMorph: WebGLUniformLocation | null = null, uYaw: WebGLUniformLocation | null = null, uPitch: WebGLUniformLocation | null = null, uScale: WebGLUniformLocation | null = null, uSize: WebGLUniformLocation | null = null, themeObserver: MutationObserver | null = null;
    let current = 0, userYaw = 0, userPitch = 0, dragging = false, lastX = 0, lastY = 0;
    const dark = () => document.documentElement.classList.contains('dark');
    const draw = () => {
      frame = 0;
      if (dead || !gl || !visible || !count) return;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const yaw=current*.72+userYaw,pitch=Math.max(-.15,Math.min(1.57,Math.PI/2-current*1.28+userPitch));
      gl.uniform1f(uMorph, current); gl.uniform1f(uYaw,yaw);gl.uniform1f(uPitch,pitch);
      gl.drawArrays(gl.POINTS, 0, count);
      el.dataset.yaw=yaw.toFixed(3);el.dataset.pitch=pitch.toFixed(3);
    };
    const invalidate = () => { if (!frame && !dead) frame = requestAnimationFrame(draw); };
    const resize = () => {
      if (!gl) return;
      const box = el.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
      const s = Math.min(cv.width, cv.height);
      gl.uniform2f(uScale, s / cv.width, s / cv.height);
      gl.uniform1f(uSize, (box.width < 600 ? 1.5 : 1.9) * dpr);
      invalidate();
    };
    const onScroll = () => {
      const top = el.getBoundingClientRect().top;
      const t = Math.max(0, Math.min(1, (window.innerHeight * 0.55 - top) / (window.innerHeight * 0.75)));
      const eased = t * t * (3 - 2 * t);
      if (Math.abs(eased - current) > 0.002) { current = eased; setMorph(eased); invalidate(); }
    };
    const onDown=(e:PointerEvent)=>{dragging=true;lastX=e.clientX;lastY=e.clientY;el.dataset.dragging='true';el.setPointerCapture(e.pointerId)};
    const onPointer=(e:PointerEvent)=>{if(!dragging)return;userYaw+=(e.clientX-lastX)*.009;userPitch+=(e.clientY-lastY)*.007;lastX=e.clientX;lastY=e.clientY;invalidate()};
    const onUp=(e:PointerEvent)=>{dragging=false;el.dataset.dragging='false';if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId)};
    const onKey=(e:KeyboardEvent)=>{let used=true;if(e.key==='ArrowLeft')userYaw-=.12;else if(e.key==='ArrowRight')userYaw+=.12;else if(e.key==='ArrowUp')userPitch-=.1;else if(e.key==='ArrowDown')userPitch+=.1;else if(e.key.toLowerCase()==='r'){userYaw=0;userPitch=0}else used=false;if(used){e.preventDefault();invalidate()}};
    resetView.current=()=>{userYaw=0;userPitch=0;invalidate()};
    (async () => {
      try {
        const [bin, m] = await Promise.all([
          fetch('/projects/adsb/contacts.bin').then(r => { if (!r.ok) throw new Error('contacts'); return r.arrayBuffer(); }),
          fetch('/projects/adsb/contacts.json').then(r => r.json() as Promise<Meta>),
        ]);
        if (dead) return;
        gl = cv.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: false });
        if (!gl) throw new Error('no webgl');
        const compile = (type: number, src: string) => { const s = gl!.createShader(type)!; gl!.shaderSource(s, src); gl!.compileShader(s); if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) || 'shader'); return s; };
        const prog = gl.createProgram()!;
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
        gl.useProgram(prog);
        const view = new DataView(bin); count = bin.byteLength / 8;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
          const o = i * 8;
          data[i * 4] = view.getUint16(o, true) * Math.PI / 180;
          data[i * 4 + 1] = Math.min(1, view.getUint16(o + 2, true) / 100 / m.plotRangeKm);
          data[i * 4 + 2] = Math.min(1, view.getUint16(o + 4, true) * 10 / m.maxAltitudeFt);
          data[i * 4 + 3] = view.getUint8(o + 6);
        }
        const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        uMorph = gl.getUniformLocation(prog, 'u_morph'); uYaw = gl.getUniformLocation(prog, 'u_yaw'); uPitch = gl.getUniformLocation(prog, 'u_pitch'); uScale = gl.getUniformLocation(prog, 'u_scale'); uSize = gl.getUniformLocation(prog, 'u_size');
        const applyTheme=()=>{if(!gl)return;const isDark=dark();gl.uniform3f(gl.getUniformLocation(prog,'u_color'),...(isDark?[0.84,0.86,0.84]:[0.16,0.17,0.2]) as [number,number,number]);gl.uniform1f(gl.getUniformLocation(prog,'u_alpha'),isDark?0.48:0.5);invalidate()};
        applyTheme();themeObserver=new MutationObserver(applyTheme);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
        setMeta(m); el.dataset.contacts = String(count);
        resize(); onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', resize);
        el.addEventListener('pointerdown',onDown);el.addEventListener('pointermove',onPointer);el.addEventListener('pointerup',onUp);el.addEventListener('pointercancel',onUp);el.addEventListener('keydown',onKey);
      } catch (error) {
        console.error('ADS-B field unavailable', error);
        setFailed(true);
      }
    })();
    const io = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) invalidate(); }, { threshold: 0 });
    io.observe(el);
    return () => { dead = true; cancelAnimationFrame(frame); io.disconnect(); themeObserver?.disconnect(); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', resize); el.removeEventListener('pointerdown',onDown);el.removeEventListener('pointermove',onPointer);el.removeEventListener('pointerup',onUp);el.removeEventListener('pointercancel',onUp);el.removeEventListener('keydown',onKey);resetView.current=()=>{}; };
  }, []);
  const rings = [0.25, 0.5, 0.75, 1];
  const labelFor = (f: number) => meta ? (morph < 0.5 ? `${Math.round(f * meta.plotRangeKm)} km` : `${Math.round(f * meta.maxAltitudeFt / 1000)}k ft`) : '';
  return <figure className={styles.figure}>
    <div ref={wrap} className={styles.field} data-morph={morph.toFixed(2)} data-failed={failed} data-dragging="false" tabIndex={0} role="img" aria-label="Interactive three-dimensional ADS-B contact field. Scroll changes to altitude view. Drag or use arrow keys to rotate. Press R or double-click to reset." onDoubleClick={()=>resetView.current()}>
      {!failed && <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />}
      {failed && <p className={styles.unavailable}>Interactive contact field unavailable. The archive contains 60,000 sampled positions from one Denver receiver.</p>}
      <svg className={styles.rings} style={{opacity:Math.max(0,1-morph*1.25)}} viewBox="-1 -1 2 2" aria-hidden="true">
        {rings.map(f => <circle key={f} cx="0" cy="0" r={f * 0.92} />)}
        <line x1="0" y1="-0.96" x2="0" y2="0.96" /><line x1="-0.96" y1="0" x2="0.96" y2="0" />
      </svg>
      {meta && !failed && <div className={styles.ringLabels} style={{opacity:Math.max(0,1-morph*1.25)}} aria-hidden="true">{rings.map(f => <span key={f} style={{ top: `${50 - f * 46}%` }}>{labelFor(f)}</span>)}</div>}
      {meta&&<div className={styles.altitudeGuide} style={{opacity:morph}} aria-hidden="true"><span>59k ft</span><span>40k</span><span>20k</span><span>0</span></div>}
      <div className={styles.axis} aria-hidden="true"><span style={{ opacity: Math.max(0, 1 - morph * 2) }}>Radius = distance from the receiver</span><span style={{ opacity: Math.max(0, morph * 2 - 1) }}>Height = altitude above sea level</span></div>
      <div className={styles.compass} aria-hidden="true"><span>N</span><span>E</span><span>S</span><span>W</span></div>
      <span className={styles.interactionHint} aria-hidden="true">Drag to rotate</span>
    </div>
    <figcaption className={compact?'sr-only':styles.caption}>
      <span>{meta ? `${meta.records.toLocaleString('en-US')} of ${Object.values(meta.counts).reduce((sum, value) => sum + value, 0).toLocaleString('en-US')} contacts` : 'Loading contacts'}<br />One receiver, Denver</span>
      <span>Drag to rotate<br />Scroll to re-plot by altitude</span>
    </figcaption>
  </figure>;
}
