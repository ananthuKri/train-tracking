import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CSV_BOM, type UploadPreview } from '@railtrack/shared';
import { makeRow } from '@/test/fixtures';
import { UploadPreviewTable } from './UploadPreviewTable';
import { buildErrorCsv, checkUploadFile, emailsFromRows, errorCsvFileName } from './uploadModel';

const rows = [
  makeRow({ rowNumber: 2, rawEmail: 'ops@example.com', email: 'ops@example.com' }),
  makeRow({
    rowNumber: 3,
    rawTrainNumber: 'abcde',
    trainNumber: null,
    valid: false,
    errors: ['Train numbers may only contain digits'],
  }),
  makeRow({ rowNumber: 4, warnings: ['Duplicate of row 2 — tracked once'] }),
  makeRow({
    rowNumber: 5,
    rawTrainNumber: '=cmd()',
    trainNumber: null,
    rawEmail: 'not-an-email',
    valid: false,
    errors: ['Train numbers may only contain digits', 'Invalid email address "not-an-email"'],
  }),
];

const preview: UploadPreview = {
  fileName: 'my trains.csv',
  fileType: 'csv',
  sheetName: null,
  detectedColumns: { trainNumber: 'train_number', journeyDate: 'journey_date', email: 'email' },
  defaultJourneyDate: '2026-10-01',
  rows,
  summary: { total: 4, valid: 2, invalid: 2, duplicates: 1, truncated: false },
};

describe('UploadPreviewTable', () => {
  it('highlights invalid rows with an "Invalid" label and the reasons (not colour only)', () => {
    render(<UploadPreviewTable preview={preview} />);
    const tableRows = screen.getAllByTestId('upload-row');
    expect(tableRows).toHaveLength(4);

    const invalid = tableRows.filter((r) => r.getAttribute('data-valid') === 'false');
    expect(invalid.map((r) => r.getAttribute('data-row'))).toEqual(['3', '5']);
    expect(invalid[0]).toHaveClass('bg-red-50');
    expect(within(invalid[0]!).getByText('Invalid')).toBeInTheDocument();
    expect(within(invalid[0]!).getByTestId('row-errors')).toHaveTextContent('Train numbers may only contain digits');
    expect(within(invalid[1]!).getByTestId('row-errors')).toHaveTextContent('Invalid email address "not-an-email"');

    const warned = tableRows.find((r) => r.getAttribute('data-row') === '4')!;
    expect(warned).toHaveClass('bg-amber-50');
    expect(within(warned).getByTestId('row-warnings')).toHaveTextContent('Duplicate of row 2 — tracked once');
  });

  it('shows summary counts and an error-CSV download when there are invalid rows', () => {
    render(<UploadPreviewTable preview={preview} />);
    const summary = screen.getByTestId('upload-summary');
    expect(summary).toHaveTextContent('Rows4');
    expect(summary).toHaveTextContent('Valid2');
    expect(summary).toHaveTextContent('Invalid2');
    expect(summary).toHaveTextContent('Duplicates1');
    expect(screen.getByTestId('download-errors')).toHaveTextContent('Download error CSV (2 rows)');
  });

  it('hides the error download when every row is valid', () => {
    render(<UploadPreviewTable preview={{ ...preview, rows: [rows[0]!], summary: { ...preview.summary, invalid: 0, total: 1, valid: 1 } }} />);
    expect(screen.queryByTestId('download-errors')).not.toBeInTheDocument();
  });
});

describe('uploadModel', () => {
  it('builds an error CSV with BOM, only invalid rows, and formula-injection escaping', () => {
    const csv = buildErrorCsv(rows);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(CSV_BOM.length).trimEnd().split('\r\n');
    expect(lines[0]).toBe('row,train_number,journey_date,email,errors');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('3,abcde,2026-10-01,,Train numbers may only contain digits');
    expect(lines[2]).toBe(`5,'=cmd(),2026-10-01,not-an-email,"Train numbers may only contain digits; Invalid email address ""not-an-email"""`);
  });

  it('names the error file after the upload', () => {
    expect(errorCsvFileName('my trains.csv')).toBe('my_trains-errors.csv');
  });

  it('checks extension and size before uploading', () => {
    expect(checkUploadFile({ name: 'a.CSV', size: 10 })).toEqual({ ok: true });
    expect(checkUploadFile({ name: 'a.xlsx', size: 10 })).toEqual({ ok: true });
    expect(checkUploadFile({ name: 'a.pdf', size: 10 }).ok).toBe(false);
    expect(checkUploadFile({ name: 'a.csv', size: 0 }).ok).toBe(false);
    const big = checkUploadFile({ name: 'a.xls', size: 3 * 1024 * 1024 });
    expect(big.ok).toBe(false);
    expect(!big.ok && big.reason).toMatch(/limit is 2 MB/);
  });

  it('collects unique recipient emails from valid rows only', () => {
    expect(emailsFromRows(rows)).toEqual(['ops@example.com']);
  });
});
