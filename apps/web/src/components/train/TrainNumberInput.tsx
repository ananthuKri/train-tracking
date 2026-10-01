import { useId } from 'react';
import { CircleAlert, Copy, X } from 'lucide-react';
import { MAX_TRAINS_PER_REQUEST, type ParsedTrainNumbers } from '@railtrack/shared';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn, plural } from '@/lib/utils';

export interface TrainNumberInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Result of `parseTrainNumbers(value)` (computed by the parent so it can gate submit). */
  parsed: ParsedTrainNumbers;
  disabled?: boolean;
  onSubmitShortcut?: () => void;
}

/** Free-text train-number entry with live chips + inline invalid/duplicate feedback. */
export function TrainNumberInput({ value, onChange, parsed, disabled, onSubmitShortcut }: TrainNumberInputProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const feedbackId = `${id}-feedback`;
  const tooMany = parsed.valid.length > MAX_TRAINS_PER_REQUEST;
  const hasProblems = parsed.invalid.length > 0 || tooMany;

  const remove = (trainNumber: string) => {
    const remaining = [...parsed.valid.filter((n) => n !== trainNumber), ...parsed.invalid.map((i) => i.input)];
    onChange(remaining.join(', '));
  };

  const summary =
    value.trim() === ''
      ? ''
      : [
          plural(parsed.valid.length, 'valid train'),
          parsed.invalid.length ? plural(parsed.invalid.length, 'invalid entry', 'invalid entries') : null,
          parsed.duplicates.length ? plural(parsed.duplicates.length, 'duplicate') : null,
        ]
          .filter(Boolean)
          .join(', ');

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Train numbers</Label>
      <Textarea
        id={id}
        data-testid="train-input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmitShortcut?.();
          }
        }}
        rows={3}
        spellCheck={false}
        autoComplete="off"
        inputMode="text"
        placeholder="e.g. 12082, 12627, 16348"
        aria-describedby={`${helpId} ${feedbackId}`}
        aria-invalid={hasProblems || undefined}
        className="min-h-20 resize-y font-mono text-base tracking-wide md:text-base"
      />
      <p id={helpId} className="text-xs text-muted-foreground">
        5-digit numbers separated by commas, spaces or new lines — up to {MAX_TRAINS_PER_REQUEST} trains. Press Ctrl+Enter to track.
      </p>

      <div id={feedbackId} className="space-y-2">
        <p className="sr-only" aria-live="polite">
          {summary}
        </p>
        {parsed.valid.length > 0 && (
          <ul aria-label="Valid train numbers" className="flex flex-wrap gap-1.5">
            {parsed.valid.map((n) => (
              <li
                key={n}
                data-testid="valid-chip"
                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-accent py-0.5 pl-2 pr-1 font-mono text-sm tabular-nums text-accent-foreground"
              >
                {n}
                <button
                  type="button"
                  onClick={() => remove(n)}
                  className="rounded p-0.5 outline-none hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove train ${n}`}
                  disabled={disabled}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {parsed.invalid.length > 0 && (
          <div
            data-testid="invalid-feedback"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
          >
            <p className="flex items-center gap-1.5 font-medium">
              <CircleAlert aria-hidden className="size-4" />
              {plural(parsed.invalid.length, 'entry', 'entries')} not recognised
              {parsed.valid.length > 0 ? ' — will be skipped' : ''}
            </p>
            <ul className="mt-1 space-y-0.5 pl-6 text-xs">
              {parsed.invalid.map((item, i) => (
                <li key={`${item.input}-${i}`} data-testid="invalid-item">
                  <span className="font-mono font-semibold">“{item.input}”</span> — {item.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {parsed.duplicates.length > 0 && (
          <p
            data-testid="duplicate-feedback"
            className={cn(
              'flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100',
            )}
          >
            <Copy aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              Duplicate {parsed.duplicates.length === 1 ? 'number' : 'numbers'} tracked once:{' '}
              <span className="font-mono">{parsed.duplicates.join(', ')}</span>
            </span>
          </p>
        )}

        {tooMany && (
          <p
            data-testid="too-many-feedback"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
          >
            You entered {parsed.valid.length} trains — the limit is {MAX_TRAINS_PER_REQUEST} per request. Remove some, or
            use the Upload tab for larger lists.
          </p>
        )}
      </div>
    </div>
  );
}
