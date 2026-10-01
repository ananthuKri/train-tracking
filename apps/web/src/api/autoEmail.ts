import { toast } from 'sonner';
import { MAX_TRAINS_PER_REQUEST, type TrackResponse } from '@railtrack/shared';
import { chunk, plural } from '@/lib/utils';
import { api } from './client';

/**
 * After tracking finishes, email the report for every train that returned data to the signed-in user.
 * The server sends it to the account's own address with the "Status Tracker" subject and reuses the
 * results just fetched (no second round of scraping). Reports hold at most 50 trains, so larger uploads
 * are split into several emails.
 */
export async function emailTrackedResults(response: TrackResponse): Promise<void> {
  const trains = response.results
    .filter((r) => r.ok && r.status)
    .map((r) => ({ trainNumber: r.trainNumber, journeyDate: r.journeyDate }));
  if (trains.length === 0) return;

  const parts = chunk(trains, MAX_TRAINS_PER_REQUEST);
  const id = toast.loading(parts.length > 1 ? `Emailing the report to you (${parts.length} emails)…` : 'Emailing the report to you…');
  let recipient = '';
  let outbox = false;
  try {
    for (const part of parts) {
      const result = await api.sendReport({ trains: part });
      if (result.status === 'FAILED') throw new Error(result.error ?? 'The email could not be delivered.');
      recipient = result.recipients[0]?.email ?? recipient;
      outbox ||= result.delivery === 'outbox';
    }
    toast.success(outbox ? 'Report written to the dev outbox (SMTP not configured)' : `Report emailed to ${recipient}`, {
      id,
      description: plural(trains.length, 'train'),
    });
  } catch (error) {
    toast.error('The report email was not sent', { id, description: error instanceof Error ? error.message : undefined });
  }
}
