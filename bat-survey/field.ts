// Shared rig for the bat-survey instruments: a Three.js scene on a canvas with the
// site's control grammar (drag / arrow keys rotate, R or double-click resets, scroll
// morphs between two states, buttons lock a state, draws only while visible).
// three is imported on demand so the page's first-load JS stays small.
import type * as THREE_T from 'three';

export type Three = typeof THREE_T;

export type Field = {
  three: Three;
  el: HTMLElement;
  scene: THREE_T.Scene;
  rig: THREE_T.Group;
  cam: THREE_T.PerspectiveCamera;
  renderer: THREE_T.WebGLRenderer;
  labels: THREE_T.Sprite[];
  extra: Record<string, unknown>;
  progress: number;
  yaw: number; pitch: number; userYaw: number; userPitch: number;
  W: number; H: number;
  dark: boolean;
  invalidate: () => void;
  setProgress: (p: number) => void;
};

export type FieldDef = {
  fov?: number; dist?: number;
  build: (S: Field) => void;
  morph: (S: Field, p: number) => void;
  beforeRender?: (S: Field) => void;
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
const isDark = () => document.documentElement.classList.contains('dark');

/** Text sprite sized in screen pixels (rescaled on resize). Registers on the field. */
export function label(S: Field, text: string, color: string, px = 13) {
  const T = S.three;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 96;
  const g = c.getContext('2d')!;
  g.font = '500 44px "JetBrains Mono", monospace'; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 6, 50);
  const tex = new T.CanvasTexture(c); tex.minFilter = T.LinearFilter; tex.colorSpace = T.SRGBColorSpace;
  const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  s.center.set(0, 0.5); s.userData.px = px * 2.2; S.labels.push(s); return s;
}
function sizeLabels(S: Field) {
  const unit = 2 * S.cam.position.z * Math.tan(S.cam.fov * Math.PI / 360) / (S.H || 600);
  for (const s of S.labels) { const h = s.userData.px * unit; s.scale.set(h * 1024 / 96, h, 1); }
}
export function lineSeg(S: Field, pts: number[], color: string, opacity = 1) {
  const T = S.three; const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
  return new T.LineSegments(g, new T.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}
/** Page → signal-green ramp used for the relief, so the flat floor disappears into the page. */
export function ramp(T: Three, t: number, dark: boolean) {
  const stops: [number, string][] = dark
    ? [[0, '#171717'], [.25, '#1d2d22'], [.55, '#365c45'], [.8, '#78a887'], [1, '#dce9df']]
    : [[0, '#ffffff'], [.25, '#dce9df'], [.55, '#91ba9c'], [.8, '#4d795c'], [1, '#244c34']];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    return new T.Color(stops[i - 1][1]).lerp(new T.Color(stops[i][1]), (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }
  return new T.Color(stops[4][1]);
}
export const colors = (dark: boolean) => dark
  ? { ink: '#f5f5f5', mute: '#a3a3a3', line: '#2b332d', blue: '#78b88a', orange: '#d39a58' }
  : { ink: '#171717', mute: '#737373', line: '#e6e2da', blue: '#246438', orange: '#9a5b20' };

/** Mounts a field. Returns a handle with setMode() and dispose(). */
export async function mountField(el: HTMLElement, cv: HTMLCanvasElement, def: FieldDef) {
  const T = await import('three');
  let renderer: THREE_T.WebGLRenderer;
  try { renderer = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, powerPreference: 'low-power' }); }
  catch { el.dataset.failed = 'true'; return null; }
  renderer.setClearColor(0x000000, 0);
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(def.fov || 30, 1.75, 0.05, 60), rig = new T.Group();
  scene.add(rig); cam.position.set(0, 0, def.dist || 6); cam.lookAt(0, 0, 0);
  let frame = 0, visible = false, dead = false, mode: 'scroll' | number = 'scroll';
  const S: Field = { three: T, el, scene, rig, cam, renderer, labels: [], extra: {}, progress: 0, yaw: 0, pitch: 0, userYaw: 0, userPitch: 0, W: 0, H: 0, dark: isDark(), invalidate: () => {}, setProgress: () => {} };
  const render = () => {
    frame = 0; if (dead || !visible || !S.W) return;
    rig.rotation.set(S.pitch + S.userPitch, S.yaw + S.userYaw, 0);
    def.beforeRender?.(S); renderer.render(scene, cam); el.dataset.ready = 'true';
    el.dataset.draws = String(Number(el.dataset.draws || 0) + 1);
  };
  S.invalidate = () => { if (!frame && visible && !dead) frame = requestAnimationFrame(render); };
  S.setProgress = p => { S.progress = p; def.morph(S, p); S.invalidate(); };
  const update = () => {
    const top = el.getBoundingClientRect().top;
    const t = mode === 'scroll' ? Math.max(0, Math.min(1, (innerHeight * .72 - top) / (innerHeight * .6))) : mode;
    S.setProgress(ease(t));
  };
  const resize = () => {
    const b = el.getBoundingClientRect(); S.W = b.width; S.H = b.height;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(S.W, S.H, false);
    cam.aspect = S.W / S.H; cam.updateProjectionMatrix(); sizeLabels(S); update();
  };
  // pointer: horizontal drag rotates; vertical touch drag scrolls the page (touch-action: pan-y)
  let dragging = false, lx = 0, ly = 0, pending = false, sx = 0, sy = 0;
  const capture = (e: PointerEvent) => { try { el.setPointerCapture(e.pointerId); } catch { /* Safari may reject after native scroll starts */ } };
  const down = (e: PointerEvent) => { lx = sx = e.clientX; ly = sy = e.clientY; if (e.pointerType === 'touch') { pending = true; return; } dragging = true; el.dataset.dragging = 'true'; capture(e); };
  const move = (e: PointerEvent) => {
    if (pending && !dragging) { const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { pending = false; return; } if (Math.abs(dx) > 8) { pending = false; dragging = true; el.dataset.dragging = 'true'; capture(e); } }
    if (!dragging) return;
    S.userYaw += (e.clientX - lx) * .008; S.userPitch = Math.max(-1.2, Math.min(1.2, S.userPitch + (e.clientY - ly) * .006)); lx = e.clientX; ly = e.clientY; S.invalidate();
  };
  const up = (e: PointerEvent) => { pending = false; dragging = false; el.dataset.dragging = 'false'; try { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch { /* already cancelled */ } };
  const key = (e: KeyboardEvent) => {
    let used = true;
    if (e.key === 'ArrowLeft') S.userYaw -= .12; else if (e.key === 'ArrowRight') S.userYaw += .12; else if (e.key === 'ArrowUp') S.userPitch -= .1; else if (e.key === 'ArrowDown') S.userPitch += .1; else if (e.key.toLowerCase() === 'r') { S.userYaw = 0; S.userPitch = 0; } else used = false;
    if (used) { e.preventDefault(); S.invalidate(); }
  };
  const reset = () => { S.userYaw = 0; S.userPitch = 0; S.invalidate(); };
  const rebuild = () => { S.dark = isDark(); while (rig.children.length) rig.remove(rig.children[0]); S.labels = []; def.build(S); sizeLabels(S); def.morph(S, S.progress); S.invalidate(); };
  const io = new IntersectionObserver(en => { visible = en[0].isIntersecting; if (visible) update(); else { cancelAnimationFrame(frame); frame = 0; } });
  const ro = new ResizeObserver(resize);
  const theme = new MutationObserver(rebuild);
  try { def.build(S); } catch (e) { console.error('bat field', e); el.dataset.failed = 'true'; renderer.dispose(); return null; }
  io.observe(el); ro.observe(el); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('scroll', update, { passive: true });
  el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('keydown', key); el.addEventListener('dblclick', reset);
  resize();
  // Synchronous render + read, used to regenerate the static fallback images (public/projects/bat-survey/field-*.webp).
  (el as HTMLElement & { __capture?: () => string }).__capture = () => { rig.rotation.set(S.pitch + S.userPitch, S.yaw + S.userYaw, 0); def.beforeRender?.(S); renderer.render(scene, cam); return renderer.domElement.toDataURL('image/png'); };
  return {
    S,
    setMode(m: 'scroll' | number) { mode = m; update(); },
    dispose() {
      dead = true; cancelAnimationFrame(frame); io.disconnect(); ro.disconnect(); theme.disconnect();
      window.removeEventListener('scroll', update);
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('keydown', key); el.removeEventListener('dblclick', reset);
      rig.traverse(o => { const m = o as THREE_T.Mesh; m.geometry?.dispose?.(); const mat = m.material as THREE_T.Material | undefined; mat?.dispose?.(); });
      renderer.dispose();
    },
  };
}
