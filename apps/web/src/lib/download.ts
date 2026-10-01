import { CSV_BOM } from '@railtrack/shared';

/** Trigger a client-side download of text content. */
export function downloadText(fileName: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV download with a UTF-8 BOM so Excel opens it with the right encoding. */
export function downloadCsv(fileName: string, csv: string): void {
  downloadText(fileName, csv.startsWith(CSV_BOM) ? csv : CSV_BOM + csv, 'text/csv;charset=utf-8');
}
