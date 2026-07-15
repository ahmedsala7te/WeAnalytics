export const MATERIAL_CHANGE_PCT = 2;

export type OperationalDeltaState = "worsened" | "improved" | "stable";

/**
 * Classifies latest-vs-previous movement while suppressing tiny fluctuations.
 * A two-percent band keeps operational queues focused on material movement;
 * zero baselines fall back to a small absolute epsilon.
 */
export function classifyOperationalDelta(
  previous: number,
  latest: number,
  higherIsBad: boolean,
  noisePct = MATERIAL_CHANGE_PCT
): { state: OperationalDeltaState; delta: number; deltaPct: number | null; material: boolean } {
  const delta = latest - previous;
  const deltaPct = Math.abs(previous) > 1e-9 ? (delta / Math.abs(previous)) * 100 : null;
  const material = deltaPct === null ? Math.abs(delta) > 1e-9 : Math.abs(deltaPct) >= noisePct;
  if (!material || Math.abs(delta) <= 1e-9) return { state: "stable", delta, deltaPct, material: false };
  const worse = higherIsBad ? delta > 0 : delta < 0;
  return { state: worse ? "worsened" : "improved", delta, deltaPct, material: true };
}
