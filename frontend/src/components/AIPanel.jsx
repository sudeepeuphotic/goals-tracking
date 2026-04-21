export default function AIPanel({ title = "AI_ANALYSIS", pending = true }) {
  return (
    <div className="brutal-card scanlines p-5">
      <div className="mono-label mb-2">{title}</div>
      {pending ? (
        <>
          <div className="font-mono text-sm text-[var(--ink-soft)]">
            AI_ANALYSIS_PENDING
          </div>
          <p className="mt-2 text-sm text-[var(--ink-soft)] max-w-lg">
            Manager-only insights (executive summary, strength signals, risk signals,
            tentative score) will appear here once the AI evaluator is wired up.
          </p>
        </>
      ) : null}
    </div>
  );
}
