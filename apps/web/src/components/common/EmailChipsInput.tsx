import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { emailSchema } from '@railtrack/shared';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function normaliseEmail(value: string): string | null {
  const parsed = emailSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : null;
}

/** Multiple email addresses as removable chips (Enter, comma, space or paste to add). */
export function EmailChipsInput({
  value,
  onChange,
  label = 'Recipients',
  max = 20,
  description,
  testId = 'recipients-input',
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
  max?: number;
  description?: string;
  testId?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).filter(Boolean);
    if (parts.length === 0) return true;
    const next = [...value];
    const bad: string[] = [];
    for (const part of parts) {
      const email = normaliseEmail(part);
      if (!email) {
        bad.push(part);
        continue;
      }
      if (!next.includes(email)) next.push(email);
    }
    if (next.length > max) {
      setError(`You can add at most ${max} recipients.`);
      onChange(next.slice(0, max));
      return false;
    }
    onChange(next);
    if (bad.length) {
      setError(`Not a valid email address: ${bad.join(', ')}`);
      setDraft(bad.join(' '));
      return false;
    }
    setError(null);
    setDraft('');
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === ' ' && draft.trim())) {
      if (!draft.trim()) {
        if (e.key === 'Enter') e.preventDefault();
        return;
      }
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (/[\s,;]/.test(text)) {
      e.preventDefault();
      add(text);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/60 dark:bg-input/20',
          error && 'border-destructive',
          disabled && 'opacity-50',
        )}
      >
        <ul className="contents" aria-label={`${label} added`}>
          {value.map((email) => (
            <li
              key={email}
              data-testid="recipient-chip"
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary py-0.5 pl-2 pr-1 text-sm text-secondary-foreground"
            >
              <span className="truncate">{email}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== email))}
                className="rounded p-0.5 outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${email}`}
                disabled={disabled}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <input
          id={id}
          data-testid={testId}
          type="text"
          inputMode="email"
          autoComplete="email"
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? 'Add another…' : 'name@example.com'}
          aria-invalid={!!error || undefined}
          aria-describedby={`${id}-desc ${id}-err`}
          className="min-w-40 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p id={`${id}-desc`} className="text-xs text-muted-foreground">
        {description ?? `Press Enter or comma after each address. Up to ${max}.`}
      </p>
      <p id={`${id}-err`} role={error ? 'alert' : undefined} className="text-xs font-medium text-destructive">
        {error}
      </p>
    </div>
  );
}
