import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { MAX_UPLOAD_ROWS, validateUploadRows, type UploadPreview } from '@railtrack/shared';
import { AppError } from '../lib/errors.ts';

export type UploadFileType = 'csv' | 'xlsx' | 'xls';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const startsWith = (buf: Buffer, magic: number[]) => magic.every((b, i) => buf[i] === b);

export function detectFileType(fileName: string, buffer: Buffer): UploadFileType {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xlsx') {
    if (!startsWith(buffer, ZIP_MAGIC)) throw new AppError('UNSUPPORTED_FILE', 'This .xlsx file is not a valid Excel workbook');
    return 'xlsx';
  }
  if (ext === 'xls') {
    if (!startsWith(buffer, CFB_MAGIC)) throw new AppError('UNSUPPORTED_FILE', 'This .xls file is not a valid Excel 97–2003 workbook');
    return 'xls';
  }
  if (ext === 'csv') {
    if (buffer.includes(0)) throw new AppError('UNSUPPORTED_FILE', 'This .csv file contains binary data');
    return 'csv';
  }
  throw new AppError('UNSUPPORTED_FILE', 'Upload a .csv, .xlsx or .xls file');
}

function parseCsv(buffer: Buffer): Record<string, unknown>[] {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    preview: MAX_UPLOAD_ROWS + 1,
  });
  if (result.errors.some((e) => e.type === 'Delimiter') && result.data.length === 0) {
    throw new AppError('UNSUPPORTED_FILE', 'Could not read the CSV file (no header row or delimiter found)');
  }
  return result.data;
}

function parseWorkbook(buffer: Buffer): { records: Record<string, unknown>[]; sheetName: string | null } {
  let workbook: XLSX.WorkBook;
  try {
    // Only read as many rows as we will accept; no formulas, styles or external links are evaluated.
    workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: MAX_UPLOAD_ROWS + 1, cellFormula: false, cellHTML: false, cellStyles: false });
  } catch {
    throw new AppError('UNSUPPORTED_FILE', 'Could not read the Excel workbook');
  }
  const sheetName = workbook.SheetNames[0] ?? null;
  if (!sheetName) return { records: [], sheetName: null };
  const sheet = workbook.Sheets[sheetName]!;
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
  // Trim header whitespace consistently with CSV handling.
  return {
    sheetName,
    records: records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), v]))),
  };
}

export function buildUploadPreview(fileName: string, buffer: Buffer, defaultJourneyDate: string, now: Date = new Date()): UploadPreview {
  const fileType = detectFileType(fileName, buffer);
  const { records, sheetName } = fileType === 'csv' ? { records: parseCsv(buffer), sheetName: null } : parseWorkbook(buffer);
  if (records.length === 0) throw new AppError('VALIDATION_ERROR', 'The file has no data rows');
  const validated = validateUploadRows(records, { defaultJourneyDate, now });
  if (!validated.detectedColumns.trainNumber) {
    throw new AppError('VALIDATION_ERROR', 'No train number column found. Use a header such as train_number, train_no or trainNumber.', {
      details: { headers: Object.keys(records[0] ?? {}) },
    });
  }
  return {
    fileName: fileName.slice(0, 200),
    fileType,
    sheetName,
    detectedColumns: validated.detectedColumns,
    defaultJourneyDate,
    rows: validated.rows,
    summary: validated.summary,
  };
}
