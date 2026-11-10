"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Daily line chart: one y-axis, 2px lines, a crosshair that snaps to the nearest day with a
 * tooltip listing every series, keyboard support (arrow keys), labels at the line ends, a
 * legend, and a table view. Colours are the validated categorical slots 1-4 (light mode);
 * two of them are under 3:1 contrast, so the end labels and the table view carry identity.
 */

export type Series = { key: string; label: string; color: string; values: number[] };

const H = 240; // plot height
const PAD = { top: 12, right: 92, bottom: 28, left: 40 };

function niceMax(max: number) {
  if (max <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(max));
  const f = max / step;
  return (f <= 2 ? 2 : f <= 5 ? 5 : 10) * step;
}

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

export function LineChart({ days, series, title }: { days: string[]; series: Series[]; title: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = width < 520;
  const pad = { ...PAD, right: narrow ? 12 : PAD.right };
  const plotW = width - pad.left - pad.right;
  const yMax = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => pad.left + (days.length <= 1 ? plotW / 2 : (i * plotW) / (days.length - 1));
  const y = (v: number) => pad.top + H - (v / yMax) * H;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * yMax));
  const labelEvery = Math.max(1, Math.ceil(days.length / (narrow ? 4 : 7)));

  // End labels, nudged apart so they never overlap (at least 14px between centres).
  const endLabels = useMemo(() => {
    const last = days.length - 1;
    const items = series.map((s) => ({ s, y: y(s.values[last] ?? 0) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
    // If the stack runs below the plot (lines ending at 0), push it back up from the bottom.
    const bottom = PAD.top + H;
    if (items.length && items[items.length - 1].y > bottom) {
      items[items.length - 1].y = bottom;
      for (let i = items.length - 2; i >= 0; i--) if (items[i + 1].y - items[i].y < 14) items[i].y = items[i + 1].y - 14;
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, days.length, yMax]);

  const pick = (clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const px = clientX - r.left - pad.left;
    const i = Math.round((px / plotW) * (days.length - 1));
    setActive(Math.min(days.length - 1, Math.max(0, i)));
  };

  const tooltipLeft = active === null ? 0 : Math.min(Math.max(x(active) + 12, 0), width - 180);
  const flip = active !== null && x(active) + 190 > width;

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <figcaption className="font-medium">{title}</figcaption>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
          <li>
            <button type="button" className="text-brand hover:underline" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
              {showTable ? "Show chart" : "Show as table"}
            </button>
          </li>
        </ul>
      </div>

      {showTable ? (
        <div className="max-h-80 overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Day</th>
                {series.map((s) => <th key={s.key} className="px-3 py-2 text-right font-medium">{s.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {days.map((d, i) => (
                <tr key={d}>
                  <td className="px-3 py-1.5">{fmtDay(d, { weekday: "short", month: "short", day: "numeric" })}</td>
                  {series.map((s) => <td key={s.key} className="px-3 py-1.5 text-right tabular-nums">{s.values[i]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={wrap}
          className="relative select-none outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          tabIndex={0}
          role="img"
          aria-label={`${title}. Use the left and right arrow keys to read each day, or show the table.`}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((a) => Math.min(days.length - 1, (a ?? -1) + 1));
            else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? days.length) - 1));
            else if (e.key === "Escape") setActive(null);
            else return;
            e.preventDefault();
          }}
        >
          <svg width={width} height={H + pad.top + pad.bottom} className="block overflow-visible" aria-hidden>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="#ecebe7" strokeWidth={1} />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[#6b6a66] text-[11px] tabular-nums">{t}</text>
              </g>
            ))}
            {days.map((d, i) =>
              // Every nth day plus the last; drop one that would crowd the last label.
              i === days.length - 1 || (i % labelEvery === 0 && x(days.length - 1) - x(i) >= 52) ? (
                <text key={d} x={x(i)} y={pad.top + H + 18} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="fill-[#6b6a66] text-[11px]">
                  {fmtDay(d)}
                </text>
              ) : null,
            )}
            {series.map((s) => (
              <polyline
                key={s.key}
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {!narrow &&
              endLabels.map(({ s, y: ly }) => (
                <text key={s.key} x={width - pad.right + 8} y={ly} dy="0.32em" className="fill-[#3d3c39] text-[11px]">
                  {s.label} {s.values[days.length - 1]}
                </text>
              ))}
            {active !== null && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + H} stroke="#a3a29d" strokeWidth={1} />
                {series.map((s) => (
                  <circle key={s.key} cx={x(active)} cy={y(s.values[active])} r={4.5} fill={s.color} stroke="#fcfcfb" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
          {active !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-44 rounded-lg border border-line bg-surface p-2.5 text-xs shadow-md"
              style={{ left: flip ? x(active) - 188 : tooltipLeft }}
              role="status"
            >
              <div className="mb-1.5 text-muted">{fmtDay(days[active], { weekday: "short", month: "short", day: "numeric" })}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-2 py-0.5">
                  <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                  <span className="font-semibold tabular-nums text-ink">{s.values[active]}</span>
                  <span className="text-muted">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
