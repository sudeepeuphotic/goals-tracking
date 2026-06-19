import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { asArray } from "@/lib/safe";
import { isAdmin } from "@/lib/roles";
import GoalProgressBar from "@/components/GoalProgressBar";
import StatusLight from "@/components/StatusLight";
import { Button } from "@/components/ui/button";

function goalLabels(plan) {
  const assigned = (plan?.assigned_goals || []).map(g => (typeof g === "string" ? g : g.text)).filter(Boolean);
  const personal = (plan?.goals || []).filter(Boolean);
  return [...assigned, ...personal];
}

function MemberProgress({ user, plan, roleLabel }) {
  const goals = goalLabels(plan);
  return (
    <div className="p-4 brutal-border border-t-0 border-l-0 bg-white">
      <div className="flex items-center gap-2 mb-2">
        <span className="mono-label">{roleLabel}</span>
        <span className="text-sm font-medium">{user?.name || "—"}</span>
      </div>
      <GoalProgressBar
        label={plan?.ownership_metric ? "Ownership metric" : "Plan progress"}
        metricName={plan?.ownership_metric || undefined}
        current={plan?.metric_current}
        target={plan?.metric_target}
      />
      {goals.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {goals.map((g, i) => (
            <li key={i} className="flex gap-2">
              <span className="mono-label">0{i + 1}</span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function GoalsProgressOverview({ cycle, user }) {
  const nav = useNavigate();
  const [rows, setRows] = useState(null);

  const showAllDris = isAdmin(user);

  useEffect(() => {
    if (!cycle) return;
    let cancelled = false;
    (async () => {
      try {
        const [objRes, userRes, upRes] = await Promise.all([
          api.get("/objectives", { params: { cycle_id: cycle.id } }),
          api.get("/users"),
          api.get("/updates"),
        ]);
        if (cancelled) return;
        const objectives = asArray(objRes.data);
        const users = asArray(userRes.data);
        const updates = asArray(upRes.data);
        const userMap = Object.fromEntries(users.map(u => [u.id, u]));

        const relevantObjectives = showAllDris
          ? objectives.filter(o => !o.parent_objective_id)
          : objectives.filter(o => o.dri_id === user.id && !o.parent_objective_id);

        const planLists = await Promise.all(
          relevantObjectives.map(o =>
            api.get("/plans", { params: { objective_id: o.id } }).then(r => asArray(r.data))
          )
        );
        if (cancelled) return;

        const result = relevantObjectives.map((o, idx) => {
          const plans = planLists[idx] || [];
          const planByUser = Object.fromEntries(plans.map(p => [p.user_id, p]));
          const contribs = o.contributor_ids || [];
          const latest = updates
            .filter(u => u.objective_id === o.id)
            .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];

          return {
            obj: o,
            dri: userMap[o.dri_id],
            driPlan: planByUser[o.dri_id],
            contributors: contribs.map(id => ({ user: userMap[id], plan: planByUser[id] })).filter(c => c.user),
            latestStatus: latest?.status || null,
          };
        });

        setRows(result);
      } catch (_e) {
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [cycle, user.id, showAllDris]);

  if (!cycle) return null;

  const title = showAllDris ? "ALL DRIs · PROGRESS" : "YOUR OBJECTIVES · PROGRESS";

  return (
    <div className="space-y-4 mb-8" data-testid="goals-progress-overview">
      <div className="flex items-end justify-between">
        <div>
          <div className="mono-label">{title}</div>
          <h2 className="text-2xl font-semibold tracking-tight mt-1">
            {rows ? `${rows.length} objective${rows.length !== 1 ? "s" : ""}` : "Loading…"}
          </h2>
        </div>
        {showAllDris && (
          <Button onClick={() => nav("/cycles")} className="rounded-none bg-black text-white" data-testid="progress-manage-cycles">
            Manage cycles →
          </Button>
        )}
        {!showAllDris && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => nav("/cycles")} className="rounded-none bg-black text-white" data-testid="dri-new-objective">
              New team objective →
            </Button>
            {rows && rows.length > 0 && (
              <Button onClick={() => nav(`/objectives/${rows[0].obj.id}?tab=plans`)} variant="outline" className="rounded-none border-black" data-testid="dri-manage-goals">
                Update team goals →
              </Button>
            )}
          </div>
        )}
      </div>

      {rows && rows.length === 0 && (
        <div className="brutal-card p-8 text-center text-sm text-[var(--ink-soft)]">
          No objectives in this cycle yet.
        </div>
      )}

      {rows && rows.map((r) => (
        <div key={r.obj.id} className="brutal-border border-b-0 border-r-0" data-testid={`progress-obj-${r.obj.id}`}>
          <button
            type="button"
            onClick={() => nav(`/objectives/${r.obj.id}`)}
            className="w-full text-left p-4 brutal-border border-t-0 border-l-0 bg-[var(--surface-hover)] hover:bg-[#f5f5f0]"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="mono-label">OBJECTIVE</div>
                <div className="text-lg font-semibold mt-0.5">{r.obj.title}</div>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono shrink-0">
                <StatusLight value={r.latestStatus} />
                <span>{r.latestStatus ? r.latestStatus.toUpperCase() : "NO UPDATE"}</span>
              </div>
            </div>
            <GoalProgressBar
              className="mt-3"
              label={r.obj.rollup_progress != null ? "Team rollup" : "Objective metric"}
              metricName={r.obj.rollup_progress != null ? "From sub-objectives" : r.obj.success_metric}
              current={r.obj.rollup_progress != null ? String(r.obj.rollup_progress) : r.obj.current_value}
              target={r.obj.rollup_progress != null ? "100" : r.obj.target_value}
            />
          </button>

          <MemberProgress user={r.dri} plan={r.driPlan} roleLabel="DRI" />
          {r.contributors.map(c => (
            <MemberProgress
              key={c.user.id}
              user={c.user}
              plan={c.plan}
              roleLabel="CONTRIBUTOR"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
