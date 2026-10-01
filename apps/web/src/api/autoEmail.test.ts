import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackResponse, TrackResult } from '@railtrack/shared';

const sendReport = vi.fn();
vi.mock('./client', () => ({ api: { sendReport: (...args: unknown[]) => sendReport(...args) } }));
const toast = { loading: vi.fn(() => 'toast-id'), success: vi.fn(), error: vi.fn() };
vi.mock('sonner', () => ({ toast }));

const { emailTrackedResults } = await import('./autoEmail');

function response(count: number, failedEvery = 0): TrackResponse {
  const results = Array.from({ length: count }, (_, i): TrackResult => {
    const failed = failedEvery > 0 && i % failedEvery === 0;
    return {
      trainNumber: String(10000 + i),
      journeyDate: '2026-10-01',
      ok: !failed,
      status: failed ? null : ({ trainNumber: String(10000 + i) } as TrackResult['status']),
      error: null,
    };
  });
  return { results } as unknown as TrackResponse;
}

describe('emailTrackedResults', () => {
  beforeEach(() => {
    sendReport.mockReset();
    sendReport.mockResolvedValue({ status: 'SENT', recipients: [{ email: 'me@example.com', status: 'SENT', error: null }], delivery: 'smtp' });
    vi.clearAllMocks();
  });

  it('emails only trains that returned data, to the signed-in user (no recipients sent)', async () => {
    await emailTrackedResults(response(4, 2));
    expect(sendReport).toHaveBeenCalledTimes(1);
    expect(sendReport.mock.calls[0]![0]).toEqual({
      trains: [
        { trainNumber: '10001', journeyDate: '2026-10-01' },
        { trainNumber: '10003', journeyDate: '2026-10-01' },
      ],
    });
    expect(toast.success).toHaveBeenCalledWith('Report emailed to me@example.com', expect.objectContaining({ id: 'toast-id' }));
  });

  it('splits large uploads into emails of at most 50 trains', async () => {
    await emailTrackedResults(response(120));
    expect(sendReport.mock.calls.map(([body]) => body.trains.length)).toEqual([50, 50, 20]);
  });

  it('sends nothing when no train returned data, and reports failures', async () => {
    await emailTrackedResults(response(3, 1));
    expect(sendReport).not.toHaveBeenCalled();

    sendReport.mockRejectedValueOnce(new Error('Email limit reached'));
    await emailTrackedResults(response(1));
    expect(toast.error).toHaveBeenCalledWith('The report email was not sent', expect.objectContaining({ description: 'Email limit reached' }));
  });
});
