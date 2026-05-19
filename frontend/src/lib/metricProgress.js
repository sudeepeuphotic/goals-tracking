export function parseMetricNumber(value) {
  if (value == null || value === "") return null;
  const m = String(value).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Returns 0–100 or null when progress cannot be computed. */
export function computeMetricProgress(current, target) {
  const c = parseMetricNumber(current);
  const t = parseMetricNumber(target);
  if (c == null || t == null || t === 0) return null;
  return Math.min(100, Math.max(0, Math.round((c / t) * 100)));
}
