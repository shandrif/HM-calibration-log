import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import type { Check, Batch, Down, StoreInfo } from '../../shared/config';
import type { Strings } from './i18n';
import { ReportPages } from '../components/Report';

/** Renders the branded report off-screen, captures each A4 page and assembles a PDF on the device. */
export async function buildPdf(opts: { t: Strings; lang: 'en' | 'ar'; store: StoreInfo; day: string; batches: Batch[]; checks?: Check[]; downs?: Down[] }): Promise<File> {
  const [{ domToJpeg }, { PDFDocument }] = await Promise.all([import('modern-screenshot'), import('pdf-lib')]);
  const host = document.createElement('div');
  host.className = 'pdf-host';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(createElement(ReportPages, { ...opts, generatedAt: Date.now() }));
    await new Promise((r) => setTimeout(r, 60));
    await document.fonts.ready;
    const pages = [...host.querySelectorAll<HTMLElement>('.pdf-page')];
    const pdf = await PDFDocument.create();
    pdf.setTitle(`HM Calibration Log — ${opts.store.code} — ${opts.day}`);
    pdf.setCreator('HM Calibration Log');
    for (const page of pages) {
      // first capture warms font/image caches in Safari; second is the real one
      if (page === pages[0]) await domToJpeg(page, { scale: 0.2 });
      const url = await domToJpeg(page, { scale: 2, quality: 0.9, backgroundColor: '#FFFFFF' });
      const bytes = await (await fetch(url)).arrayBuffer();
      const img = await pdf.embedJpg(bytes);
      const p = pdf.addPage([595.28, 841.89]);
      p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    const out = await pdf.save();
    return new File([out as BlobPart], `HM-Calibration-${opts.store.code}-${opts.day}.pdf`, { type: 'application/pdf' });
  } finally {
    root.unmount();
    host.remove();
  }
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function canShareFile(file: File) {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}
