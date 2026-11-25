// Branded Excel exports: a Summary sheet (header, KPI tiles, charts, notes) plus formatted data sheets.
import type { Chart } from './charts';
import { BRAND, logoPng } from './charts';

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();

export type Tone = 'eth' | 'bra' | 'esp' | 'good' | 'bad' | 'plain';
const TONE: Record<Tone, { fill: string; ink: string }> = {
  eth: { fill: '#F3E6D4', ink: BRAND.tanDeep },
  bra: { fill: '#DDF0EA', ink: BRAND.tealDeep },
  esp: { fill: '#E9E5DF', ink: BRAND.ink },
  good: { fill: '#DDF0EA', ink: BRAND.tealDeep },
  bad: { fill: '#F6DEDA', ink: BRAND.red },
  plain: { fill: '#FFFBF6', ink: BRAND.ink },
};

export interface Kpi {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}

export interface Col {
  header: string;
  key: string;
  width?: number;
  /** Excel number format, e.g. '#,##0.0 "g"' or '0%'. */
  fmt?: string;
  /** in-cell data bar colour */
  bar?: string;
  /** red → amber → green colour scale (for 0–1 percentages) */
  scale?: 'goodHigh' | 'goodLow';
  /** colour the text of the row by this bean key column */
  bean?: boolean;
}

export interface DataSheet {
  name: string;
  title: string;
  columns: Col[];
  rows: Record<string, string | number | null | undefined>[];
  /** key of a column holding 'ethiopian' | 'brazilian' | 'espresso' to tint the row's first cells */
  beanKey?: string;
}

export interface Report {
  file: string;
  title: string; // e.g. "Bean waste"
  period: string;
  filters?: string;
  kpis: Kpi[];
  charts: Chart[];
  notes?: string[];
  sheets: DataSheet[];
}

const BEAN_INK: Record<string, string> = { ethiopian: BRAND.tanDeep, brazilian: BRAND.tealDeep, espresso: BRAND.ink };

export async function exportReport(r: Report) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HM Calibration Log';
  wb.created = new Date();
  const font = 'Calibri';
  const logo = wb.addImage({ base64: logoPng(64), extension: 'png' });
  const generated = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const brandHeader = (ws: import('exceljs').Worksheet, lastCol: number, heading: string) => {
    for (let row = 1; row <= 3; row++) {
      ws.getRow(row).height = row === 2 ? 26 : 18;
      for (let col = 1; col <= lastCol; col++) ws.getCell(row, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.ink) } };
    }
    ws.addImage(logo, { tl: { col: 0.15, row: 0.2 }, ext: { width: 52, height: 52 } });
    const t = ws.getCell(1, 2);
    t.value = 'HALF MILLION · CALIBRATION LOG';
    t.font = { name: font, size: 9, bold: true, color: { argb: argb(BRAND.tan) } };
    const h = ws.getCell(2, 2);
    h.value = heading;
    h.font = { name: font, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    const s = ws.getCell(3, 2);
    s.value = `${r.period}  ·  generated ${generated} (Riyadh)${r.filters ? '  ·  filtered: ' + r.filters : ''}`;
    s.font = { name: font, size: 9, color: { argb: 'FFCFC6BA' } };
    // tan accent line
    ws.getRow(4).height = 4;
    for (let col = 1; col <= lastCol; col++) ws.getCell(4, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.tan) } };
  };

  // ---------------------------------------------------------------- Summary
  const COLS = 12;
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }], properties: { tabColor: { argb: argb(BRAND.ink) } } });
  sum.columns = Array.from({ length: COLS }, () => ({ width: 12.5 }));
  for (let col = 1; col <= COLS + 2; col++) sum.getColumn(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.bg) } };
  brandHeader(sum, COLS, r.title);

  // KPI tiles: 4 per row, each 3 columns wide × 3 rows
  let row = 6;
  const tileCols = [1, 4, 7, 10];
  r.kpis.forEach((k, i) => {
    const c0 = tileCols[i % 4] + (i % 4 === 0 ? 0 : 0);
    if (i && i % 4 === 0) row += 4;
    const tone = TONE[k.tone ?? 'plain'];
    const c1 = c0 + 2;
    for (let rr = row; rr < row + 3; rr++)
      for (let cc = c0; cc <= c1; cc++) {
        const cell = sum.getCell(rr, cc);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(tone.fill) } };
      }
    sum.mergeCells(row, c0, row, c1);
    sum.mergeCells(row + 1, c0, row + 1, c1);
    sum.mergeCells(row + 2, c0, row + 2, c1);
    const l = sum.getCell(row, c0);
    l.value = k.label.toUpperCase();
    l.font = { name: font, size: 8, bold: true, color: { argb: argb(tone.ink) } };
    l.alignment = { vertical: 'bottom', indent: 1 };
    const v = sum.getCell(row + 1, c0);
    v.value = k.value;
    v.font = { name: font, size: 20, bold: true, color: { argb: argb(BRAND.ink) } };
    v.alignment = { vertical: 'middle', indent: 1 };
    const s = sum.getCell(row + 2, c0);
    s.value = k.sub ?? '';
    s.font = { name: font, size: 9, color: { argb: argb(BRAND.muted) } };
    s.alignment = { vertical: 'top', indent: 1, wrapText: true };
  });
  for (let rr = 6; rr <= row + 2; rr++) {
    const rel = (rr - 6) % 4;
    sum.getRow(rr).height = rel === 0 ? 20 : rel === 1 ? 30 : rel === 2 ? 26 : 10;
  }
  row += 4;

  // charts: narrow ones two per row (6 columns each), wide ones across the full 12 columns
  const colPx = 12.5 * 7 + 5;
  let chartRow = row;
  const place = (list: Chart[], span: number) => {
    let maxH = 0;
    list.forEach((ch, j) => {
      const scale = Math.min(1, (colPx * span - 12) / ch.w);
      const w = ch.w * scale;
      const h = ch.h * scale;
      maxH = Math.max(maxH, h);
      const id = wb.addImage({ base64: ch.png, extension: 'png' });
      sum.addImage(id, { tl: { col: j * span + 0.08, row: chartRow - 1 + 0.2 }, ext: { width: w, height: h } });
    });
    chartRow += Math.ceil(maxH / 20) + 1;
  };
  const narrow = r.charts.filter((c) => c.w <= 700);
  const wide = r.charts.filter((c) => c.w > 700);
  for (let i = 0; i < narrow.length; i += 2) place(narrow.slice(i, i + 2), 6);
  for (const w of wide) place([w], 12);
  row = chartRow + 1;

  if (r.notes?.length) {
    const n = sum.getCell(row, 1);
    n.value = 'NOTES';
    n.font = { name: font, size: 8, bold: true, color: { argb: argb(BRAND.muted) } };
    row++;
    for (const t of r.notes) {
      sum.mergeCells(row, 1, row, COLS);
      const c = sum.getCell(row, 1);
      c.value = '•  ' + t;
      c.font = { name: font, size: 9, color: { argb: argb(BRAND.muted) } };
      c.alignment = { wrapText: true, vertical: 'top' };
      sum.getRow(row).height = 24;
      row++;
    }
  }
  sum.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ---------------------------------------------------------------- data sheets
  for (const d of r.sheets) {
    const ws = wb.addWorksheet(d.name, { views: [{ state: 'frozen', ySplit: 6, xSplit: 1, showGridLines: false }], properties: { tabColor: { argb: argb(BRAND.tan) } } });
    ws.columns = d.columns.map((c) => ({ key: c.key, width: c.width ?? Math.max(10, c.header.length + 2) }));
    brandHeader(ws, d.columns.length, d.title);
    const hr = ws.getRow(6);
    hr.height = 30;
    d.columns.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: font, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb('#3A342D') } };
      cell.alignment = { vertical: 'middle', horizontal: c.fmt || c.scale ? 'right' : 'left', wrapText: true, indent: 1 };
      cell.border = { bottom: { style: 'medium', color: { argb: argb(BRAND.tan) } } };
    });
    d.rows.forEach((rec, ri) => {
      const xr = ws.getRow(7 + ri);
      xr.height = 20;
      d.columns.forEach((c, i) => {
        const cell = xr.getCell(i + 1);
        const v = rec[c.key];
        cell.value = v === undefined || v === '' ? null : (v as string | number | null);
        cell.font = { name: font, size: 10, color: { argb: argb(BRAND.ink) }, bold: i === 0 };
        if (c.bean && typeof v === 'string') cell.font = { name: font, size: 10, bold: true, color: { argb: argb(BEAN_INK[v.toLowerCase()] ?? BRAND.ink) } };
        if (c.fmt) cell.numFmt = c.fmt;
        cell.alignment = { vertical: 'middle', horizontal: c.fmt || c.scale ? 'right' : 'left', indent: 1 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 ? argb('#FBF6EF') : 'FFFFFFFF' } };
        cell.border = { bottom: { style: 'thin', color: { argb: argb(BRAND.line) } } };
      });
    });
    const last = 6 + d.rows.length;
    if (d.rows.length) {
      ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: d.columns.length } };
      d.columns.forEach((c, i) => {
        const col = ws.getColumn(i + 1).letter;
        const ref = `${col}7:${col}${last}`;
        if (c.bar)
          ws.addConditionalFormatting({
            ref,
            rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: argb(c.bar) }, gradient: false } as never],
          });
        if (c.scale)
          ws.addConditionalFormatting({
            ref,
            rules: [
              {
                type: 'colorScale',
                priority: 1,
                cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 0.6 }, { type: 'num', value: 1 }],
                color:
                  c.scale === 'goodHigh'
                    ? [{ argb: 'FFF2C7C1' }, { argb: 'FFF7E3BE' }, { argb: 'FFCBEBDF' }]
                    : [{ argb: 'FFCBEBDF' }, { argb: 'FFF7E3BE' }, { argb: 'FFF2C7C1' }],
              } as never,
            ],
          });
      });
    } else {
      const c = ws.getCell(7, 1);
      c.value = 'No data in this period.';
      c.font = { name: font, size: 10, italic: true, color: { argb: argb(BRAND.muted) } };
    }
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: '6:6' };
  }

  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = r.file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
