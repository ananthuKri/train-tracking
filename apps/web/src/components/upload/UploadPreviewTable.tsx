import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Download, TriangleAlert } from 'lucide-react';
import { formatJourneyDate, type UploadPreview } from '@railtrack/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { downloadText } from '@/lib/download';
import { cn, plural } from '@/lib/utils';
import { buildErrorCsv, errorCsvFileName } from './uploadModel';

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'warning' | 'success' }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        tone === 'danger' && value > 0 && 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40',
        tone === 'warning' && value > 0 && 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40',
        tone === 'success' && value > 0 && 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40',
      )}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Preview of an uploaded sheet: invalid rows are red AND labelled "Invalid" with the reason (never colour-only). */
export function UploadPreviewTable({ preview }: { preview: UploadPreview }) {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const rows = useMemo(
    () => (problemsOnly ? preview.rows.filter((r) => !r.valid || r.warnings.length > 0) : preview.rows),
    [preview.rows, problemsOnly],
  );
  const { summary, detectedColumns } = preview;

  return (
    <div data-testid="upload-preview" className="space-y-4">
      <dl data-testid="upload-summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Upload summary">
        <Stat label="Rows" value={summary.total} />
        <Stat label="Valid" value={summary.valid} tone="success" />
        <Stat label="Invalid" value={summary.invalid} tone="danger" />
        <Stat label="Duplicates" value={summary.duplicates} tone="warning" />
      </dl>

      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{preview.fileName}</span>
        {preview.sheetName ? ` · sheet “${preview.sheetName}”` : ''} · columns detected: train number{' '}
        <code className="font-mono">{detectedColumns.trainNumber ?? 'not found'}</code>, date{' '}
        <code className="font-mono">{detectedColumns.journeyDate ?? `none (using ${formatJourneyDate(preview.defaultJourneyDate)})`}</code>, email{' '}
        <code className="font-mono">{detectedColumns.email ?? 'none'}</code>
      </p>

      {summary.truncated && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          Only the first {summary.total} rows were read — the rest of the file was skipped.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Checkbox id="problems-only" checked={problemsOnly} onCheckedChange={(v) => setProblemsOnly(v === true)} />
          <Label htmlFor="problems-only" className="font-normal">
            Show only rows with problems
          </Label>
        </div>
        {summary.invalid > 0 && (
          <Button
            variant="outline"
            size="sm"
            data-testid="download-errors"
            onClick={() => downloadText(errorCsvFileName(preview.fileName), buildErrorCsv(preview.rows), 'text/csv;charset=utf-8')}
          >
            <Download aria-hidden />
            Download error CSV ({plural(summary.invalid, 'row')})
          </Button>
        )}
      </div>

      <div className="max-h-[420px] overflow-auto rounded-lg border">
        <Table containerClassName="overflow-visible">
          <caption className="sr-only">Rows read from {preview.fileName}</caption>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead scope="col">Row</TableHead>
              <TableHead scope="col">Train</TableHead>
              <TableHead scope="col">Journey date</TableHead>
              <TableHead scope="col">Email</TableHead>
              <TableHead scope="col">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const hasWarnings = row.warnings.length > 0;
              return (
                <TableRow
                  key={row.rowNumber}
                  data-testid="upload-row"
                  data-valid={row.valid}
                  data-row={row.rowNumber}
                  className={cn(
                    !row.valid && 'border-l-4 border-l-red-600 bg-red-50 hover:bg-red-100/70 dark:bg-red-950/40 dark:hover:bg-red-950/60',
                    row.valid && hasWarnings && 'border-l-4 border-l-amber-500 bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/30',
                  )}
                >
                  <TableCell className="font-mono tabular-nums">{row.rowNumber}</TableCell>
                  <TableCell className="font-mono">
                    {row.trainNumber ?? <span className="text-muted-foreground">{row.rawTrainNumber || '(blank)'}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.journeyDate ? formatJourneyDate(row.journeyDate) : <span className="text-muted-foreground">{row.rawJourneyDate || '(blank)'}</span>}
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate">{row.email ?? row.rawEmail ?? ''}</TableCell>
                  <TableCell className="min-w-[14rem]">
                    {row.valid ? (
                      <span className="inline-flex items-center gap-1 text-emerald-800 dark:text-emerald-300">
                        <CircleCheck aria-hidden className="size-4" /> Valid
                      </span>
                    ) : (
                      <div className="text-red-900 dark:text-red-200">
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <CircleAlert aria-hidden className="size-4" /> Invalid
                        </span>
                        <ul data-testid="row-errors" className="mt-0.5 list-disc pl-5 text-xs">
                          {row.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {hasWarnings && (
                      <div className="mt-1 text-amber-900 dark:text-amber-200">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold">
                          <TriangleAlert aria-hidden className="size-3.5" /> Warning
                        </span>
                        <ul data-testid="row-warnings" className="list-disc pl-5 text-xs">
                          {row.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  {problemsOnly ? 'No problems found.' : 'The file has no data rows.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
