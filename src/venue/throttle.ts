/**
 * Spaces calls to one provider at least `minIntervalMs` apart, in the order
 * they were asked for. One throttle per provider and process: Nominatim's
 * limit is per client, not per review.
 */
export interface ThrottleOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type Throttle = <T>(task: () => Promise<T>) => Promise<T>;

export function createThrottle(
  minIntervalMs: number,
  options: ThrottleOptions = {},
): Throttle {
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastStart = Number.NEGATIVE_INFINITY;
  let queue: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return task();
    });
    // A failed task must not block the ones queued after it.
    queue = run.catch(() => undefined);
    return run;
  };
}

/** For replay and tests: nothing to protect, nothing to wait for. */
export const noThrottle: Throttle = (task) => task();
