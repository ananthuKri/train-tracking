// Generates sample upload files in samples/ and apps/web/public/samples/.
// Journey dates are left blank in the main samples (the upload's default date — today in IST — is used),
// so the files never go out of the provider's accepted date window.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [path.join(root, 'samples'), path.join(root, 'apps/web/public/samples')];

const valid = [
  ['train_number', 'journey_date', 'email'],
  ['12082', '', 'ops@example.com'],
  ['12627', '', ''],
  ['16348', '', 'control@example.com'],
  ['12951', '', ''],
  ['12301', '', ''],
  ['22691', '', ''],
  ['12622', '', ''],
  ['12859', '', ''],
  ['12002', '', ''],
];

const withErrors = [
  ['train_no', 'journey_date', 'email'],
  ['12082', '', 'ops@example.com'],
  ['1234', '', ''], // too short
  ['12A27', '', ''], // not numeric
  ['12627', '31-02-2026', ''], // impossible date
  ['16348', '', 'not-an-email'], // bad email
  ['12082', '', ''], // duplicate of row 2
  ['12951', '', ''],
];

const csv = (rows) =>
  rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';

function workbook(rows, bookType) {
  // Write train numbers as numbers, the way most people type them into Excel.
  const typed = rows.map((r, i) => (i === 0 ? r : r.map((c, j) => (j === 0 && /^\d+$/.test(c) ? Number(c) : c))));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(typed), 'Trains');
  return XLSX.write(wb, { type: 'buffer', bookType });
}

for (const dir of targets) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'trains-sample.csv'), csv(valid));
  writeFileSync(path.join(dir, 'trains-with-errors.csv'), csv(withErrors));
  writeFileSync(path.join(dir, 'trains-sample.xlsx'), workbook(valid, 'xlsx'));
  writeFileSync(path.join(dir, 'trains-sample.xls'), workbook(valid, 'biff8'));
  console.log(`Wrote samples to ${path.relative(root, dir)}`);
}
