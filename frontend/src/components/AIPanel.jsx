import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

function ListBlock({ label, items }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <div className="mono-label">{label}</div>
      <ul className="mt-1 space-y-1">
        {items.map((s, i) => (
          <li key={i} className="text-sm flex gap-2"><span className="mono-label pt-0.5 w-6">0{i + 1}</span><span>{s}</span></li>
        ))}
      </ul>
    </div>
  );
}

export default function AIPanel({
  kind,                    // "individual" or "objective"
  objectiveId,
  userId,
  canRun = false,
  title = "AI_ANALYSIS",
}) {
  const [status, setStatus] = useState({ enabled: false });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const s = await api.get("/ai/status");
      setStatus(s.data);
    } catch (_e) { /* ignore */ }
    try {
      const params = kind === "individual"
        ? { kind: "individual", user_id: userId, objective_id: objectiveId }
        : { kind: "objective", objective_id: objectiveId };
      const r = await api.get("/ai/evaluations", { params });
      if (r.data?.length) setResult(r.data[0]);
    } catch (_e) { /* ignore */ }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kind, objectiveId, userId]);

  const run = async () => {
    setLoading(true);
    try {
      if (kind === "individual") {
        const r = await api.post(`/ai/evaluate-individual?user_id=${userId}&objective_id=${objectiveId}`);
        setResult(r.data);
      } else {
        const r = await api.post(`/ai/evaluate-objective?objective_id=${objectiveId}`);
        setResult(r.data);
      }
      toast.success("AI analysis generated");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  };

  const disabled = !status.enabled;

  return (
    <div className={`brutal-card ${!result ? "scanlines" : ""} p-5`}>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label flex items-center gap-2">
          <Sparkles size={12} />{title}
        </div>
        {canRun && (
          <Button size="sm" disabled={disabled || loading} onClick={run}
            className="rounded-none bg-black text-white h-7 text-xs" data-testid={`ai-run-${kind}`}>
            {loading ? "Thinking…" : result ? "Re-run" : "Run AI"}
          </Button>
        )}
      </div>

      {!status.enabled && (
        <div className="font-mono text-sm text-[var(--ink-soft)]">AI_DISABLED · set AI_ENABLED=true + GOOGLE_API_KEY</div>
      )}

      {status.enabled && !result && (
        <>
          <div className="font-mono text-sm text-[var(--ink-soft)]">AI_ANALYSIS_PENDING</div>
          <p className="mt-2 text-sm text-[var(--ink-soft)] max-w-lg">
            {canRun ? "Click Run AI to synthesise plans, updates, reflections, and feedback into a structured evaluation."
                    : "Manager-only. Ask a manager or admin to generate the analysis."}
          </p>
        </>
      )}

      {result && (
        <div>
          <p className="text-sm leading-relaxed">{result.output.executive_summary || result.output.objective_outcome_summary}</p>

          {kind === "individual" ? (
            <>
              <ListBlock label="STRENGTHS" items={result.output.strength_signals} />
              <ListBlock label="RISKS" items={result.output.risk_signals} />
              <ListBlock label="EVIDENCE GAPS" items={result.output.evidence_gaps} />
              <ListBlock label="MANAGER ATTENTION" items={result.output.manager_attention_points} />
              <ListBlock label="VERIFY THIS" items={result.output.verify_this} />
              <div className="mt-4 flex items-center gap-3 brutal-border p-3">
                <div className="mono-label">TENTATIVE SCORE</div>
                <div className="text-2xl font-mono">{result.output.tentative_score}/5</div>
              </div>
            </>
          ) : (
            <>
              {result.output.leadership_signals && (
                <div className="mt-3">
                  <div className="mono-label">LEADERSHIP SIGNALS</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    {Object.entries(result.output.leadership_signals).map(([k, v]) => (
                      <div key={k} className="brutal-border p-2">
                        <div className="mono-label">{k}</div>
                        <div>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <ListBlock label="TEAM FEEDBACK PATTERNS" items={result.output.team_feedback_patterns} />
              {result.output.mismatch && (
                <div className="mt-3"><div className="mono-label">SELF vs TEAM MISMATCH</div>
                  <div className="text-sm mt-1">{result.output.mismatch}</div></div>
              )}
              <ListBlock label="EXECUTION RISKS" items={result.output.risks_in_execution} />
              <div className="mt-4 flex items-center gap-3 brutal-border p-3">
                <div className="mono-label">TENTATIVE DRI SCORE</div>
                <div className="text-2xl font-mono">{result.output.tentative_dri_score}/5</div>
              </div>
            </>
          )}

          <div className="mono-label mt-4 text-[10px] opacity-70">
            Generated {new Date(result.created_at).toLocaleString()} · {result.model}
          </div>
        </div>
      )}
    </div>
  );
}
