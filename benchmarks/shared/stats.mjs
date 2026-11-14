// Summary statistics shared by the engine and product benchmarks.
// Percentiles use the nearest-rank method on a sorted copy.
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { median: pick(50), p95: pick(95), min: sorted[0], max: sorted[sorted.length - 1], n: values.length };
}

// Percent difference of `other` relative to `base`. Positive means `other` is larger (slower or heavier).
export function percentDiff(base, other) {
  if (!Number.isFinite(base) || !Number.isFinite(other) || base === 0) return null;
  return ((other - base) / base) * 100;
}
