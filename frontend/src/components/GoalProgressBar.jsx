import { computeMetricProgress } from "@/lib/metricProgress";

export default function GoalProgressBar({
  label,
  metricName,
  current,
  target,
  className = "",
}) {
  const percent = computeMetricProgress(current, target);
  const displayLabel = label || metricName || "Progress";

  return (
    <div className={className} data-testid="goal-progress-bar">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium truncate">{displayLabel}</span>
        {percent != null ? (
          <span className="text-xs font-mono text-[var(--ink-soft)] shrink-0">{percent}%</span>
        ) : (
          <span className="text-xs font-mono text-[var(--ink-soft)] shrink-0">—</span>
        )}
      </div>
      {metricName && label && (
        <div className="text-xs font-mono text-[var(--ink-soft)] mt-0.5 truncate">{metricName}</div>
      )}
      <div className="mt-2 h-3 w-full brutal-border bg-white overflow-hidden">
        <div
          className="h-full bg-black transition-all duration-300"
          style={{ width: percent != null ? `${percent}%` : "0%" }}
          role="progressbar"
          aria-valuenow={percent ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="mt-1 text-xs font-mono text-[var(--ink-soft)]">
        {current || "—"} → {target || "—"}
      </div>
    </div>
  );
}
