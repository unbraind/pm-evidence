/**
 * Keep full local/release depth by default; quick runs the same deterministic
 * seed prefix at one tenth depth, with at least 25 cases (capped by full count).
 * Callers keep seed generation and per-case assertions identical in both modes.
 */
export function testDepth(full: number): number {
  return process.env.PM_TEST_DEPTH === "quick" ? Math.min(full, Math.max(25, Math.ceil(full / 10))) : full;
}

/** Scale only harness watchdogs; reject invalid factors before starting any child. */
export function testTime(milliseconds: number, raw = process.env.PM_TEST_TIME_SCALE ?? "1"): number {
  const scale = Number(raw);
  const budget = Math.ceil(milliseconds * scale);
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isSafeInteger(budget) || budget <= 0 || budget > 2_147_483_647) {
    throw new Error("PM_TEST_TIME_SCALE must be finite, positive and within the timer range");
  }
  return budget;
}
