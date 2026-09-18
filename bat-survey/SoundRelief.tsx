'use client';
import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import styles from './bats.module.css';
import { mountField, label, lineSeg, colors, ramp, lerp, type Field } from './field';

// One 3-second clip (2026-06-19 04:40:47) as a height field: the STFT on a 360 × 120
// grid, energy as elevation. Scroll flattens it to the flat spectrogram. Audio plays
// at 1/10 speed with a sweep plane that tracks the sound.
type Relief = { n_t: number; n_f: number; q: number[] };
type Mode = 'scroll' | 0 | 1;
const AUDIO = '/projects/bat-survey/clip-20260619-044047-te10.mp3';

export default function SoundRelief({ hero = false }: { hero?: boolean }) {
  const field = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), audioRef = useRef<HTMLAudioElement | null>(null);
  const setMode = useRef<(m: Mode) => void>(() => {}), sweepTo = useRef<(f: number, on: boolean) => void>(() => {});
  const [mode, setModeState] = useState<Mode>('scroll'), [failed, setFailed] = useState(false), [playing, setPlaying] = useState(false), [time, setTime] = useState('0.000 / 3.000 s · 250 kHz → played at 25 kHz');
  useEffect(() => {
    const el = field.current, cv = canvas.current; if (!el || !cv) return;
    let handle: Awaited<ReturnType<typeof mountField>> = null, dead = false;
    (async () => {
      try {
        const r = await fetch('/projects/bat-survey/relief_n5.json'); if (!r.ok) throw new Error('relief');
        const R = (await r.json()) as Relief; if (dead) return;
        handle = await mountField(el, cv, {
          fov: 30, dist: 5.6,
          build(S: Field) {
            const T = S.three, C = colors(S.dark), nt = R.n_t, nf = R.n_f;
            const g = new T.PlaneGeometry(3.2, 1.5, nt - 1, nf - 1);
            const count = g.attributes.position.count, col = new Float32Array(count * 3), h = new Float32Array(count);
            for (let j = 0; j < nf; j++) for (let i = 0; i < nt; i++) {
              const q = R.q[j * nt + i] / 255, v = j * nt + i; h[v] = q;
              const c = ramp(T, q, S.dark); col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
            }
            g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setAttribute('aH', new T.BufferAttribute(h, 1));
            const mesh = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide })); mesh.rotation.x = -Math.PI / 2; S.rig.add(mesh);
            // Bright enough that the flat floor (vertex color = page color) renders as the page; ridges keep their shading.
            S.rig.add(new T.HemisphereLight(0xffffff, S.dark ? 0x333333 : 0xbbbbbb, S.dark ? 2.4 : 2.6));
            const d = new T.DirectionalLight(0xffffff, S.dark ? 1.4 : 1.2); d.position.set(-1.5, 2.2, 1.2); S.rig.add(d);
            const sweep = new T.Mesh(new T.PlaneGeometry(.012, 1.5), new T.MeshBasicMaterial({ color: C.orange, transparent: true, opacity: 0, side: T.DoubleSide }));
            sweep.rotation.y = Math.PI / 2; sweep.position.set(-1.6, 0, 0); S.rig.add(sweep);
            S.rig.add(lineSeg(S, [-1.6, 0, -.75, 1.6, 0, -.75, -1.6, 0, .75, 1.6, 0, .75, -1.6, 0, -.75, -1.6, 0, .75, 1.6, 0, -.75, 1.6, 0, .75], C.line));
            ([[label(S, '0 s', C.mute, 12), [-1.6, 0, .86]], [label(S, '1', C.mute, 12), [-1.6 + 3.2 / 3, 0, .86]], [label(S, '2', C.mute, 12), [-1.6 + 6.4 / 3, 0, .86]], [label(S, '3 s', C.mute, 12), [1.5, 0, .86]], [label(S, '10 kHz', C.mute, 12), [1.66, 0, .75]], [label(S, '70 kHz', C.mute, 12), [1.66, 0, -.72]]] as [THREE.Sprite, number[]][])
              .forEach(([l, p]) => { l.position.set(p[0], p[1], p[2]); S.rig.add(l); });
            Object.assign(S.extra, { mesh, sweep });
          },
          morph(S: Field, p: number) {
            const mesh = S.extra.mesh as THREE.Mesh; const g = mesh.geometry;
            const pos = g.attributes.position.array as Float32Array, h = g.attributes.aH.array as Float32Array;
            for (let v = 0; v < h.length; v++) pos[v * 3 + 2] = h[v] * h[v] * 0.75 * p;
            g.attributes.position.needsUpdate = true; g.computeVertexNormals();
            S.yaw = lerp(0, -.35, p); S.pitch = lerp(1.35, .55, p);
          },
        });
        if (!handle) { setFailed(true); return; }
        const H = handle;
        setMode.current = m => H.setMode(m);
        sweepTo.current = (f, on) => { const sw = H.S.extra.sweep as THREE.Mesh; sw.position.x = -1.6 + 3.2 * f; (sw.material as THREE.MeshBasicMaterial).opacity = on ? .9 : 0; H.S.invalidate(); };
      } catch (e) { console.error('Sound relief unavailable', e); setFailed(true); }
    })();
    return () => { dead = true; handle?.dispose(); setMode.current = () => {}; sweepTo.current = () => {}; audioRef.current?.pause(); };
  }, []);
  const choose = (m: Mode) => { setModeState(m); setMode.current(m); };
  const toggle = () => {
    let a = audioRef.current;
    if (!a) { a = new Audio(AUDIO); a.preload = 'none'; audioRef.current = a; let raf = 0;
      const tick = () => { const d = a!.duration || 30, f = Math.min(1, a!.currentTime / d); sweepTo.current(f, true); setTime(`${(f * 3).toFixed(3)} / 3.000 s · ×10 · ${a!.currentTime.toFixed(1)} s elapsed`); if (!a!.paused) raf = requestAnimationFrame(tick); };
      a.addEventListener('play', () => { setPlaying(true); raf = requestAnimationFrame(tick); });
      a.addEventListener('pause', () => { setPlaying(false); cancelAnimationFrame(raf); });
      a.addEventListener('ended', () => { setPlaying(false); sweepTo.current(0, false); cancelAnimationFrame(raf); });
    }
    if (a.paused) a.play().catch(() => setTime('Playback blocked by the browser; press play again.')); else a.pause();
  };
  return <figure className={`${styles.figure} ${hero ? styles.hero : ''}`} aria-label="Sound relief: one clip's spectrogram with amplitude mapped to display height">
    <div className={styles.toolbar}><span>{hero ? 'ONE CLIP' : 'NIGHT 5'} <b>{hero ? '3 SECONDS OF BAT ECHOLOCATION · 2026-06-19 04:40:47' : 'ONE CLIP · 2026-06-19 04:40:47'}</b></span>
      <div className={styles.controls} role="group" aria-label="Field view">{([['scroll', 'Scroll'], [0, 'Spectrogram'], [1, 'Relief']] as [Mode, string][]).map(([v, l]) => <button key={String(v)} type="button" onClick={() => choose(v)} aria-pressed={mode === v} disabled={failed}>{l}</button>)}</div></div>
    <div ref={field} className={styles.field} tabIndex={0} role="img" data-failed={failed} data-dragging="false" aria-label="Three-second spectrogram with amplitude mapped to display height. Drag or use arrow keys to rotate, R to reset. Scroll or use the buttons to flatten it.">
      <img className={`${styles.fallback} dark:hidden`} src="/projects/bat-survey/field-c.webp" width="768" height="438" loading="lazy" alt="Three-second spectrogram rendered as terrain: twenty ridges, one per bat pulse" />
      <img className={`${styles.fallback} hidden dark:block`} src="/projects/bat-survey/field-c-dark.webp" width="768" height="438" loading="lazy" alt="" aria-hidden="true" />
      <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
      <span className={styles.hint} aria-hidden="true">Drag to rotate</span><span className={styles.axis}>3.0 s → · 10–70 kHz across · dB up</span>
      <div className={styles.fail}>WebGL unavailable</div>
    </div>
    <div className={styles.row}><button type="button" className={styles.play} onClick={toggle} aria-pressed={playing}>{playing ? 'PAUSE' : 'PLAY ×10'}</button><span className={styles.time} aria-live="polite">{time}</span></div>
    <figcaption className={styles.note}>{hero
      ? 'Three seconds recorded at 4:40 AM. Each ridge is one bat pulse. Drag to rotate or play the clip at one-tenth speed.'
      : 'Three seconds recorded at 4:40 AM on June 19. Each ridge is one pulse sweeping from roughly 45 to 26 kHz. The low 20 kHz ridge is not a bat. Press play to hear the clip at one-tenth speed.'}</figcaption>
  </figure>;
}
