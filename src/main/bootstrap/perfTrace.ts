/**
 * Env-gated boot/perf tracing (`ATLAS_PERF_TRACE=1`). Zero cost otherwise: a
 * no-op when the flag is off, and a `console.info` line per mark when on.
 * Marks flow through stdout (`--enable-logging`), so a cold-start timeline is
 * one `cat` of the run log away.
 */
const enabled = process.env.ATLAS_PERF_TRACE === '1';
const t0 = performance.now();

export function perfMark(label: string): void {
  if (!enabled) return;
  console.info(`[perf] ${label} at +${Math.round(performance.now() - t0)}ms`);
}

export function perfMeasure(label: string, startMark: number): void {
  if (!enabled) return;
  console.info(`[perf] ${label} took ${Math.round(performance.now() - startMark)}ms`);
}

export function perfNow(): number {
  return performance.now();
}