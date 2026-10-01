import { useId, useRef, useState, type DragEvent } from 'react';
import { FileSpreadsheet, FileText, LoaderCircle, TrainFront, Upload, X } from 'lucide-react';
import {
  JOURNEY_DATE_MAX_FUTURE_DAYS,
  JOURNEY_DATE_MAX_PAST_DAYS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_ROWS,
  addDaysToDate,
  todayInIst,
  uniqueValidItems,
} from '@railtrack/shared';
import { isApiError } from '@/api/client';
import { useConfig, useUpload } from '@/api/hooks';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrainErrorState } from '@/components/train/TrainErrorState';
import type { TrainRef } from '@/lib/trainKey';
import { cn, plural } from '@/lib/utils';
import { UploadPreviewTable } from './UploadPreviewTable';
import { checkUploadFile, emailsFromRows } from './uploadModel';

export interface UploadPanelProps {
  onTrack: (items: TrainRef[], emails: string[]) => void;
  tracking: boolean;
  trackingProgress?: string | null;
}

export function UploadPanel({ onTrack, tracking, trackingProgress }: UploadPanelProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: config } = useConfig();
  const maxBytes = config?.limits.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  const maxRows = config?.limits.maxUploadRows ?? MAX_UPLOAD_ROWS;
  const today = todayInIst();
  const [defaultDate, setDefaultDate] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const upload = useUpload();
  const preview = upload.data;
  const validItems = preview ? uniqueValidItems(preview.rows) : [];

  const send = (f: File, date: string) => {
    upload.reset();
    upload.mutate({ file: f, journeyDate: date });
  };

  const accept = (f: File | undefined | null) => {
    if (!f) return;
    const check = checkUploadFile(f, maxBytes);
    if (!check.ok) {
      setClientError(check.reason);
      setFile(null);
      upload.reset();
      return;
    }
    setClientError(null);
    setFile(f);
    send(f, defaultDate);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    accept(e.dataTransfer.files?.[0]);
  };

  const clear = () => {
    setFile(null);
    setClientError(null);
    upload.reset();
    if (inputRef.current) inputRef.current.value = '';
  };

  const uploadError = upload.error;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor={`${id}-date`}>Default journey date</Label>
          <Input
            id={`${id}-date`}
            type="date"
            data-testid="upload-date"
            value={defaultDate}
            min={addDaysToDate(today, -JOURNEY_DATE_MAX_PAST_DAYS)}
            max={addDaysToDate(today, JOURNEY_DATE_MAX_FUTURE_DAYS)}
            onChange={(e) => {
              const v = e.target.value || today;
              setDefaultDate(v);
              if (file) send(file, v);
            }}
            className="w-full sm:w-52"
            aria-describedby={`${id}-date-help`}
          />
          <p id={`${id}-date-help`} className="text-xs text-muted-foreground">
            Used for rows without a date (dates in the sheet take precedence).
          </p>
        </div>
        <p className="text-xs text-muted-foreground sm:text-right">
          Sample files:{' '}
          <a className="font-medium text-primary underline underline-offset-2" href="/samples/trains-sample.csv" download>
            CSV
          </a>{' '}
          ·{' '}
          <a className="font-medium text-primary underline underline-offset-2" href="/samples/trains-sample.xlsx" download>
            Excel
          </a>
        </p>
      </div>

      <div
        data-testid="upload-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragging ? 'border-primary bg-accent' : 'border-input bg-muted/30',
        )}
      >
        <Upload aria-hidden className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">Drag a CSV or Excel file here</p>
          <p className="text-xs text-muted-foreground">
            .csv, .xlsx or .xls · up to {(maxBytes / 1024 / 1024).toFixed(0)} MB · {maxRows} rows · columns{' '}
            <code className="font-mono">train_number</code>, optional <code className="font-mono">journey_date</code> and{' '}
            <code className="font-mono">email</code>
          </p>
        </div>
        <input
          ref={inputRef}
          id={`${id}-file`}
          data-testid="upload-input"
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="sr-only"
          onChange={(e) => accept(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          <FileSpreadsheet aria-hidden />
          Choose file
        </Button>
        <label htmlFor={`${id}-file`} className="sr-only">
          Upload a CSV or Excel file of train numbers
        </label>
      </div>

      <div className="space-y-4">
        <p className="sr-only" aria-live="polite">
          {preview
            ? `Preview ready: ${plural(preview.summary.valid, 'valid row')}, ${plural(preview.summary.invalid, 'invalid row')}.`
            : ''}
        </p>
        {clientError && (
          <Alert tone="danger" icon={FileText} title="File not accepted" role="alert" data-testid="upload-client-error">
            {clientError}
          </Alert>
        )}

        {file && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileText aria-hidden className="size-4 text-muted-foreground" />
            <span className="font-medium">{file.name}</span>
            <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
            <Button variant="ghost" size="sm" onClick={clear} aria-label="Remove file">
              <X aria-hidden /> Remove
            </Button>
          </div>
        )}

        {upload.isPending && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden className="size-4 animate-spin" /> Reading and validating rows…
          </p>
        )}

        {uploadError && (
          <TrainErrorState
            compact
            code={isApiError(uploadError) ? uploadError.code : null}
            message={uploadError.message}
            retryAfterSeconds={isApiError(uploadError) ? uploadError.retryAfterSeconds : null}
            onRetry={file ? () => send(file, defaultDate) : undefined}
          />
        )}

        {preview && (
          <>
            <UploadPreviewTable preview={preview} />
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                {validItems.length > 0 ? (
                  <>
                    Ready to track <strong>{plural(validItems.length, 'train')}</strong>
                    {preview.summary.invalid > 0 && <> — {plural(preview.summary.invalid, 'invalid row')} will be skipped</>}.
                    {validItems.length > 50 && <span className="block text-xs text-muted-foreground">Sent in batches of 50.</span>}
                  </>
                ) : (
                  'No valid rows to track — fix the errors and upload again.'
                )}
              </p>
              <Button
                data-testid="track-upload"
                disabled={validItems.length === 0 || tracking}
                onClick={() => onTrack(validItems, emailsFromRows(preview.rows))}
              >
                {tracking ? <LoaderCircle aria-hidden className="animate-spin" /> : <TrainFront aria-hidden />}
                {tracking ? (trackingProgress ?? 'Tracking…') : `Track ${plural(validItems.length, 'valid train')}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
