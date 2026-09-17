'use client';
import { useEffect, useRef } from 'react';

type Api = Awaited<ReturnType<typeof import('./gaussian-renderer').mountGaussian>>;

// The real image-derived Gaussian scene of the received METEOR-M2 4 pass, drawn on the
// page's own light background. No grid, no orbit controls: a fixed view with a few
// degrees of pointer parallax, and a slow approach driven by the page scroll.
export default function GaussianHero({ progress, onReady, onFailure }: { progress: number; onReady: (splats: number) => void; onFailure: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const prog = useRef(progress);
  prog.current = progress;
  const apply = () => { const a = api.current; if (!a) return; const p = prog.current; a.pose(pointer.current.x * 0.06, pointer.current.y * 0.035, 1 - p * 0.18); };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let dead = false;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const b = el.getBoundingClientRect();
      pointer.current = { x: (e.clientX - b.left) / b.width - 0.5, y: (e.clientY - b.top) / b.height - 0.5 };
      apply();
    };
    const onLeave = () => { pointer.current = { x: 0, y: 0 }; apply(); };
    (async () => {
      try {
        const { mountGaussian } = await import('./gaussian-renderer');
        if (dead) return;
        const mounted = await mountGaussian(el, 'm24', () => {}, { grid: false, background: '#f7f5f0', interactive: false, camera: [0.3, -1.7, 4.3], target: [0, 0.1, -0.15], fov: 38 });
        if (dead) { mounted.dispose(); return; }
        api.current = mounted;
        apply();
        el.addEventListener('pointermove', onMove, { passive: true });
        el.addEventListener('pointerleave', onLeave);
        onReady(Number(el.dataset.splats || 0));
      } catch (error) {
        console.error('Gaussian hero unavailable', error);
        onFailure();
      }
    })();
    return () => { dead = true; el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); api.current?.dispose(); api.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { apply(); }, [progress]);
  return <div ref={box} data-gaussian-hero style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />;
}
