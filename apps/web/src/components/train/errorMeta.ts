import type { ComponentType } from 'react';
import {
  Ban,
  CalendarX,
  CircleAlert,
  DatabaseZap,
  FileWarning,
  Hash,
  KeyRound,
  Lock,
  PlugZap,
  SearchX,
  ServerCrash,
  ShieldAlert,
  Timer,
  WifiOff,
} from 'lucide-react';
import { formatJourneyDate, type Tone } from '@railtrack/shared';
import type { ClientErrorCode } from '@/api/client';

export interface ErrorMeta {
  code: ClientErrorCode | 'UNKNOWN';
  /** Headline, e.g. "Train not found". */
  title: string;
  /** Short badge text, e.g. "Not found". */
  short: string;
  description: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  tone: Tone;
  /** Whether "Try again" makes sense. */
  retryable: boolean;
}

interface ErrorContext {
  trainNumber?: string;
  journeyDate?: string;
}

const train = (ctx: ErrorContext) => (ctx.trainNumber ? `Train ${ctx.trainNumber}` : 'This train');
const onDate = (ctx: ErrorContext) => (ctx.journeyDate ? ` on ${formatJourneyDate(ctx.journeyDate)}` : ' on the selected date');

/** Map an API/client error code to user-facing copy. Pure — unit tested. */
export function errorMeta(code: ClientErrorCode | string | null | undefined, ctx: ErrorContext = {}): ErrorMeta {
  switch (code) {
    case 'RATE_LIMITED':
      return {
        code,
        title: 'Data provider limit reached',
        short: 'Rate limited',
        description:
          'The live data provider is limiting how often we can ask for updates. Please wait for the countdown before trying again.',
        icon: Timer,
        tone: 'warning',
        retryable: true,
      };
    case 'INVALID_TRAIN_NUMBER':
      return {
        code,
        title: 'Invalid train number',
        short: 'Invalid number',
        description: 'Indian Railways train numbers have exactly 5 digits (special trains start with 0, e.g. 01045).',
        icon: Hash,
        tone: 'danger',
        retryable: false,
      };
    case 'TRAIN_NOT_FOUND':
      return {
        code,
        title: 'Train not found',
        short: 'Not found',
        description: `${train(ctx)} was not found by the data provider. Check the number and try again.`,
        icon: SearchX,
        tone: 'danger',
        retryable: false,
      };
    case 'NOT_RUNNING_ON_DATE':
      return {
        code,
        title: 'Not running on this date',
        short: 'Not running',
        description: `${train(ctx)} does not run${onDate(ctx)}. Try a different journey date.`,
        icon: CalendarX,
        tone: 'warning',
        retryable: false,
      };
    case 'PROVIDER_UNAVAILABLE':
      return {
        code,
        title: 'Live data provider unavailable',
        short: 'Provider down',
        description: 'The railway data provider is not responding right now. This is usually temporary — try again shortly.',
        icon: ServerCrash,
        tone: 'danger',
        retryable: true,
      };
    case 'PROVIDER_NOT_CONFIGURED':
      return {
        code,
        title: 'Data provider not configured',
        short: 'Not configured',
        description: 'No live data provider is configured on this server. An administrator needs to add provider credentials.',
        icon: PlugZap,
        tone: 'neutral',
        retryable: false,
      };
    case 'PROVIDER_AUTH_FAILED':
      return {
        code,
        title: 'Provider authentication failed',
        short: 'Provider auth failed',
        description: 'The data provider rejected our credentials. An administrator needs to check the provider API key.',
        icon: KeyRound,
        tone: 'danger',
        retryable: false,
      };
    case 'TIMEOUT':
      return {
        code,
        title: 'Provider timed out',
        short: 'Timed out',
        description: 'The data provider took too long to respond. Try again in a moment.',
        icon: Timer,
        tone: 'warning',
        retryable: true,
      };
    case 'NETWORK_ERROR':
      return {
        code,
        title: "Can't reach RailTrack Live",
        short: 'Offline',
        description: 'We could not contact the RailTrack Live server. Check your internet connection and try again.',
        icon: WifiOff,
        tone: 'warning',
        retryable: true,
      };
    case 'UNAUTHENTICATED':
      return {
        code,
        title: 'Sign in required',
        short: 'Sign in',
        description: 'Please sign in to continue.',
        icon: Lock,
        tone: 'neutral',
        retryable: false,
      };
    case 'FORBIDDEN':
      return {
        code,
        title: 'Not allowed',
        short: 'Forbidden',
        description: "Your account doesn't have access to this.",
        icon: ShieldAlert,
        tone: 'neutral',
        retryable: false,
      };
    case 'NOT_FOUND':
      return {
        code,
        title: 'Not found',
        short: 'Not found',
        description: 'The item you were looking for does not exist or has expired.',
        icon: SearchX,
        tone: 'neutral',
        retryable: false,
      };
    case 'VALIDATION_ERROR':
      return {
        code,
        title: 'Check your input',
        short: 'Invalid input',
        description: 'Some of the details sent were not valid.',
        icon: CircleAlert,
        tone: 'danger',
        retryable: false,
      };
    case 'EMAIL_NOT_CONFIGURED':
      return {
        code,
        title: 'Email is not configured',
        short: 'Email off',
        description: 'This server cannot send email right now.',
        icon: Ban,
        tone: 'neutral',
        retryable: false,
      };
    case 'MONITORING_UNAVAILABLE':
      return {
        code,
        title: 'Monitoring unavailable',
        short: 'Unavailable',
        description: 'Scheduled monitoring is not available on this server right now.',
        icon: Ban,
        tone: 'neutral',
        retryable: false,
      };
    case 'DATABASE_UNAVAILABLE':
      return {
        code,
        title: 'Account features temporarily unavailable',
        short: 'DB unavailable',
        description:
          'Sign-in, history, reports and monitoring need the database, which is not reachable right now. Train tracking still works.',
        icon: DatabaseZap,
        tone: 'warning',
        retryable: true,
      };
    case 'PAYLOAD_TOO_LARGE':
      return {
        code,
        title: 'File too large',
        short: 'Too large',
        description: 'The uploaded file is bigger than the allowed size. Split it into smaller files and try again.',
        icon: FileWarning,
        tone: 'danger',
        retryable: false,
      };
    case 'UNSUPPORTED_FILE':
      return {
        code,
        title: 'Unsupported file',
        short: 'Unsupported',
        description: 'Upload a .csv, .xlsx or .xls file with a train number column.',
        icon: FileWarning,
        tone: 'danger',
        retryable: false,
      };
    case 'CONFLICT':
      return {
        code,
        title: 'Already exists',
        short: 'Conflict',
        description: 'This conflicts with something that already exists.',
        icon: CircleAlert,
        tone: 'warning',
        retryable: false,
      };
    default:
      return {
        code: 'UNKNOWN',
        title: 'Something went wrong',
        short: 'Error',
        description: 'An unexpected error occurred while loading train data. Please try again.',
        icon: CircleAlert,
        tone: 'danger',
        retryable: true,
      };
  }
}

/** Codes meaning "the train/date itself is the problem" (vs. a provider/system failure). */
export const INPUT_ERROR_CODES = new Set(['INVALID_TRAIN_NUMBER', 'TRAIN_NOT_FOUND', 'NOT_RUNNING_ON_DATE']);
export const PROVIDER_ERROR_CODES = new Set(['PROVIDER_UNAVAILABLE', 'PROVIDER_NOT_CONFIGURED', 'TIMEOUT', 'PROVIDER_AUTH_FAILED']);
