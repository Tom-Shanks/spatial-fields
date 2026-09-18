'use client';
import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import styles from './bats.module.css';
import { mountField, label, lineSeg, colors, lerp, type Field } from './field';

// 2,228 BatDetect2-confirmed calls, first laid out by time of night, then re-sorted by the
// three numbers the CNN measured per call: terminal frequency, bandwidth, duration.
type Call = [night: number, tsec: number, lo: number, hi: number, dur: number, p: number];
type Mode = 'scroll' | 0 | 1;
const T1 = 11 * 3600, F0 = 15, F1 = 60;

export default function CallField({ hero = false }: { hero?: boolean }) {
  const field = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const setMode = useRef<(m: Mode) => void>(() => {});
  const [mode, setModeState] = useState<Mode>('scroll'), [failed, setFailed] = useState(false), [axis, setAxis] = useState('time → · kHz ↑ · night in depth');
  useEffect(() => {
    const el = field.current, cv = canvas.current; if (!el || !cv) return;
    let handle: Awaited<ReturnType<typeof mountField>> = null, dead = false;
    (async () => {
      try {
        const r = await fetch('/projects/bat-survey/calls3d.json'); if (!r.ok) throw new Error('calls');
        const CALLS = (await r.json()) as Call[]; if (dead) return;
        handle = await mountField(el, cv, {
          fov: 30, dist: 6,
          build(S: Field) {
            const T = S.three, C = colors(S.dark), n = CALLS.length;
            const pos = new Float32Array(n * 3), size = new Float32Array(n);
            CALLS.forEach((c, i) => { size[i] = c[5]; });
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aP', new T.BufferAttribute(size, 1));
            const mat = new T.ShaderMaterial({
              transparent: true, depthWrite: false,
              uniforms: { uColor: { value: new T.Color(C.blue) }, uScale: { value: S.H || 600 } },
              vertexShader: 'attribute float aP;uniform float uScale;varying float vP;void main(){vP=aP;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=(3.0+9.0*aP)*(uScale/600.0)*(3.6/-mv.z);}',
              fragmentShader: 'uniform vec3 uColor;varying float vP;void main(){float d=length(gl_PointCoord-0.5);if(d>0.5)discard;gl_FragColor=vec4(uColor,(0.35+0.55*vP)*smoothstep(0.5,0.3,d));}',
            });
            const pts = new T.Points(g, mat); S.rig.add(pts);
            const L = 1.6;
            const axA = lineSeg(S, [-L, -.8, 0, L, -.8, 0, -L, -.8, 0, -L, .8, 0, -L, -.8, -.6, -L, -.8, .6], C.line);
            const axB = lineSeg(S, [-1.2, -.8, -.8, 1.2, -.8, -.8, -1.2, -.8, -.8, -1.2, .8, -.8, -1.2, -.8, -.8, -1.2, -.8, .8], C.line);
            S.rig.add(axA, axB);
            const labA: [ReturnType<typeof label>, number[]][] = [[label(S, 'time of night →', C.mute), [-L, -.92, 0]], [label(S, 'kHz ↑', C.mute), [-L - .05, .92, 0]], [label(S, '20:00', C.mute, 12), [-L, -1.04, 0]], [label(S, '07:00', C.mute, 12), [L - .3, -1.04, 0]], [label(S, 'nights in depth', C.mute, 12), [-L, -.92, .62]]];
            const labB: [ReturnType<typeof label>, number[]][] = [[label(S, 'terminus Fc kHz →', C.mute), [-1.2, -.92, -.8]], [label(S, 'bandwidth kHz ↑', C.mute), [-1.25, .92, -.8]], [label(S, 'duration ms ↗', C.mute), [-1.2, -.92, .84]], [label(S, '18', C.mute, 12), [-1.2, -1.04, -.8]], [label(S, '38', C.mute, 12), [1.1, -1.04, -.8]], [label(S, '0–40', C.mute, 12), [-1.55, .8, -.8]], [label(S, '0–25', C.mute, 12), [-1.2, -1.04, .84]]];
            [...labA, ...labB].forEach(([l, p]) => { l.position.set(p[0], p[1], p[2]); S.rig.add(l); });
            Object.assign(S.extra, { pts, mat, axA, axB, labA, labB });
          },
          morph(S: Field, p: number) {
            const { pts, mat, axA, axB, labA, labB } = S.extra as { pts: THREE.Points; mat: THREE.ShaderMaterial; axA: THREE.LineSegments; axB: THREE.LineSegments; labA: [THREE.Sprite, number[]][]; labB: [THREE.Sprite, number[]][] };
            const pos = pts.geometry.attributes.position.array as Float32Array;
            for (let i = 0; i < CALLS.length; i++) {
              const c = CALLS[i];
              const ax = (c[1] / T1) * 3.2 - 1.6, ay = (c[2] - F0) / (F1 - F0) * 1.6 - .8, az = (c[0] - 2) * .28;
              const bx = Math.max(-1.3, Math.min(1.3, (c[2] - 18) / 20 * 2.4 - 1.2)), by = Math.max(-.85, Math.min(.85, (c[3] - c[2]) / 40 * 1.6 - .8)), bz = Math.max(-.85, Math.min(.85, (c[4] / 25) * 1.6 - .8));
              pos[i * 3] = lerp(ax, bx, p); pos[i * 3 + 1] = lerp(ay, by, p); pos[i * 3 + 2] = lerp(az, bz, p);
            }
            pts.geometry.attributes.position.needsUpdate = true; mat.uniforms.uScale.value = S.H || 600;
            (axA.material as THREE.Material).opacity = 1 - p; (axA.material as THREE.Material).transparent = true;
            (axB.material as THREE.Material).opacity = p; (axB.material as THREE.Material).transparent = true;
            labA.forEach(([l]) => { l.material.opacity = 1 - p; }); labB.forEach(([l]) => { l.material.opacity = p; });
            S.yaw = lerp(-.25, .55, p); S.pitch = lerp(.18, .32, p);
            setAxis(p < .5 ? 'time → · kHz ↑ · night in depth' : 'Fc → · bandwidth ↑ · duration in depth');
          },
        });
        if (!handle) { setFailed(true); return; }
        setMode.current = m => handle?.setMode(m);
      } catch (e) { console.error('Call field unavailable', e); setFailed(true); }
    })();
    return () => { dead = true; handle?.dispose(); setMode.current = () => {}; };
  }, []);
  const choose = (m: Mode) => { setModeState(m); setMode.current(m); };
  return <figure className={`${styles.figure} ${hero ? styles.hero : ''}`} aria-label="Call field: every detected call by time of night, then by measured shape">
    <div className={styles.toolbar}><span>{hero ? 'SEVEN NIGHTS' : 'HALE / DENVER'} <b>{hero ? '2,228 CALL DETECTIONS OVER ONE BACKYARD' : '2,228 CALLS · WHEN, THEN WHAT'}</b></span>
      <div className={styles.controls} role="group" aria-label="Field view">{([['scroll', 'Scroll'], [0, 'Timeline'], [1, 'Shape']] as [Mode, string][]).map(([v, l]) => <button key={String(v)} type="button" onClick={() => choose(v)} aria-pressed={mode === v} disabled={failed}>{l}</button>)}</div></div>
    <div ref={field} className={styles.field} tabIndex={0} role="img" data-failed={failed} data-dragging="false" aria-label="Every detected echolocation call as a point. Drag or use arrow keys to rotate, R to reset. Scroll or use the buttons to move between the timeline and the shape arrangement.">
      <img className={`${styles.fallback} dark:hidden`} src="/projects/bat-survey/field-b.webp" width="768" height="438" loading="lazy" alt="Point cloud of 2,228 bat calls arranged by terminal frequency, bandwidth and duration" />
      <img className={`${styles.fallback} hidden dark:block`} src="/projects/bat-survey/field-b-dark.webp" width="768" height="438" loading="lazy" alt="" aria-hidden="true" />
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      <span className={styles.hint} aria-hidden="true">Drag to rotate</span><span className={styles.axis}>{axis}</span>
      <div className={styles.fail}>WebGL unavailable</div>
    </div>
    <figcaption className={styles.note}>{hero
      ? 'Each point is one detected echolocation call. Scroll to move from time of night to measured call shape. Drag to rotate.'
      : 'BatDetect2 measured each call by terminal frequency, bandwidth, and duration. Most calls cluster around 24 to 29 kHz. Larger points have higher model confidence. Scroll to change the layout and drag to rotate.'}</figcaption>
  </figure>;
}
