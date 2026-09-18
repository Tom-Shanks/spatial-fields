'use client';
import { useState } from 'react';
import styles from './bats.module.css';

// CNN-confirmed calls per local clock hour per night. Values are inline (700 bytes) so
// the figure renders on the server; only the hover tooltip needs the client.
type Night = { key: string; name: string; date: string; off: number[]; byHour: Record<string, number> };
const HOURS = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
const NIGHTS: Night[] = [
  { key: 'n1', name: 'Night 1', date: 'Jun 10–11', off: [6], byHour: { 20: 1, 21: 155, 22: 17, 23: 0, 0: 0, 1: 46, 2: 2, 3: 8, 4: 0, 5: 0, 6: 0 } },
  { key: 'n3', name: 'Night 3', date: 'Jun 13–14', off: [0, 1, 2, 3, 4, 5, 6], byHour: { 20: 0, 21: 3, 22: 4, 23: 7, 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } },
  { key: 'n4', name: 'Night 4', date: 'Jun 14–15', off: [], byHour: { 20: 38, 21: 70, 22: 57, 23: 0, 0: 3, 1: 29, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } },
  { key: 'n5', name: 'Night 5', date: 'Jun 18–19', off: [], byHour: { 20: 0, 21: 47, 22: 68, 23: 50, 0: 39, 1: 12, 2: 60, 3: 30, 4: 435, 5: 123, 6: 2 } },
  { key: 'n6', name: 'Night 6', date: 'Jun 19–20', off: [6], byHour: { 20: 14, 21: 84, 22: 43, 23: 72, 0: 44, 1: 5, 2: 53, 3: 15, 4: 287, 5: 233, 6: 0 } },
  { key: 'n7', name: 'Night 7', date: 'Jun 27', off: [23, 0, 1, 2, 3, 4, 5, 6], byHour: { 20: 24, 21: 62, 22: 0, 23: 0, 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } },
];
const BINS: [number, number][] = [[0, 0], [1, 10], [11, 30], [31, 75], [76, 150], [151, 300], [301, 9999]];
const RAMP = ['transparent', '#dce9df', '#bdd5c3', '#91ba9c', '#639976', '#3f7753', '#244c34'];
const RAMP_DARK = ['transparent', '#1d2d22', '#294333', '#365c45', '#4d795c', '#78a887', '#b7d4be'];
const binOf = (v: number) => BINS.findIndex(([a, b]) => v >= a && v <= b);
const hh = (h: number) => String(h).padStart(2, '0') + ':00';

export default function HourHeatmap() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const W = 1100, L = 118, T = 34, cw = (W - L - 24) / HOURS.length, ch = 54, H = T + NIGHTS.length * ch + 16;
  return <figure className="my-12">
    <div className={styles.heat} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Heatmap of detected bat calls by hour and night">
        <defs><pattern id="bat-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeOpacity=".25" /></pattern></defs>
        {HOURS.map((h, i) => <text key={h} x={L + i * cw + cw / 2} y={T - 12} textAnchor="middle" fill="currentColor" fillOpacity=".55" fontFamily="var(--font-mono)" fontSize="11">{hh(h)}</text>)}
        {NIGHTS.map((n, r) => {
          const y = T + r * ch;
          return <g key={n.key}>
            <text x={L - 14} y={y + ch / 2 - 4} textAnchor="end" fill="currentColor" fontSize="13">{n.name}</text>
            <text x={L - 14} y={y + ch / 2 + 12} textAnchor="end" fill="currentColor" fillOpacity=".55" fontFamily="var(--font-mono)" fontSize="10.5">{n.date}</text>
            {HOURS.map((h, i) => {
              const v = n.byHour[h], off = n.off.includes(h), x = L + i * cw, b = binOf(v);
              return <g key={h}
                onMouseMove={e => { const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text: off ? `${n.name} · ${hh(h)} · not recording` : `${n.name} · ${hh(h)} · ${v} calls` }); }}>
                <rect x={x + 1} y={y + 1} width={cw - 2} height={ch - 2} rx="2" fill={off ? 'url(#bat-hatch)' : RAMP[b]} className={off ? '' : 'dark:hidden'} />
                {!off && <rect x={x + 1} y={y + 1} width={cw - 2} height={ch - 2} rx="2" fill={RAMP_DARK[b]} className="hidden dark:block" />}
                {!off && v > 0 && <text x={x + cw / 2} y={y + ch / 2 + 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="12" fill={b >= 4 ? '#f7f5f0' : 'currentColor'} className={b >= 4 ? 'dark:fill-gray-900' : ''}>{v}</text>}
              </g>;
            })}
          </g>;
        })}
      </svg>
      <div className={styles.tip} data-on={!!tip} style={tip ? { left: tip.x, top: tip.y } : undefined}>{tip?.text}</div>
    </div>
    <div className={styles.legend}>
      {BINS.map(([a, b], i) => <span key={i}><i style={{ background: RAMP[i] }} className="dark:hidden" /><i style={{ background: RAMP_DARK[i] }} className="hidden dark:inline-block" />{i === 0 ? '0' : b >= 9999 ? a + '+' : `${a}–${b}`}</span>)}
      <span><i style={{ background: 'url(#bat-hatch)' }} />not recording</span>
    </div>
    <figcaption className="mt-3 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">FIG. 01 · BatDetect2 call detections by local hour and night. Hatched cells were not recorded. Hover for values.</figcaption>
    <details className="mt-3 text-sm text-gray-500 dark:text-gray-400"><summary className="cursor-pointer">Table view</summary>
      <div className="overflow-x-auto mt-3"><table className="w-full text-sm tabular-nums"><thead><tr><th className="text-left font-medium pr-3">Night</th>{HOURS.map(h => <th key={h} className="text-right font-medium px-1">{hh(h)}</th>)}<th className="text-right font-medium pl-3">Total</th></tr></thead>
        <tbody>{NIGHTS.map(n => <tr key={n.key}><td className="pr-3">{n.name}</td>{HOURS.map(h => <td key={h} className="text-right px-1">{n.off.includes(h) ? 'NR' : n.byHour[h]}</td>)}<td className="text-right pl-3">{Object.values(n.byHour).reduce((a, b) => a + b, 0)}</td></tr>)}</tbody></table></div>
    </details>
  </figure>;
}
