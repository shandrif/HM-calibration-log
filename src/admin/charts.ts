// Small canvas charts for the branded Excel exports (drawn at 2x, embedded as PNG).

export const BRAND = {
  ink: '#1D1B17',
  tan: '#D4B38B',
  tanDeep: '#A9793B',
  teal: '#84C6B2',
  tealDeep: '#2B8A74',
  red: '#C2564A',
  amber: '#D9A441',
  bg: '#F5EDE3',
  surface: '#FFFBF6',
  line: '#EFE4D6',
  muted: '#6E665C',
};
export const BEAN_COLOR = { ethiopian: BRAND.tanDeep, brazilian: BRAND.tealDeep, espresso: BRAND.ink } as const;

const FONT = "'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', sans-serif";
const S = 2; // pixel ratio

export interface Chart {
  png: string; // data URL
  w: number; // CSS px
  h: number;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w * S;
  c.height = h * S;
  const g = c.getContext('2d')!;
  g.scale(S, S);
  // card background
  g.fillStyle = BRAND.surface;
  roundRect(g, 0, 0, w, h, 14);
  g.fill();
  g.strokeStyle = BRAND.line;
  g.lineWidth = 1;
  roundRect(g, 0.5, 0.5, w - 1, h - 1, 14);
  g.stroke();
  return { c, g };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function title(g: CanvasRenderingContext2D, text: string, sub?: string) {
  g.fillStyle = BRAND.ink;
  g.font = `700 15px ${FONT}`;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillText(text, 18, 30);
  if (sub) {
    g.fillStyle = BRAND.muted;
    g.font = `500 11px ${FONT}`;
    g.fillText(sub, 18, 47);
  }
}

function legend(g: CanvasRenderingContext2D, items: { name: string; color: string }[], x: number, y: number) {
  g.font = `600 11px ${FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  let cx = x;
  for (const it of items) {
    g.fillStyle = it.color;
    roundRect(g, cx, y - 5, 10, 10, 3);
    g.fill();
    g.fillStyle = BRAND.muted;
    g.fillText(it.name, cx + 15, y);
    cx += 15 + g.measureText(it.name).width + 16;
  }
}

const ellipsis = (g: CanvasRenderingContext2D, s: string, max: number) => {
  if (g.measureText(s).width <= max) return s;
  while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
};

/** Horizontal bars, optionally stacked by series. Values in display units. */
export function hBars(opts: {
  title: string;
  sub?: string;
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  fmt: (v: number) => string;
  w?: number;
  max?: number;
}): Chart {
  const w = opts.w ?? 560;
  const rowH = 26;
  const top = 64;
  const h = Math.max(150, top + opts.labels.length * rowH + 40);
  const { c, g } = canvas(w, h);
  title(g, opts.title, opts.sub);
  const labelW = 150;
  const x0 = 18 + labelW;
  const valW = 70;
  const barW = w - x0 - valW - 18;
  const totals = opts.labels.map((_, i) => opts.series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = opts.max ?? Math.max(1e-9, ...totals);
  opts.labels.forEach((lab, i) => {
    const y = top + i * rowH;
    g.font = `500 12px ${FONT}`;
    g.fillStyle = BRAND.ink;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(ellipsis(g, lab, labelW - 10), 18, y + rowH / 2);
    // track
    g.fillStyle = 'rgba(29,27,23,0.05)';
    roundRect(g, x0, y + 6, barW, rowH - 12, 5);
    g.fill();
    let x = x0;
    g.save();
    roundRect(g, x0, y + 6, barW, rowH - 12, 5);
    g.clip();
    for (const s of opts.series) {
      const v = s.values[i] || 0;
      const bw = (v / max) * barW;
      g.fillStyle = s.color;
      g.fillRect(x, y + 6, bw, rowH - 12);
      x += bw;
    }
    g.restore();
    g.font = `700 12px ${FONT}`;
    g.fillStyle = BRAND.ink;
    g.textAlign = 'right';
    g.fillText(opts.fmt(totals[i]), w - 18, y + rowH / 2);
  });
  if (opts.series.length > 1) legend(g, opts.series, 18, h - 18);
  return { png: c.toDataURL('image/png'), w, h };
}

/** Vertical grouped bars (e.g. per bean). */
export function vBars(opts: {
  title: string;
  sub?: string;
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  fmt: (v: number) => string;
  w?: number;
  h?: number;
  max?: number;
}): Chart {
  const w = opts.w ?? 560;
  const h = opts.h ?? 300;
  const { c, g } = canvas(w, h);
  title(g, opts.title, opts.sub);
  const top = 70;
  const bottom = h - 56;
  const left = 24;
  const right = w - 18;
  const max = opts.max ?? Math.max(1e-9, ...opts.series.flatMap((s) => s.values));
  // grid
  g.strokeStyle = BRAND.line;
  g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const y = bottom - ((bottom - top) * k) / 4;
    g.beginPath();
    g.moveTo(left, y + 0.5);
    g.lineTo(right, y + 0.5);
    g.stroke();
  }
  const groupW = (right - left) / opts.labels.length;
  const n = opts.series.length;
  const barW = Math.min(46, (groupW - 24) / n);
  opts.labels.forEach((lab, i) => {
    const gx = left + i * groupW + (groupW - barW * n - 6 * (n - 1)) / 2;
    opts.series.forEach((s, si) => {
      const v = s.values[i] || 0;
      const bh = (v / max) * (bottom - top);
      const x = gx + si * (barW + 6);
      g.fillStyle = s.color;
      roundRect(g, x, bottom - bh, barW, Math.max(bh, 0.01), 6);
      g.fill();
      g.fillStyle = BRAND.ink;
      g.font = `700 11px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillText(opts.fmt(v), x + barW / 2, bottom - bh - 4);
    });
    g.fillStyle = BRAND.muted;
    g.font = `600 12px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(ellipsis(g, lab, groupW - 8), left + i * groupW + groupW / 2, bottom + 8);
  });
  if (n > 1) legend(g, opts.series, 18, h - 16);
  return { png: c.toDataURL('image/png'), w, h };
}

/** Donut with legend and share %. */
export function donut(opts: { title: string; sub?: string; parts: { name: string; color: string; value: number }[]; fmt: (v: number) => string; center?: string; w?: number }): Chart {
  const w = opts.w ?? 560;
  const h = 260;
  const { c, g } = canvas(w, h);
  title(g, opts.title, opts.sub);
  const total = opts.parts.reduce((a, p) => a + p.value, 0);
  const cx = 120;
  const cy = 155;
  const r = 78;
  let a = -Math.PI / 2;
  if (total <= 0) {
    g.strokeStyle = BRAND.line;
    g.lineWidth = 26;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (const p of opts.parts) {
    if (total <= 0 || p.value <= 0) continue;
    const da = (p.value / total) * Math.PI * 2;
    g.strokeStyle = p.color;
    g.lineWidth = 26;
    g.beginPath();
    g.arc(cx, cy, r, a + 0.015, a + da - 0.015);
    g.stroke();
    a += da;
  }
  g.fillStyle = BRAND.ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 18px ${FONT}`;
  g.fillText(opts.center ?? opts.fmt(total), cx, cy - 6);
  g.fillStyle = BRAND.muted;
  g.font = `500 11px ${FONT}`;
  g.fillText('total', cx, cy + 14);
  // legend
  let y = 96;
  for (const p of opts.parts) {
    g.fillStyle = p.color;
    roundRect(g, 240, y - 7, 14, 14, 4);
    g.fill();
    g.textAlign = 'left';
    g.fillStyle = BRAND.ink;
    g.font = `600 13px ${FONT}`;
    g.fillText(p.name, 262, y);
    g.textAlign = 'right';
    g.font = `700 13px ${FONT}`;
    g.fillText(opts.fmt(p.value), w - 90, y);
    g.fillStyle = BRAND.muted;
    g.font = `600 12px ${FONT}`;
    g.fillText(total > 0 ? `${Math.round((p.value / total) * 100)}%` : '–', w - 22, y);
    y += 34;
  }
  return { png: c.toDataURL('image/png'), w, h };
}

/** The ½M app tile as a PNG for the workbook header. */
export function logoPng(size = 64): string {
  const c = document.createElement('canvas');
  c.width = c.height = size * S;
  const g = c.getContext('2d')!;
  g.scale(S, S);
  g.fillStyle = BRAND.ink;
  roundRect(g, 0, 0, size, size, size * 0.25);
  g.fill();
  g.textBaseline = 'alphabetic';
  g.fillStyle = BRAND.tan;
  g.font = `700 ${size * 0.27}px ${FONT}`;
  g.fillText('½', size * 0.14, size * 0.47);
  g.fillStyle = BRAND.bg;
  g.font = `700 ${size * 0.47}px ${FONT}`;
  g.fillText('M', size * 0.34, size * 0.76);
  return c.toDataURL('image/png');
}
