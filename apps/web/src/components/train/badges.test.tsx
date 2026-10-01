import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatIst } from '@railtrack/shared';
import { LIVE_PROVIDER, makeResult, makeStatus } from '@/test/fixtures';
import { DelayChip, DemoBadge, ResultStatusBadge, StatusBadge } from './badges';
import { SourceFreshness, staleNoticeText } from './SourceFreshness';
import { TrainCard } from './TrainCard';
import { MemoryRouter } from 'react-router';

describe('StatusBadge', () => {
  it('renders the state label as text with its description as a title', () => {
    render(<StatusBadge state="diverted" />);
    const badge = screen.getByTestId('status-badge');
    expect(badge).toHaveTextContent('Diverted');
    expect(badge).toHaveAttribute('data-state', 'diverted');
    expect(badge).toHaveAttribute('title', 'Running on a diverted route.');
  });

  it('falls back to the error label for failed results', () => {
    render(<ResultStatusBadge result={makeResult({ status: null, ok: false, error: { code: 'TRAIN_NOT_FOUND', message: 'nope', retryAfterSeconds: null } })} />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Not found');
  });
});

describe('DelayChip', () => {
  it('formats delays as text (not colour only)', () => {
    const { rerender } = render(<DelayChip minutes={0} />);
    expect(screen.getByTestId('delay')).toHaveTextContent('On time');
    rerender(<DelayChip minutes={95} />);
    expect(screen.getByTestId('delay')).toHaveTextContent('1 h 35 min late');
    rerender(<DelayChip minutes={null} />);
    expect(screen.getByTestId('delay')).toHaveTextContent('Delay unknown');
  });
});

describe('DemoBadge', () => {
  it('says DEMO DATA', () => {
    render(<DemoBadge />);
    expect(screen.getByTestId('demo-badge')).toHaveTextContent(/demo data/i);
  });
});

describe('SourceFreshness', () => {
  it('shows provider, provider-updated and fetched times in IST, and the demo label', () => {
    const status = makeStatus();
    render(<SourceFreshness status={status} />);
    const bar = screen.getByTestId('source-freshness');
    expect(bar).toHaveTextContent('Source: Demo simulator');
    expect(bar).toHaveTextContent(`Provider updated ${formatIst(status.providerUpdatedAt, 'short')} IST`);
    expect(bar).toHaveTextContent(`Fetched ${formatIst(status.fetchedAt, 'short')} IST`);
    // freshnessLabel() is "DEMO DATA" for demo providers — shown once, as the demo badge.
    expect(within(bar).getAllByText(/demo data/i)).toHaveLength(1);
    expect(within(bar).getByTestId('demo-badge')).toBeInTheDocument();
    expect(within(bar).queryByTestId('freshness')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-notice')).not.toBeInTheDocument();
  });

  it('labels live data from a real provider as Live', () => {
    render(<SourceFreshness status={makeStatus({ provider: LIVE_PROVIDER })} />);
    expect(screen.getByTestId('freshness')).toHaveTextContent('Live');
    expect(screen.queryByTestId('demo-badge')).not.toBeInTheDocument();
  });

  it('shows the amber last-verified notice for stale data', () => {
    const status = makeStatus({
      provider: LIVE_PROVIDER,
      freshness: 'stale',
      notice: 'Live data temporarily unavailable — showing last verified result from 08:10 IST.',
    });
    render(<SourceFreshness status={status} error={{ code: 'PROVIDER_UNAVAILABLE', message: 'Upstream 503', retryAfterSeconds: null }} />);
    const notice = screen.getByTestId('stale-notice');
    expect(notice).toHaveTextContent('Live data temporarily unavailable — showing last verified result from 08:10 IST.');
    expect(notice).toHaveTextContent('Provider error: Upstream 503');
    expect(screen.getByTestId('freshness')).toHaveTextContent('Last verified (live data unavailable)');
  });

  it('builds a fallback stale notice when the provider gave none', () => {
    const text = staleNoticeText({ notice: null, fetchedAt: '2026-10-01T03:00:00.000Z' });
    expect(text).toMatch(/^Live data temporarily unavailable — showing last verified result from .+ IST\.$/);
  });

  it('shows "not reported" when the provider has no update time', () => {
    render(<SourceFreshness status={makeStatus({ providerUpdatedAt: null })} />);
    expect(screen.getByTestId('source-freshness')).toHaveTextContent('Provider update time not reported');
  });
});

describe('TrainCard', () => {
  it('shows a DEMO DATA badge for demo trains and the source/freshness bar', () => {
    render(
      <MemoryRouter>
        <TrainCard result={makeResult()} styleIndex={0} />
      </MemoryRouter>,
    );
    const card = screen.getByTestId('result-card');
    expect(within(card).getAllByTestId('demo-badge').length).toBeGreaterThan(0);
    expect(within(card).getByTestId('source-freshness')).toBeInTheDocument();
    expect(within(card).getByTestId('status-badge')).toHaveTextContent('Departed');
  });

  it('renders failed results with their error state', () => {
    render(
      <MemoryRouter>
        <TrainCard
          result={makeResult({ trainNumber: '99999', status: null, ok: false, error: { code: 'RATE_LIMITED', message: 'Slow down', retryAfterSeconds: 30 } })}
          styleIndex={1}
        />
      </MemoryRouter>,
    );
    const error = screen.getByTestId('train-error');
    expect(error).toHaveAttribute('data-code', 'RATE_LIMITED');
    expect(error).toHaveTextContent('Data provider limit reached');
  });
});
