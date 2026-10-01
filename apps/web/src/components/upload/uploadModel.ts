import {
  CSV_BOM,
  MAX_UPLOAD_BYTES,
  UPLOAD_EXTENSIONS,
  toCsv,
  uploadErrorRows,
  type UploadPreviewRow,
} from '@railtrack/shared';

/** CSV (with BOM for Excel) listing every invalid row and why — generated in the browser. */
export function buildErrorCsv(rows: readonly UploadPreviewRow[]): string {
  const { headers, rows: errorRows } = uploadErrorRows(rows);
  return CSV_BOM + toCsv(headers, errorRows);
}

export function errorCsvFileName(sourceName: string): string {
  const base = sourceName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'upload';
  return `${base}-errors.csv`;
}

export type FileCheck = { ok: true } | { ok: false; reason: string };

/** Client-side pre-check before uploading (the server validates again). */
export function checkUploadFile(file: Pick<File, 'name' | 'size'>, maxBytes: number = MAX_UPLOAD_BYTES): FileCheck {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, reason: `“${file.name}” is not supported. Upload a .csv, .xlsx or .xls file.` };
  }
  if (file.size === 0) return { ok: false, reason: `“${file.name}” is empty.` };
  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`,
    };
  }
  return { ok: true };
}

/** Unique recipient emails found in valid rows (used to prefill the report composer). */
export function emailsFromRows(rows: readonly UploadPreviewRow[]): string[] {
  return [...new Set(rows.filter((r) => r.valid && r.email).map((r) => r.email!))];
}
