/** Charts from the approved mockup, drawn as plain SVG. Tooltips use data-tip (escaped HTML). */
import { fmtMoney } from '../lib/format.ts';
import { monthName } from '../money/calc.ts';

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 5 ? 5 : 10) * p;
}

/** Short axis label: 30k, 1.5 lakh, 2 crore. Input in paisa. */
function axisLabel(minor: number): string {
  const tk = minor / 100;
  if (tk >= 1e7) return `${+(tk / 1e7).toFixed(1)} crore`;
  if (tk >= 1e5) return `${+(tk / 1e5).toFixed(1)} lakh`;
  if (tk >= 1e3) return `${+(tk / 1e3).toFixed(1)}k`;
  return String(Math.round(tk));
}

export function IncomeSpendBars({ data, currentMonth }: { data: { month: string; income: number; spent: number }[]; currentMonth: string }) {
  const W = 320, H = 170, L = 40, B = 22, T = 8, ih = H - B - T;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.income, d.spent])));
  const gw = (W - L) / data.length;
  const bw = Math.min(13, gw / 2 - 3);
  const y = (v: number) => T + ih - (v / max) * ih;
  const bar = (v: number, x: number, col: string) => {
    if (v <= 0) return null;
    const top = y(v);
    const r = Math.min(4, (T + ih - top) / 2);
    return <path d={`M${x} ${T + ih}V${top + r}a${r} ${r} 0 0 1 ${r}-${r}h${bw - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${T + ih}z`} fill={col} />;
  };
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income and spending by month">
      {[0, max / 3, (2 * max) / 3, max].map((t) => (
        <g key={t}>
          <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end">{axisLabel(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = L + gw * i + gw / 2;
        const name = monthName(d.month, false);
        return (
          <g key={d.month}>
            <g data-tip={`<b>${name}${d.month === currentMonth ? ' (so far)' : ''}</b><br>Income ${fmtMoney(d.income)}<br>Spending ${fmtMoney(d.spent)}`}>
              {bar(d.income, cx - bw - 1, 'var(--bar)')}
              {bar(d.spent, cx + 1, 'var(--bar-2)')}
              <rect x={cx - gw / 2} y={T} width={gw} height={ih} fill="transparent" />
            </g>
            <text x={cx} y={H - 6} textAnchor="middle">{name}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function TwoLines({ data, a, b, labels }: { data: { month: string; a: number; b: number }[]; a: string; b: string; labels: [string, string] }) {
  const W = 320, H = 170, L = 52, B = 22, T = 10, R = 8, ih = H - B - T, iw = W - L - R, n = data.length;
  const values = data.flatMap((d) => [d.a, d.b]);
  let lo = Math.min(0, ...values);
  let hi = Math.max(1, ...values);
  const span = niceMax(hi - lo);
  hi = lo + span;
  if (lo < 0) lo = -niceMax(-lo);
  const x = (i: number) => (n === 1 ? L + iw / 2 : L + (iw * i) / (n - 1));
  const y = (v: number) => T + ih - ((v - lo) / (hi - lo)) * ih;
  const path = (k: 'a' | 'b') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[k]).toFixed(1)}`).join('');
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  const last = data[n - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labels[0]} and ${labels[1]} over time`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end">{axisLabel(t)}</text>
        </g>
      ))}
      {data.map((d, i) => (i % Math.ceil(n / 6) === 0 || i === n - 1 ? <text key={d.month} x={x(i)} y={H - 6} textAnchor="middle">{monthName(d.month, false)}</text> : null))}
      <path d={path('a')} fill="none" stroke={a} strokeWidth="2" strokeLinejoin="round" />
      <path d={path('b')} fill="none" stroke={b} strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" />
      {last && (
        <>
          <circle cx={x(n - 1)} cy={y(last.a)} r="4" fill={a} stroke="var(--surface)" strokeWidth="2" />
          <circle cx={x(n - 1)} cy={y(last.b)} r="4" fill={b} stroke="var(--surface)" strokeWidth="2" />
        </>
      )}
      <g id="cross" visibility="hidden">
        <line id="cross-l" y1={T} y2={T + ih} stroke="var(--faint)" strokeDasharray="3 3" />
        <circle id="cross-a" r="4" fill={a} stroke="var(--surface)" strokeWidth="2" />
        <circle id="cross-b" r="4" fill={b} stroke="var(--surface)" strokeWidth="2" />
      </g>
      {data.map((d, i) => {
        const w = n === 1 ? iw : iw / (n - 1);
        return (
          <rect
            key={d.month}
            className="hit"
            x={x(i) - w / 2}
            y={T}
            width={w}
            height={ih}
            fill="transparent"
            data-tip={`<b>${monthName(d.month)} ${d.month.slice(0, 4)}</b><br>${labels[0]} ${fmtMoney(d.a)}<br>${labels[1]} ${fmtMoney(d.b)}`}
            data-cx={x(i)}
            data-ya={y(d.a)}
            data-yb={y(d.b)}
          />
        );
      })}
    </svg>
  );
}

export function Heatmap({ month, values, today }: { month: string; values: number[]; today: string }) {
  const [yy, mm] = month.split('-').map(Number) as [number, number];
  const firstDow = new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay(); // 0 = Sunday
  const offset = (firstDow + 1) % 7; // week starts on Saturday
  const max = Math.max(...values);
  const bin = (v: number) => (v <= 0 ? 0 : max <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const busiest = values.indexOf(max);
  return (
    <>
      <div className="heat" role="img" aria-label={`Daily spending for ${monthName(month)}`}>
        {['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
          <span key={d} className="dow">{d}</span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {values.map((v, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          if (date > today) return <span key={i} className="cell future">{i + 1}</span>;
          const b = bin(v);
          return (
            <span key={i} className="cell" style={{ background: `var(--heat-${b})`, color: b >= 3 ? 'var(--surface)' : 'var(--ink)' }} data-tip={`<b>${i + 1} ${monthName(month, false)}</b><br>Spent ${fmtMoney(v)}`}>
              {i + 1}
            </span>
          );
        })}
      </div>
      <div className="heat-legend">
        <span>Less</span>
        {[1, 2, 3, 4].map((b) => (
          <i key={b} style={{ background: `var(--heat-${b})` }} />
        ))}
        <span>More</span>
        {max > 0 && <span style={{ marginLeft: 'auto' }}>Busiest: {busiest + 1} {monthName(month, false)}, {fmtMoney(max)}</span>}
      </div>
    </>
  );
}

export function CategoryBars({ items, onPick }: { items: { id: string; name: string; value: number; colour: string }[]; onPick?: (id: string) => void }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="cat-bars">
      {items.map((c) => (
        <button key={c.id} className="cat-bar" onClick={() => onPick?.(c.id)} data-tip={`<b>${esc(c.name)}</b><br>${fmtMoney(c.value)} · ${Math.round((c.value / total) * 100)}% of spending`}>
          <span className="name">
            <span className="swatch" style={{ background: c.colour }} />
            {c.name}
          </span>
          <span className="amt num">
            {fmtMoney(c.value)}
            <small>{Math.round((c.value / total) * 100)}%</small>
          </span>
          <span className="trackline">
            <span style={{ width: `${(c.value / max) * 100}%`, background: c.colour }} />
          </span>
        </button>
      ))}
    </div>
  );
}
