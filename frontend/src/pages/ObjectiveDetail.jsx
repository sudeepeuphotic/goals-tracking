import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusLight from "@/components/StatusLight";
import WeeklyUpdateWidget from "@/components/WeeklyUpdateWidget";
import AIPanel from "@/components/AIPanel";
import ProgressChart from "@/components/ProgressChart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ObjectiveDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [objective, setObjective] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [summary, setSummary] = useState(null);

  const load = async () => {
    const [o, up, us, pl, fb] = await Promise.all([
      api.get(`/objectives/${id}`),
      api.get("/updates", { params: { objective_id: id } }),
      api.get("/users"),
      api.get("/plans", { params: { objective_id: id } }),
      api.get("/feedback", { params: { objective_id: id } }).catch(() => ({ data: [] })),
    ]);
    setObjective(o.data);
    setUpdates(up.data);
    setUsers(us.data);
    setPlans(pl.data);
    setFeedback(fb.data);
    if (user.role === "admin" || user.role === "manager") {
      const s = await api.get("/feedback/summary", { params: { objective_id: id } });
      setSummary(s.data);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!objective) return <div className="p-10 mono-label">Loading…</div>;

  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  const dri = userMap[objective.dri_id];
  const isDRI = objective.dri_id === user.id;
  const isContributor = (objective.contributor_ids || []).includes(user.id);

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <div className="mono-label">OBJECTIVE</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">{objective.title}</h1>
      <p className="text-[var(--ink-soft)] mt-2 max-w-3xl">{objective.description}</p>

      <div className="grid md:grid-cols-4 gap-0 mt-6 brutal-border border-b-0 border-r-0">
        <div className="p-4 brutal-border border-t-0 border-l-0">
          <div className="mono-label">DRI</div>
          <div className="text-sm font-medium mt-1">{dri?.name || "—"}</div>
        </div>
        <div className="p-4 brutal-border border-t-0 border-l-0">
          <div className="mono-label">METRIC</div>
          <div className="text-sm mt-1">{objective.success_metric}</div>
        </div>
        <div className="p-4 brutal-border border-t-0 border-l-0">
          <div className="mono-label">CURRENT → TARGET</div>
          <div className="text-sm font-mono mt-1">{objective.current_value || "—"} → {objective.target_value || "—"}</div>
        </div>
        <div className="p-4 brutal-border border-t-0 border-l-0">
          <div className="mono-label">CONTRIBUTORS</div>
          <div className="text-sm mt-1">{(objective.contributor_ids || []).map(cid => userMap[cid]?.name).filter(Boolean).join(", ") || "—"}</div>
        </div>
      </div>

      <Tabs defaultValue="updates" className="mt-8">
        <TabsList className="rounded-none bg-transparent p-0 border-b-2 border-black w-full justify-start gap-0">
          <TabsTrigger value="updates" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white px-4 py-2" data-testid="tab-updates">Updates</TabsTrigger>
          <TabsTrigger value="plans" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white px-4 py-2" data-testid="tab-plans">Plans</TabsTrigger>
          <TabsTrigger value="feedback" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white px-4 py-2" data-testid="tab-feedback">DRI feedback</TabsTrigger>
          {(user.role === "admin" || user.role === "manager") && (
            <TabsTrigger value="ai" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white px-4 py-2" data-testid="tab-ai">AI analysis</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="updates" className="mt-6">
          <ProgressChart objective={objective} updates={updates} />
          <div className="grid lg:grid-cols-3 gap-6 mt-6">
            <div className="lg:col-span-2 space-y-3">
              {updates.length === 0 ? (
                <div className="text-sm text-[var(--ink-soft)]">No weekly updates yet.</div>
              ) : updates.map(u => (
                <div key={u.id} className="brutal-card p-4">
                  <div className="flex items-center gap-3">
                    <StatusLight value={u.status} />
                    <div className="font-mono text-xs text-[var(--ink-soft)]">{u.week}</div>
                    <div className="ml-auto text-xs font-mono text-[var(--ink-soft)]">{userMap[u.user_id]?.name}</div>
                  </div>
                  <div className="text-sm mt-2">{u.update_text}</div>
                  {(u.progress || u.blockers) && (
                    <div className="flex gap-6 mt-2 text-xs font-mono text-[var(--ink-soft)]">
                      {u.progress && <div>PROGRESS · {u.progress}</div>}
                      {u.blockers && <div>BLOCKERS · {u.blockers}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {(isDRI || isContributor) && (
              <div className="space-y-6">
                <WeeklyUpdateWidget objective={objective} onSubmitted={load} />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="plans" className="mt-6">
          <div className="grid md:grid-cols-2 gap-0 brutal-border border-b-0 border-r-0">
            {plans.length === 0 && <div className="p-6 text-sm text-[var(--ink-soft)]">No plans submitted yet.</div>}
            {plans.map(p => (
              <div key={p.id} className="p-5 brutal-border border-t-0 border-l-0 bg-white">
                <div className="mono-label">{userMap[p.user_id]?.name || "User"} · plan</div>
                <div className="text-sm mt-2"><b>Mission:</b> {p.mission_context || "—"}</div>
                <div className="text-sm mt-1"><b>Role:</b> {p.role_in_objective || "—"}</div>
                <div className="text-sm mt-1"><b>Ownership metric:</b> {p.ownership_metric || "—"} ({p.metric_current} → {p.metric_target})</div>
                {p.goals?.length ? <ol className="text-sm mt-2 list-decimal list-inside">
                  {p.goals.map((g, i) => <li key={i}>{g}</li>)}
                </ol> : null}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="feedback" className="mt-6">
          {(user.role !== "admin" && user.role !== "manager") && (
            <div className="text-sm text-[var(--ink-soft)] mb-4">
              Raw feedback is manager-only. Submit yours via the DRI Feedback page.
            </div>
          )}
          {summary && (
            <div className="brutal-card p-5 mb-6">
              <div className="mono-label">TEAM FEEDBACK · {summary.count} respondent{summary.count !== 1 && "s"}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-3">
                {Object.entries(summary.dimensions).map(([k, v]) => (
                  <div key={k} className="brutal-border p-3">
                    <div className="mono-label">{k.replaceAll("_", " ")}</div>
                    <div className="text-2xl font-mono mt-1">{v.avg}/4</div>
                    <div className="text-xs font-mono text-[var(--ink-soft)]">
                      exc {v.distribution.excellent} · good {v.distribution.good} · ok {v.distribution.okay} · poor {v.distribution.poor}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(user.role === "admin" || user.role === "manager") && feedback.length > 0 && (
            <div className="space-y-3">
              {feedback.map(f => (
                <div key={f.id} className="brutal-card p-4">
                  <div className="mono-label">FROM · {userMap[f.user_id]?.name || "Contributor"}</div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-xs font-mono">
                    <div>clarity: <b>{f.clarity}</b></div>
                    <div>alignment: <b>{f.alignment}</b></div>
                    <div>unblocking: <b>{f.unblocking}</b></div>
                    <div>decision: <b>{f.decision_making}</b></div>
                    <div>quality: <b>{f.quality_bar}</b></div>
                    <div>trajectory: <b>{f.trajectory_impact}</b></div>
                  </div>
                  {(f.what_worked || f.what_should_improve) && (
                    <div className="text-sm mt-2 space-y-1">
                      {f.what_worked && <div><b>Worked:</b> {f.what_worked}</div>}
                      {f.what_should_improve && <div><b>Improve:</b> {f.what_should_improve}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {(user.role === "admin" || user.role === "manager") && (
          <TabsContent value="ai" className="mt-6">
            <AIPanel kind="objective" objectiveId={id} canRun={true} title="AI_ANALYSIS · DRI & OBJECTIVE" />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
