import { useEffect, useRef, useState } from 'react';
import { estimatePosition, type NormalizedTrainStatus, type TrainPosition } from '@railtrack/shared';

export const ANIMATION_MS = 1500;
export const ESTIMATE_REFRESH_MS = 15_000;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Animate a number (route km) towards `target` with requestAnimationFrame.
 * Jumps immediately when disabled or when there is nothing to animate from.
 */
export function useAnimatedNumber(target: number | null, enabled: boolean, duration = ANIMATION_MS): number | null {
  const [value, setValue] = useState<number | null>(target);
  const valueRef = useRef<number | null>(target);

  useEffect(() => {
    if (target === null) {
      valueRef.current = null;
      setValue(null);
      return;
    }
    const from = valueRef.current;
    if (!enabled || from === null || Math.abs(from - target) < 1e-3) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * easeInOutCubic(t);
      valueRef.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);

  return value;
}

/**
 * The position to draw. For estimated positions with animation on, re-estimate from the
 * timetable every 15 s (still `kind: 'estimated'` — never a GPS fix).
 */
export function useLivePosition(status: NormalizedTrainStatus, enabled: boolean): TrainPosition | null {
  const [position, setPosition] = useState<TrainPosition | null>(status.position);

  useEffect(() => {
    setPosition(status.position);
    if (!enabled || status.position?.kind !== 'estimated') return;
    const tick = () => {
      const next = estimatePosition(status, new Date());
      if (next) setPosition(next);
    };
    tick();
    const id = setInterval(tick, ESTIMATE_REFRESH_MS);
    return () => clearInterval(id);
  }, [status, enabled]);

  return position;
}
