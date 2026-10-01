import { useSyncExternalStore } from 'react';

/**
 * One shared clock for relative times ("3 min ago") so dozens of rows don't each run a timer.
 * Ticks every 15 s while at least one component is subscribed.
 */
const TICK_MS = 15_000;
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => now;

export function useNow(): Date {
  const ms = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return new Date(ms);
}
