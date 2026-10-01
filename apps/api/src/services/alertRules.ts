import { formatDelay, formatIst, type AlertRules, type NormalizedTrainStatus, type TrainState } from '@railtrack/shared';

/** Compact state remembered between monitoring checks. */
export interface LastKnown {
  state: TrainState;
  delayMinutes: number | null;
  lastStationCode: string | null;
  nextStationCode: string | null;
  isDemo: boolean;
}

export interface Alert {
  /** Stable key used to avoid sending the same alert twice. */
  key: string;
  line: string;
}

export interface AlertEvaluation {
  alerts: Alert[];
  fired: string[];
  lastKnown: LastKnown;
  /** True once nothing further can happen on this journey. */
  terminal: boolean;
}

/** Hysteresis so a delay hovering around the threshold does not cause repeated emails. */
const DELAY_REARM_MARGIN = 5;

export function summarize(status: NormalizedTrainStatus): LastKnown {
  return {
    state: status.state,
    delayMinutes: status.delayMinutes,
    lastStationCode: status.lastReportedStation?.code ?? null,
    nextStationCode: status.nextStation?.code ?? null,
    isDemo: status.provider.isDemo,
  };
}

/**
 * Decide which alerts to send for this check. Pure function — no I/O.
 * The first check establishes a baseline for "reached next station"; exception, delay and arrival
 * alerts fire on the first check too, because the subscriber wants to know about them immediately.
 */
export function evaluateAlerts(previous: LastKnown | null, status: NormalizedTrainStatus, rules: AlertRules, firedBefore: readonly string[]): AlertEvaluation {
  const fired = new Set(firedBefore);
  const alerts: Alert[] = [];
  const push = (key: string, line: string) => {
    if (fired.has(key)) return;
    fired.add(key);
    alerts.push({ key, line });
  };
  // Only trust data that was verified for this check, never a stale fallback.
  const usable = status.freshness !== 'stale';

  if (usable && rules.nextStation && previous && status.lastReportedStation && status.lastReportedStation.code !== previous.lastStationCode) {
    const st = status.lastReportedStation;
    const verb = status.lastReportedEvent === 'departed' ? 'Departed' : status.lastReportedEvent === 'passed' ? 'Passed' : 'Reached';
    const when = status.lastReportedAt ? ` at ${formatIst(status.lastReportedAt, 'time')} IST` : '';
    push(`station:${st.code}`, `${verb} ${st.name} (${st.code})${when}${status.nextStation ? ` — next: ${status.nextStation.name}` : ''}.`);
  }

  if (usable && rules.delayAboveMinutes !== null && status.delayMinutes !== null) {
    const key = `delay-above:${rules.delayAboveMinutes}`;
    if (status.delayMinutes > rules.delayAboveMinutes) {
      push(key, `Delay is now ${formatDelay(status.delayMinutes)} (above your ${rules.delayAboveMinutes} min threshold).`);
    } else if (status.delayMinutes <= rules.delayAboveMinutes - DELAY_REARM_MARGIN) {
      fired.delete(key);
    }
  }

  if (usable && rules.exceptions) {
    for (const e of status.exceptions) {
      if (e.type === 'diversion') push('exception:diversion', `Train diverted: ${e.message}`);
      if (e.type === 'cancellation') push('exception:cancellation', `Train cancelled: ${e.message}`);
      if (e.type === 'partial_cancellation') push('exception:partial_cancellation', `Partially cancelled: ${e.message}`);
      if (e.type === 'reschedule') push(`exception:reschedule:${e.rescheduledByMinutes ?? ''}`, `Train rescheduled: ${e.message}`);
    }
  }

  if (usable && rules.arrival && status.state === 'arrived') {
    const when = status.actualArrival ? ` at ${formatIst(status.actualArrival, 'time')} IST` : '';
    push('arrival', `Arrived at ${status.destination.name} (${status.destination.code})${when}.`);
  }

  return {
    alerts,
    fired: [...fired],
    lastKnown: usable ? summarize(status) : (previous ?? summarize(status)),
    terminal: usable && (status.state === 'arrived' || status.state === 'cancelled'),
  };
}
