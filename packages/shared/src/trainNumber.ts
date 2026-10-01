/**
 * Indian Railways train numbers are five digits (the 2010 renumbering moved every
 * service to 5 digits; special trains start with 0, e.g. 01045).
 */
export const TRAIN_NUMBER_PATTERN = /^\d{5}$/;

export const MAX_TRAINS_PER_REQUEST = 50;

export function isValidTrainNumber(value: string): boolean {
  return TRAIN_NUMBER_PATTERN.test(value);
}

export interface InvalidTrainInput {
  input: string;
  reason: string;
}

export interface ParsedTrainNumbers {
  /** Valid, de-duplicated train numbers in input order. */
  valid: string[];
  invalid: InvalidTrainInput[];
  /** Train numbers that appeared more than once (reported once each). */
  duplicates: string[];
}

/** Normalise a single user-entered token: trims and strips internal spaces/dashes ("12 082" → "12082"). */
export function normaliseTrainToken(token: string): string {
  return token.trim().replace(/[\s-]+/g, '');
}

export function explainInvalidTrainNumber(token: string): string {
  if (token.length === 0) return 'Empty value';
  if (!/^\d+$/.test(token)) return 'Train numbers may only contain digits';
  if (token.length < 5) return 'Train numbers have 5 digits (add a leading 0 for special trains)';
  if (token.length > 5) return 'Train numbers have exactly 5 digits';
  return 'Invalid train number';
}

/**
 * Parse free text such as "12082, 12627 16348;12082" into valid, invalid and duplicate
 * train numbers. Separators: comma, semicolon, whitespace, new lines.
 */
export function parseTrainNumbers(input: string | readonly string[]): ParsedTrainNumbers {
  const tokens = (typeof input === 'string' ? input.split(/[,;\n\r\t ]+/) : input)
    .map((t) => normaliseTrainToken(String(t)))
    .filter((t) => t.length > 0);

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const valid: string[] = [];
  const invalid: InvalidTrainInput[] = [];

  for (const token of tokens) {
    if (!isValidTrainNumber(token)) {
      invalid.push({ input: token, reason: explainInvalidTrainNumber(token) });
      continue;
    }
    if (seen.has(token)) {
      duplicates.add(token);
      continue;
    }
    seen.add(token);
    valid.push(token);
  }

  return { valid, invalid, duplicates: [...duplicates] };
}
