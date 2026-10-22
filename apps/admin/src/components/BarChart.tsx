'use client';
import { useState } from 'react';
import { formatDay } from '@eventseva/app-shared';
import { chartScale } from '@/lib/labels';
import styles from './BarChart.module.css';

interface Point {
  day: string;
  bookings: number;
}

const W = 640;
const H = 220;
const PAD = { top: 16, right: 8, bottom: 28, left: 32 };

/** Bookings per day as plain SVG bars, with a hover/focus tooltip and a table for screen readers. */
export function BarChart({ data, title }: { data: Point[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const { max, ticks } = chartScale(data.map((d) => d.bookings));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.min(28, slot - 6);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const total = data.reduce((sum, d) => sum + d.bookings, 0);
  const active = hover === null ? null : data[hover];

  return (
    <figure className={styles.figure}>
      <figcaption className="sr-only">
        {title}: {total} bookings in total.
      </figcaption>
      <div className={styles.wrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label={`${title}. ${total} bookings in total.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? styles.base : styles.grid} />
              <text x={PAD.left - 8} y={y(t)} className={styles.tick} textAnchor="end" dominantBaseline="middle">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            const h = Math.max(0, y(0) - y(d.bookings));
            const r = Math.min(4, h / 2, barW / 2);
            return (
              <g
                key={d.day}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                className={styles.barGroup}
                aria-label={`${formatDay(d.day)}: ${d.bookings} bookings`}
              >
                {/* Hit target wider and taller than the bar. */}
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                {h > 0 ? <path d={barPath(x, y(0), barW, h, r)} className={hover === i ? styles.barActive : styles.bar} /> : null}
                {i % 2 === data.length % 2 || data.length <= 7 ? (
                  <text x={x + barW / 2} y={H - 8} className={styles.tick} textAnchor="middle">
                    {Number(d.day.slice(8))}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {active && hover !== null ? (
          <div
            className={styles.tooltip}
            style={{ left: `${((PAD.left + hover * slot + slot / 2) / W) * 100}%`, top: `${(y(active.bookings) / H) * 100}%` }}
            aria-hidden="true"
          >
            <span className={styles.tooltipValue}>{active.bookings}</span> bookings
            <span className={styles.tooltipDay}>{formatDay(active.day, 'en', true)}</span>
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Bookings</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{formatDay(d.day)}</td>
              <td>{d.bookings}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A bar with rounded top corners, square at the baseline. */
function barPath(x: number, base: number, w: number, h: number, r: number) {
  const top = base - h;
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}
