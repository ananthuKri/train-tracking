import { useEffect, useState } from 'react';

/** Seconds remaining from `seconds` (counted from when `seconds`/`resetKey` last changed). */
export function useCountdown(seconds: number | null | undefined, resetKey?: unknown): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil(seconds ?? 0)));

  useEffect(() => {
    const total = Math.max(0, Math.ceil(seconds ?? 0));
    setRemaining(total);
    if (total <= 0) return;
    const endsAt = Date.now() + total * 1000;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [seconds, resetKey]);

  return remaining;
}

export function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}
