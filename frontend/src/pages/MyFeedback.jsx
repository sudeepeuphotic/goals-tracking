import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

export default function MyFeedback() {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const r = await api.get("/feedback/my-dri-view");
      setData(r.data);
    })();
  }, []);

  if (data === null) return <div className="p-10 mono-label">Loading…</div>;

  if (!data.length) return (
    <div className="p-8">
      <EmptyState title="You don't DRI any objectives yet"
        hint="When you lead an objective, your team's anonymized feedback will appear here." />
    </div>
  );

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto">
      <div className="mono-label">MY FEEDBACK · AS A DRI</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">What your team is saying.</h1>
      <p className="text-[var(--ink-soft)] mt-2">Aggregated, anonymized. Raw attribution stays with your manager.</p>

      <div className="mt-8 space-y-10">
        {data.map((row) => (
          <section key={row.objective.id} data-testid={`dri-feedback-${row.objective.id}`}>
            <div className="flex items-end justify-between">
              <div>
                <div className="mono-label">OBJECTIVE</div>
                <h2 className="text-xl font-semibold">{row.objective.title}</h2>
              </div>
              <div className="mono-label">{row.count} respondent{row.count !== 1 && "s"}</div>
            </div>

            {row.count === 0 ? (
              <div className="brutal-card scanlines p-6 mt-3 text-sm text-[var(--ink-soft)]">
                No feedback submitted yet for this objective.
              </div>
            ) : (
              <>
                <div className="grid md:grid-cols-3 gap-4 mt-4">
                  {Object.entries(row.dimensions).map(([k, v]) => (
                    <div key={k} className="brutal-card p-4">
                      <div className="mono-label">{k.replaceAll("_", " ")}</div>
                      <div className="text-3xl font-mono mt-1">{v.avg}<span className="text-sm text-[var(--ink-soft)]">/4</span></div>
                      <div className="text-xs font-mono text-[var(--ink-soft)] mt-2 space-y-0.5">
                        <div>exc {v.distribution.excellent} · good {v.distribution.good}</div>
                        <div>ok {v.distribution.okay} · poor {v.distribution.poor}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid md:grid-cols-2 gap-0 mt-4 brutal-border border-b-0 border-r-0">
                  <div className="p-5 brutal-border border-t-0 border-l-0 bg-white">
                    <div className="mono-label">WHAT WORKED</div>
                    {row.what_worked.length ? (
                      <ul className="mt-2 space-y-2">
                        {row.what_worked.map((q, i) => (
                          <li key={i} className="text-sm border-l-2 border-[var(--green)] pl-3 italic">"{q}"</li>
                        ))}
                      </ul>
                    ) : <div className="text-sm text-[var(--ink-soft)] mt-2">—</div>}
                  </div>
                  <div className="p-5 brutal-border border-t-0 border-l-0 bg-white">
                    <div className="mono-label">WHAT SHOULD IMPROVE</div>
                    {row.what_should_improve.length ? (
                      <ul className="mt-2 space-y-2">
                        {row.what_should_improve.map((q, i) => (
                          <li key={i} className="text-sm border-l-2 border-[var(--red)] pl-3 italic">"{q}"</li>
                        ))}
                      </ul>
                    ) : <div className="text-sm text-[var(--ink-soft)] mt-2">—</div>}
                  </div>
                </div>
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
