import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ERROR_CODES } from '@railtrack/shared';
import { errorMeta, INPUT_ERROR_CODES, PROVIDER_ERROR_CODES } from './errorMeta';
import { TrainErrorState } from './TrainErrorState';

describe('errorMeta', () => {
  it.each([
    ['RATE_LIMITED', 'Data provider limit reached', true],
    ['INVALID_TRAIN_NUMBER', 'Invalid train number', false],
    ['TRAIN_NOT_FOUND', 'Train not found', false],
    ['NOT_RUNNING_ON_DATE', 'Not running on this date', false],
    ['PROVIDER_UNAVAILABLE', 'Live data provider unavailable', true],
    ['PROVIDER_NOT_CONFIGURED', 'Data provider not configured', false],
    ['PROVIDER_AUTH_FAILED', 'Provider authentication failed', false],
    ['TIMEOUT', 'Provider timed out', true],
    ['NETWORK_ERROR', "Can't reach RailTrack Live", true],
  ] as const)('maps %s → "%s"', (code, title, retryable) => {
    const meta = errorMeta(code);
    expect(meta.title).toBe(title);
    expect(meta.retryable).toBe(retryable);
    expect(meta.code).toBe(code);
  });

  it('has specific copy for every server error code and a generic fallback', () => {
    for (const code of ERROR_CODES) {
      const meta = errorMeta(code);
      if (code === 'INTERNAL_ERROR') {
        expect(meta.title).toBe('Something went wrong');
      } else {
        expect(meta.code).toBe(code);
      }
    }
    expect(errorMeta(null).title).toBe('Something went wrong');
    expect(errorMeta('SOMETHING_NEW').code).toBe('UNKNOWN');
  });

  it('interpolates the train and date where useful', () => {
    expect(errorMeta('TRAIN_NOT_FOUND', { trainNumber: '54321' }).description).toContain('Train 54321 was not found');
    expect(errorMeta('NOT_RUNNING_ON_DATE', { trainNumber: '12082', journeyDate: '2026-10-01' }).description).toBe(
      'Train 12082 does not run on 01 Oct 2026. Try a different journey date.',
    );
  });

  it('groups input vs provider failures', () => {
    expect([...INPUT_ERROR_CODES].every((c) => errorMeta(c).tone !== 'success')).toBe(true);
    expect(PROVIDER_ERROR_CODES.has('PROVIDER_AUTH_FAILED')).toBe(true);
  });
});

describe('TrainErrorState', () => {
  it('renders an accessible alert with the mapped title and server detail', () => {
    render(<TrainErrorState code="TRAIN_NOT_FOUND" message="No train 54321 in timetable" trainNumber="54321" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'TRAIN_NOT_FOUND');
    expect(alert).toHaveTextContent('Train not found');
    expect(alert).toHaveTextContent('Details: No train 54321 in timetable');
    expect(screen.queryByTestId('error-retry')).not.toBeInTheDocument();
  });

  it('counts down Retry-After for rate limits and only then enables retry', () => {
    vi.useFakeTimers();
    try {
      const onRetry = vi.fn();
      render(<TrainErrorState code="RATE_LIMITED" retryAfterSeconds={3} onRetry={onRetry} />);
      expect(screen.getByTestId('retry-countdown')).toHaveTextContent('You can retry in 3s.');
      expect(screen.getByTestId('error-retry')).toBeDisabled();
      act(() => {
        vi.advanceTimersByTime(3200);
      });
      expect(screen.getByTestId('retry-countdown')).toHaveTextContent('You can retry now.');
      expect(screen.getByTestId('error-retry')).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers retry for provider outages', () => {
    render(<TrainErrorState code="PROVIDER_UNAVAILABLE" onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Live data provider unavailable');
    expect(screen.getByTestId('error-retry')).toBeEnabled();
  });

  it('can be rendered as a polite status inside result lists', () => {
    render(<TrainErrorState code="PROVIDER_NOT_CONFIGURED" role="status" compact />);
    expect(screen.getByRole('status')).toHaveTextContent('Data provider not configured');
  });
});
