export default function EmptyState({ title, hint, action }) {
  return (
    <div className="brutal-card scanlines p-10 text-center">
      <div className="mono-label">EMPTY_STATE</div>
      <div className="mt-3 text-xl font-semibold">{title}</div>
      {hint && <p className="mt-2 text-sm text-[var(--ink-soft)]">{hint}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
