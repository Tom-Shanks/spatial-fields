'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './orbit-globe.module.css';

// Every RFPI pass with saved orbital inputs, drawn over Denver on the WGS84 ellipsoid.
// Geometry is ECEF km throughout. The view is an orthographic, isometric camera on the
// local ellipsoid normal at a public Denver city reference (not the receiver location).
// Basemap: NASA Blue Marble NG, ray-cast per pixel and sampled at geodetic lat/lon.

type Pass = { satellite: string; type: 'weather_satellite' | 'fm' | 'aprs'; utc: string; received: string; basis: 'start' | 'scan'; altitudeKm: number; intercept: number[]; orbit: number[][]; image?: { src: string; width: number; height: number } };
type Data = { totals: { records: number; modeled: number }; range: [string, string]; passes: Pass[] };
type V = [number, number, number];
type Mode = 'scroll' | 'play' | 'all' | 'manual';
const PLAY_MS = 14000; // full three-week replay

const A = 6378.137, F = 1 / 298.257223563, E2 = F * (2 - F), B = A * (1 - F);
const AXES: V = [A, A, B];
const DENVER = { lat: 39.75, lon: -104.99, heightKm: 1.587 };
const HOME = { yaw: (3 * Math.PI) / 4, pitch: Math.asin(1 / Math.sqrt(3)) }; // isometric, looking NE from the SW
const SPAN_KM = 7600; // horizontal extent of the field at zoom 1
const TYPES = {
  weather_satellite: { label: 'Weather / LRPT', light: '#2f7a4a', dark: '#9fdcb2' },
  fm: { label: 'FM', light: '#b0692c', dark: '#e9bb8a' },
  aprs: { label: 'APRS', light: '#6b5fa8', dark: '#bdb2e6' },
} as const;

const rad = (d: number) => (d * Math.PI) / 180;
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function geodeticToEcef(latDeg: number, lonDeg: number, h: number): V {
  const p = rad(latDeg), l = rad(lonDeg), n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  return [(n + h) * Math.cos(p) * Math.cos(l), (n + h) * Math.cos(p) * Math.sin(l), (n * (1 - E2) + h) * Math.sin(p)];
}
const ORIGIN = geodeticToEcef(DENVER.lat, DENVER.lon, DENVER.heightKm);
const EAST: V = [-Math.sin(rad(DENVER.lon)), Math.cos(rad(DENVER.lon)), 0];
const NORTH: V = [-Math.sin(rad(DENVER.lat)) * Math.cos(rad(DENVER.lon)), -Math.sin(rad(DENVER.lat)) * Math.sin(rad(DENVER.lon)), Math.cos(rad(DENVER.lat))];
const UP: V = [Math.cos(rad(DENVER.lat)) * Math.cos(rad(DENVER.lon)), Math.cos(rad(DENVER.lat)) * Math.sin(rad(DENVER.lon)), Math.sin(rad(DENVER.lat))];

function camera(yaw: number, pitch: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const horizontal = add(add([0, 0, 0], EAST, -s), NORTH, c);
  const depth = add(add([0, 0, 0], horizontal, cp), UP, sp); // unit vector toward the viewer
  const right = add(add([0, 0, 0], EAST, -c), NORTH, -s);
  return { depth, right, up: cross(depth, right) };
}

// True when nothing of the ellipsoid lies between the point and the (orthographic) viewer.
function unoccluded(p: V, depth: V) {
  let a = 0, b = 0, c = -1;
  for (let i = 0; i < 3; i++) { const q = p[i] / AXES[i], d = depth[i] / AXES[i]; a += d * d; b += 2 * q * d; c += q * q; }
  if (c < 0) return false;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return true;
  const r = Math.sqrt(disc);
  return (-b + r) / (2 * a) <= 1e-7; // both roots behind the point
}

export default function OrbitGlobe({ compact = false }: { compact?: boolean }) {
  const field = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const resetView = useRef<() => void>(() => {});
  const redraw = useRef<() => void>(() => {});
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [through, setThrough] = useState('');
  const [mode, setModeState] = useState<Mode>('scroll');
  const [viewing, setViewing] = useState(false);
  const [cursorMs, setCursorMs] = useState(0);
  const control = useRef<{ setMode: (m: Mode) => void; scrub: (ms: number) => void }>({ setMode: () => {}, scrub: () => {} });
  const [failed, setFailed] = useState(false);
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    let cancelled = false;
    const load = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      load.disconnect();
      fetch('/projects/rfpi/orbit-globe.json').then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then((json: Data) => { if (!cancelled) setData(json); }).catch(() => { if (!cancelled) setFailed(true); });
    }, { rootMargin: '400px' });
    load.observe(el);
    return () => { cancelled = true; load.disconnect(); };
  }, []);

  useEffect(() => {
    const el = field.current, cv = canvas.current;
    if (!el || !cv || !data) return;
    const ctx = cv.getContext('2d');
    if (!ctx) { setFailed(true); return; }

    const passes = data.passes;
    const times = passes.map((p) => Date.parse(p.utc));
    const start = Date.parse(data.range[0]), end = Date.parse(data.range[1]);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    let dead = false, visible = true, frame = 0, frames = 0, yaw = HOME.yaw, pitch = HOME.pitch, cursor = end;
    let dragging = false, pendingTouch = false, startX = 0, startY = 0, lastX = 0, lastY = 0, downAt = 0, lastMove = 0, upgrade = 0;
    let icons: { i: number; x: number; y: number }[] = [];
    let tex: Uint8ClampedArray | null = null, texW = 0, texH = 0;
    const layer = document.createElement('canvas'), layerCtx = layer.getContext('2d');
    let layerKey = '';

    const image = new Image();
    image.decoding = 'async';
    image.src = el.clientWidth < 700 ? '/projects/rfpi/earth-bluemarble-2048.webp' : '/projects/rfpi/earth-bluemarble-4096.webp';
    image.onload = () => {
      if (dead) return;
      try {
        const sample = document.createElement('canvas');
        sample.width = image.naturalWidth; sample.height = image.naturalHeight;
        const sctx = sample.getContext('2d', { willReadFrequently: true });
        if (!sctx) return;
        sctx.drawImage(image, 0, 0);
        tex = sctx.getImageData(0, 0, sample.width, sample.height).data; texW = sample.width; texH = sample.height;
        invalidate();
      } catch { /* Basemap is optional; geometry still renders on the ellipsoid outline. */ }
    };

    const metrics = () => {
      const box = el.getBoundingClientRect();
      const w = box.width, h = box.height, scale = w / SPAN_KM;
      return { w, h, scale, cx: w / 2, cy: h * 0.56 };
    };

    function drawEarth(w: number, h: number, scale: number, cx: number, cy: number, cam: ReturnType<typeof camera>, dpr: number) {
      if (!tex || !layerCtx) return false;
      const moving = performance.now() - lastMove < 160;
      const res = moving ? Math.min(0.55, dpr) : Math.min(dpr, 1.5);
      const W = Math.max(1, Math.round(w * res)), H = Math.max(1, Math.round(h * res));
      const key = `${W}|${H}|${yaw}|${pitch}`;
      if (key !== layerKey) {
        if (layer.width !== W || layer.height !== H) { layer.width = W; layer.height = H; }
        const out = layerCtx.createImageData(W, H), o = out.data;
        const { depth: D, right: R, up: U } = cam, far = 40000, i0 = 1 / (A * A), i2 = 1 / (B * B);
        const a = (D[0] * D[0] + D[1] * D[1]) * i0 + D[2] * D[2] * i2;
        for (let py = 0; py < H; py++) {
          const vy = -((py + 0.5) / res - cy) / scale;
          for (let px = 0; px < W; px++) {
            const vx = ((px + 0.5) / res - cx) / scale;
            const o0 = ORIGIN[0] + R[0] * vx + U[0] * vy + D[0] * far, o1 = ORIGIN[1] + R[1] * vx + U[1] * vy + D[1] * far, o2 = ORIGIN[2] + R[2] * vx + U[2] * vy + D[2] * far;
            const b = -2 * ((o0 * D[0] + o1 * D[1]) * i0 + o2 * D[2] * i2), c = (o0 * o0 + o1 * o1) * i0 + o2 * o2 * i2 - 1, disc = b * b - 4 * a * c;
            if (disc < 0) continue;
            const t = (-b - Math.sqrt(disc)) / (2 * a), x = o0 - t * D[0], y = o1 - t * D[1], z = o2 - t * D[2];
            const lon = Math.atan2(y, x), lat = Math.atan2(z, (1 - E2) * Math.hypot(x, y));
            let u = ((lon + Math.PI) / (2 * Math.PI) * texW) | 0, v = ((Math.PI / 2 - lat) / Math.PI * texH) | 0;
            if (u >= texW) u = texW - 1; if (v >= texH) v = texH - 1; if (v < 0) v = 0;
            const nx = x * i0, ny = y * i0, nz = z * i2, mu = (nx * D[0] + ny * D[1] + nz * D[2]) / Math.hypot(nx, ny, nz);
            const shade = 0.3 + 0.7 * Math.sqrt(Math.max(0, mu)), si = (v * texW + u) * 4, di = (py * W + px) * 4;
            o[di] = tex[si] * shade; o[di + 1] = tex[si + 1] * shade; o[di + 2] = tex[si + 2] * shade; o[di + 3] = 255;
          }
        }
        layerCtx.putImageData(out, 0, 0);
        layerKey = key;
      }
      ctx!.drawImage(layer, 0, 0, w, h);
      if (moving) { window.clearTimeout(upgrade); upgrade = window.setTimeout(invalidate, 180); }
      return true;
    }

    const draw = () => {
      frame = 0;
      if (dead || !(visible || (visible = onScreen()))) return;
      const { w, h, scale, cx, cy } = metrics();
      const dpr = Math.min(window.devicePixelRatio || 1, w < 600 ? 1.5 : 2);
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const dark = document.documentElement.classList.contains('dark');
      const cam = camera(yaw, pitch);
      const project = (p: V) => { const r = add(p, ORIGIN, -1); return { x: cx + dot(r, cam.right) * scale, y: cy - dot(r, cam.up) * scale, ok: unoccluded(p, cam.depth) }; };

      // Ellipsoid limb (orthographic silhouette) as the backdrop and fallback.
      const m = (u: V, v: V) => u[0] * v[0] * A * A + u[1] * v[1] * A * A + u[2] * v[2] * B * B;
      const xx = m(cam.right, cam.right), xy = -m(cam.right, cam.up), yy = m(cam.up, cam.up), diff = Math.hypot(xx - yy, 2 * xy);
      const centre = project([0, 0, 0]);
      ctx.beginPath();
      ctx.ellipse(centre.x, centre.y, Math.sqrt((xx + yy + diff) / 2) * scale, Math.sqrt((xx + yy - diff) / 2) * scale, 0.5 * Math.atan2(2 * xy, xx - yy), 0, Math.PI * 2);
      ctx.fillStyle = dark ? '#16222b' : '#1d2f3a';
      ctx.fill();
      drawEarth(w, h, scale, cx, cy, cam, dpr);
      ctx.strokeStyle = dark ? 'rgba(180,210,225,.35)' : 'rgba(23,23,23,.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const shown = passes.map((_, i) => i).filter((i) => times[i] <= cursor);
      const sel = selectedRef.current;
      const colour = (p: Pass) => TYPES[p.type][dark ? 'dark' : 'light'];
      const path = (points: V[]) => {
        ctx.beginPath(); let open = false;
        for (const point of points) { const q = project(point); if (!q.ok) { open = false; continue; } if (open) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); open = true; }
        ctx.stroke();
      };

      // Saved-TLE orbits, dashed. Selected pass drawn last and brighter.
      ctx.setLineDash([3, 5]);
      for (const i of shown) { if (i === sel) continue; ctx.strokeStyle = colour(passes[i]); ctx.globalAlpha = 0.22; ctx.lineWidth = 0.8; path(passes[i].orbit as V[]); }
      if (sel !== null) { ctx.strokeStyle = dark ? '#ffffff' : '#171717'; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.4; path(passes[sel].orbit as V[]); }

      ctx.setLineDash([]); ctx.globalAlpha = 1;

      // Denver city reference.
      const home = project(ORIGIN);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(home.x, home.y, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillText('DENVER', home.x + 7, home.y + 3);

      // Capture blips; the most recent days of the scroll replay are slightly larger.
      icons = [];
      const recent = 1.5 * 86400000;
      for (const i of shown) {
        const q = project(passes[i].intercept as V);
        if (!q.ok) continue;
        const fresh = !reduced.matches && cursor < end && cursor - times[i] < recent;
        ctx.fillStyle = colour(passes[i]);
        ctx.strokeStyle = dark ? 'rgba(10,15,20,.8)' : 'rgba(255,255,255,.95)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(q.x, q.y, i === sel ? 4.2 : fresh ? 3.8 : 2.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (i === sel) { ctx.strokeStyle = dark ? '#ffffff' : '#171717'; ctx.beginPath(); ctx.arc(q.x, q.y, 8, 0, Math.PI * 2); ctx.stroke(); }
        icons.push({ i, x: q.x, y: q.y });
      }

      el.dataset.shown = String(shown.length);
      el.dataset.frames = String(++frames);
      el.dataset.imagery = String(Boolean(tex));
      el.dataset.yaw = yaw.toFixed(3);
      el.dataset.pitch = pitch.toFixed(3);
    };
    // Drawing is gated on the element's real position. The IntersectionObserver only wakes the
    // field up; on a cold load with smooth scrolling its last report can lag the true state.
    const onScreen = () => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight; };
    const invalidate = () => { if (!frame && !dead && (visible || (visible = onScreen()))) frame = requestAnimationFrame(draw); };

    // Time cursor. Scroll mode follows the page like the other fields; Play, All and the
    // scrubber hand control to the visitor.
    let current: Mode = 'scroll', playFrame = 0, playLast = 0;
    const setCursor = (ms: number) => {
      cursor = Math.max(start, Math.min(end, ms));
      setThrough(new Date(cursor).toISOString().slice(0, 10));
      setCursorMs(cursor);
      invalidate();
    };
    const updateScroll = () => {
      if (current !== 'scroll') return;
      if (reduced.matches) { setCursor(end); return; }
      const top = el.getBoundingClientRect().top;
      const raw = Math.max(0, Math.min(1, (window.innerHeight * 0.9 - top) / (window.innerHeight * 0.75)));
      setCursor(start + (end - start) * raw * raw * (3 - 2 * raw));
    };
    const play = (now: number) => {
      playFrame = 0;
      if (dead || current !== 'play') return;
      const dt = playLast ? now - playLast : 16;
      playLast = now;
      setCursor(cursor + ((end - start) * dt) / PLAY_MS);
      if (cursor < end && (visible || (visible = onScreen()))) playFrame = requestAnimationFrame(play);
    };
    control.current = {
      setMode(m) {
        current = m; setModeState(m);
        cancelAnimationFrame(playFrame); playFrame = 0;
        if (m === 'scroll') updateScroll();
        else if (m === 'all') setCursor(end);
        else if (m === 'play') {
          if (reduced.matches) { setCursor(end); return; }
          if (cursor >= end) setCursor(start);
          playLast = 0; playFrame = requestAnimationFrame(play);
        }
      },
      scrub(ms) { current = 'manual'; setModeState('manual'); cancelAnimationFrame(playFrame); playFrame = 0; setCursor(ms); },
    };

    const pick = (clientX: number, clientY: number, touch: boolean) => {
      const box = el.getBoundingClientRect(), x = clientX - box.left, y = clientY - box.top, radius = touch ? 22 : 12;
      let best: { i: number; d: number } | null = null;
      for (const icon of icons) { const d = Math.hypot(icon.x - x, icon.y - y); if (d <= radius && (!best || d < best.d)) best = { i: icon.i, d }; }
      return best?.i ?? null;
    };
    const grab = () => 1 / (2300 * metrics().scale); // ~1:1 for points a few thousand km out
    const capture = (e: PointerEvent) => { try { el.setPointerCapture(e.pointerId); } catch { /* Safari may reject after native scroll. */ } };
    const down = (e: PointerEvent) => {
      lastX = startX = e.clientX; lastY = startY = e.clientY; downAt = performance.now();
      if (e.pointerType === 'touch') { pendingTouch = true; return; }
      dragging = true; capture(e);
    };
    const move = (e: PointerEvent) => {
      if (!dragging && !pendingTouch && e.pointerType === 'mouse') { el.dataset.hover = String(pick(e.clientX, e.clientY, false) !== null); return; }
      if (pendingTouch && !dragging) {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { pendingTouch = false; return; }
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { pendingTouch = false; dragging = true; capture(e); }
      }
      if (!dragging) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) el.dataset.dragging = 'true';
      const k = grab();
      yaw -= (e.clientX - lastX) * k;
      pitch = Math.max(0.12, Math.min(1.25, pitch + (e.clientY - lastY) * k));
      lastX = e.clientX; lastY = e.clientY; lastMove = performance.now();
      invalidate();
    };
    const up = (e: PointerEvent) => {
      const tap = Math.hypot(e.clientX - startX, e.clientY - startY) < 6 && performance.now() - downAt < 400;
      dragging = false; pendingTouch = false; el.dataset.dragging = 'false';
      try { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (tap && e.type === 'pointerup') { const hit = pick(e.clientX, e.clientY, e.pointerType === 'touch'); setSelected(hit); }
    };
    const key = (e: KeyboardEvent) => {
      let used = true;
      if (e.key === 'ArrowLeft') yaw += 0.08;
      else if (e.key === 'ArrowRight') yaw -= 0.08;
      else if (e.key === 'ArrowUp') pitch = Math.min(1.25, pitch + 0.06);
      else if (e.key === 'ArrowDown') pitch = Math.max(0.12, pitch - 0.06);
      else if (e.key === ']' || e.key === '[') {
        const visibleIdx = passes.map((_, i) => i).filter((i) => times[i] <= cursor);
        if (visibleIdx.length) { const at = visibleIdx.indexOf(selectedRef.current ?? -1); setSelected(visibleIdx[(at + (e.key === ']' ? 1 : -1) + visibleIdx.length) % visibleIdx.length]); }
      } else if (e.key === 'Escape') setSelected(null);
      else if (e.key.toLowerCase() === 'r') { yaw = HOME.yaw; pitch = HOME.pitch; }
      else used = false;
      if (used) { e.preventDefault(); invalidate(); }
    };
    resetView.current = () => { yaw = HOME.yaw; pitch = HOME.pitch; invalidate(); };
    redraw.current = invalidate;

    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting || onScreen(); if (visible) { updateScroll(); invalidate(); if (current === 'play' && cursor < end && !playFrame) { playLast = 0; playFrame = requestAnimationFrame(play); } } else { cancelAnimationFrame(frame); frame = 0; } });
    seen.observe(el);
    const resize = new ResizeObserver(invalidate);
    resize.observe(el);
    const theme = new MutationObserver(invalidate);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('keydown', key);
    window.addEventListener('scroll', updateScroll, { passive: true });
    reduced.addEventListener('change', updateScroll);
    el.dataset.passes = String(passes.length);
    el.dataset.ready = 'true';
    updateScroll();

    return () => {
      dead = true;
      cancelAnimationFrame(frame); cancelAnimationFrame(playFrame); window.clearTimeout(upgrade);
      control.current = { setMode: () => {}, scrub: () => {} };
      seen.disconnect(); resize.disconnect(); theme.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('keydown', key);
      window.removeEventListener('scroll', updateScroll);
      reduced.removeEventListener('change', updateScroll);
      resetView.current = () => {};
      redraw.current = () => {};
    };
  }, [data]);

  // Redraw when the selection changes (the draw loop reads selectedRef).
  useEffect(() => { if (field.current) field.current.dataset.selected = selected === null ? '' : String(selected); setViewing(false); redraw.current(); }, [selected]);
  useEffect(() => {
    if (!viewing) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setViewing(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [viewing]);

  const pass = data && selected !== null ? data.passes[selected] : null;
  const when = (utc: string) => new Date(utc).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

  const range = data ? [Date.parse(data.range[0]), Date.parse(data.range[1])] : [0, 1];
  const views: [Mode, string][] = [['scroll', 'Scroll'], ['play', 'Play'], ['all', 'All']];
  return <figure className="my-0">
    <div className={styles.toolbar}>
      <span>DENVER / WGS84 <b>{data ? `${data.totals.modeled} PASSES · 14 SEP TO 4 OCT 2026` : 'SATELLITE PASSES'}</b></span>
      <div className={styles.controls} role="group" aria-label="Time control">
        {views.map(([v, l]) => <button key={v} type="button" onClick={() => control.current.setMode(v)} aria-pressed={mode === v} disabled={!data}>{l}</button>)}
      </div>
    </div>
    <div className={styles.stage}>
    <div ref={field} className={styles.field} data-orbit-globe data-ready="false" data-dragging="false" tabIndex={0} role="img"
      aria-label="Isometric WGS84 view over Denver showing every RFPI pass that could be placed, as a dashed predicted orbit and a dot at its predicted position when recording started. Drag or use arrow keys to rotate; tap a dot, or press ] and [ to step through passes; R resets."
      onDoubleClick={() => resetView.current()}>
      {!failed && <canvas ref={canvas} className={styles.canvas} aria-hidden="true" style={{ opacity: data ? 1 : 0 }} />}
      <span className={`${styles.label} ${styles.timeLabel}`} aria-hidden="true">{through ? `Through ${through}` : 'Archive replay'}</span>
      <span className={`${styles.label} ${styles.dragLabel}`} aria-hidden="true">Drag · tap a dot</span>
    </div>
    {pass?.image && viewing && <div className={styles.viewer} role="dialog" aria-label={`Imagery received from ${pass.satellite}`}>
      <div className={styles.viewerBar}>
        <span>{pass.satellite} · {when(pass.utc)} · MSA composite</span>
        <button type="button" onClick={() => setViewing(false)} aria-label="Close imagery">Close</button>
      </div>
      <img src={pass.image.src} width={pass.image.width} height={pass.image.height} alt={`MSA composite decoded by SatDump from the ${pass.satellite} pass on ${when(pass.utc)}`} />
      <p>SatDump MSA composite from the decoded MSU-MR channels, geometry corrected, no map overlay. Black bands are frames lost during reception.</p>
    </div>}
    </div>
    <label className={styles.scrubber}>
      <span className="sr-only">Archive date</span>
      <input type="range" min={range[0]} max={range[1]} step="any" value={data ? Math.round(cursorMs || range[1]) : 1} disabled={!data}
        onChange={(e) => control.current.scrub(Number(e.target.value))} aria-valuetext={through ? `Through ${through}` : undefined} />
      <span aria-hidden="true">{data ? '14 Sep' : ''}</span><span aria-hidden="true">{data ? '4 Oct' : ''}</span>
    </label>
    <figcaption className={styles.caption} aria-live="polite">
      {pass ? <>
        <span><strong>{pass.satellite}</strong> · {when(pass.utc)}<br />{pass.received}. Predicted position {pass.basis === 'scan' ? 'at the first decoded image scan' : 'at the logged recording start'}, {Math.round(pass.altitudeKm)} km above the ellipsoid.</span>
        <span className={styles.captionActions}>
          {pass.image && <button type="button" onClick={() => setViewing((v) => !v)} aria-pressed={viewing}>{viewing ? 'Hide imagery' : 'View imagery'}</button>}
          <button type="button" onClick={() => setSelected(null)}>Clear</button>
        </span>
      </> : <span>{!data ? (failed ? 'The orbit archive could not be loaded.' : 'Loading the pass archive…') : compact ? 'Select a dot to see what the station received.' : `${data.totals.modeled} of the ${data.totals.records} recorded passes had enough saved data to place on the globe. Scroll, press Play, or drag the timeline to replay them, and select a dot to see what the station received.`}</span>}
    </figcaption>
    {!compact && <div className={styles.legend} aria-hidden="true">
      {Object.values(TYPES).map((t) => <span key={t.label}><i style={{ background: t.light }} />{t.label}</span>)}
      <span>Dashed line: predicted orbit</span>
    </div>}
  </figure>;
}
