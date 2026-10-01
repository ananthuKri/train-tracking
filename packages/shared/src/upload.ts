import { z } from 'zod';
import type { UploadPreviewRow } from './api';
import { checkJourneyDate, parseFlexibleDate } from './dates';
import { explainInvalidTrainNumber, isValidTrainNumber, normaliseTrainToken } from './trainNumber';

export const MAX_UPLOAD_ROWS = 500;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const UPLOAD_EXTENSIONS = ['csv', 'xlsx', 'xls'] as const;

/** Accepted header spellings, compared after lower-casing and stripping non-alphanumerics. */
export const UPLOAD_COLUMN_ALIASES = {
  trainNumber: ['trainnumber', 'trainno', 'train', 'trainnum', 'number', 'trainnbr'],
  journeyDate: ['journeydate', 'date', 'runningdate', 'startdate', 'traveldate', 'dateofjourney', 'doj'],
  email: ['email', 'emailaddress', 'mail', 'recipient', 'recipientemail'],
} as const;

export type UploadColumnKey = keyof typeof UPLOAD_COLUMN_ALIASES;

export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function detectColumns(headers: readonly string[]): Record<UploadColumnKey, string | null> {
  const result: Record<UploadColumnKey, string | null> = { trainNumber: null, journeyDate: null, email: null };
  for (const key of Object.keys(UPLOAD_COLUMN_ALIASES) as UploadColumnKey[]) {
    const aliases: readonly string[] = UPLOAD_COLUMN_ALIASES[key];
    result[key] = headers.find((h) => aliases.includes(normaliseHeader(h))) ?? null;
  }
  return result;
}

const emailCheck = z.email();

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
};

export interface ValidateUploadOptions {
  defaultJourneyDate: string;
  now?: Date;
  maxRows?: number;
}

export interface ValidatedUpload {
  detectedColumns: Record<UploadColumnKey, string | null>;
  rows: UploadPreviewRow[];
  summary: { total: number; valid: number; invalid: number; duplicates: number; truncated: boolean };
}

/**
 * Validate parsed spreadsheet records (header → cell value). Blank rows are skipped.
 * Numeric train cells with 4 digits get their leading zero restored (spreadsheets drop it).
 */
export function validateUploadRows(records: readonly Record<string, unknown>[], options: ValidateUploadOptions): ValidatedUpload {
  const maxRows = options.maxRows ?? MAX_UPLOAD_ROWS;
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const columns = detectColumns(headers);
  const rows: UploadPreviewRow[] = [];
  const seen = new Map<string, number>();
  let duplicates = 0;
  let truncated = false;

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (Object.values(record).every((v) => cellText(v) === '')) continue;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const errors: string[] = [];
    const warnings: string[] = [];
    const rowNumber = i + 2;

    const rawTrainValue = columns.trainNumber ? record[columns.trainNumber] : undefined;
    const rawTrainNumber = cellText(rawTrainValue);
    let trainNumber: string | null = null;
    if (!columns.trainNumber) errors.push('No train number column found (expected train_number, train_no or trainNumber)');
    else if (!rawTrainNumber) errors.push('Train number is missing');
    else {
      let token = normaliseTrainToken(rawTrainNumber.replace(/\.0+$/, ''));
      if (typeof rawTrainValue === 'number' && /^\d{4}$/.test(token)) {
        token = `0${token}`;
        warnings.push(`Leading zero restored: ${rawTrainNumber} → ${token}`);
      }
      if (isValidTrainNumber(token)) trainNumber = token;
      else errors.push(explainInvalidTrainNumber(token));
    }

    const rawDateValue = columns.journeyDate ? record[columns.journeyDate] : undefined;
    const rawJourneyDate = cellText(rawDateValue);
    let journeyDate: string | null = null;
    if (!rawJourneyDate) journeyDate = options.defaultJourneyDate;
    else {
      const parsed = parseFlexibleDate(rawDateValue instanceof Date ? rawDateValue : typeof rawDateValue === 'number' ? rawDateValue : rawJourneyDate);
      if (!parsed) errors.push(`Unrecognised date "${rawJourneyDate}" (use YYYY-MM-DD or DD-MM-YYYY)`);
      else {
        const check = checkJourneyDate(parsed, options.now);
        if (check.ok) journeyDate = parsed;
        else errors.push(check.reason!);
      }
    }

    const rawEmail = columns.email ? cellText(record[columns.email]) : '';
    let email: string | null = null;
    if (rawEmail) {
      const candidate = rawEmail.toLowerCase();
      if (emailCheck.safeParse(candidate).success) email = candidate;
      else errors.push(`Invalid email address "${rawEmail}"`);
    }

    if (trainNumber && journeyDate && errors.length === 0) {
      const key = `${trainNumber}|${journeyDate}`;
      const firstRow = seen.get(key);
      if (firstRow !== undefined) {
        duplicates++;
        warnings.push(`Duplicate of row ${firstRow} — tracked once`);
      } else seen.set(key, rowNumber);
    }

    rows.push({
      rowNumber,
      rawTrainNumber,
      trainNumber,
      rawJourneyDate,
      journeyDate,
      rawEmail,
      email,
      valid: errors.length === 0,
      errors,
      warnings,
    });
  }

  const valid = rows.filter((r) => r.valid).length;
  return {
    detectedColumns: columns,
    rows,
    summary: { total: rows.length, valid, invalid: rows.length - valid, duplicates, truncated },
  };
}

/** Unique (trainNumber, journeyDate) pairs from valid rows, in sheet order. */
export function uniqueValidItems(rows: readonly UploadPreviewRow[]): { trainNumber: string; journeyDate: string }[] {
  const seen = new Set<string>();
  const items: { trainNumber: string; journeyDate: string }[] = [];
  for (const row of rows) {
    if (!row.valid || !row.trainNumber || !row.journeyDate) continue;
    const key = `${row.trainNumber}|${row.journeyDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ trainNumber: row.trainNumber, journeyDate: row.journeyDate });
  }
  return items;
}

/** Rows for the downloadable "errors" CSV. */
export function uploadErrorRows(rows: readonly UploadPreviewRow[]): { headers: string[]; rows: string[][] } {
  return {
    headers: ['row', 'train_number', 'journey_date', 'email', 'errors'],
    rows: rows
      .filter((r) => !r.valid)
      .map((r) => [String(r.rowNumber), r.rawTrainNumber, r.rawJourneyDate, r.rawEmail, r.errors.join('; ')]),
  };
}
