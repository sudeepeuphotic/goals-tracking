import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import StatusLight from "@/components/StatusLight";
import WeeklyUpdateWidget from "@/components/WeeklyUpdateWidget";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import AIPanel from "@/components/AIPanel";
import { Bell } from "lucide-react";

function currentWeekISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [cycles, setCycles] = useState([]);
  const [objectives, setObjectives] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [cy, ob, up, pl] = await Promise.all([
      api.get("/cycles"),
      api.get("/objectives"),
      api.get("/updates", { params: { user_id: user.id } }),
      api.get("/plans", { params: { user_id: user.id } }),
    ]);
    setCycles(cy.data);
    setObjectives(ob.data);
    setUpdates(up.data);
    setPlans(pl.data);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const activeCycle = useMemo(() => cycles.find(c => c.status === "active") || cycles[0], [cycles]);
  const myObjectives = useMemo(() => {
    if (!activeCycle) return [];
    return objectives.filter(o => o.cycle_id === activeCycle.id && (
      o.dri_id === user.id || (o.contributor_ids || []).includes(user.id)
    ));
  }, [objectives, activeCycle, user]);

  const currentObjective = myObjectives[0];
  const myPlan = useMemo(() => plans.find(p => p.objective_id === currentObjective?.id), [plans, currentObjective]);
  const latestUpdate = useMemo(() => updates.find(u => u.objective_id === currentObjective?.id), [updates, currentObjective]);

  const thisWeek = currentWeekISO();
  const overdueObjectives = useMemo(() =>
    myObjectives.filter(o => !updates.some(u => u.objective_id === o.id && u.week === thisWeek)),
    [myObjectives, updates, thisWeek]
  );
  const canSeeAI = user.role === "admin" || user.role === "manager";

  if (loading) return <div className="p-10 mono-label">Loading…</div>;

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="mono-label">WELCOME · {new Date().toDateString()}</div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mt-2">Hi {user.name?.split(" ")[0]}.</h1>
          <p className="text-[var(--ink-soft)] mt-2">{activeCycle ? `You're in ${activeCycle.name}.` : "No active cycle yet."}</p>
        </div>
        {activeCycle && (
          <div className="brutal-card px-4 py-3">
            <div className="mono-label">CYCLE</div>
            <div className="text-sm font-medium">{activeCycle.name}</div>
            <div className="text-xs font-mono text-[var(--ink-soft)]">{activeCycle.start_date} → {activeCycle.end_date}</div>
          </div>
        )}
      </div>

      {!currentObjective ? (
        <EmptyState title="No objectives yet" hint="Ask your admin to assign you as a DRI or contributor to an objective."
          action={<Button onClick={() => nav("/cycles")} className="rounded-none bg-black text-white" data-testid="go-cycles-btn">Go to cycles →</Button>} />
      ) : (
        <>
          {overdueObjectives.length > 0 && (
            <div className="brutal-card p-4 mb-6 flex items-center gap-4 bg-[#FFD600]" data-testid="overdue-banner">
              <Bell size={18} />
              <div className="flex-1">
                <div className="mono-label">REMINDER · {thisWeek}</div>
                <div className="text-sm font-medium">
                  {overdueObjectives.length} objective{overdueObjectives.length > 1 ? "s" : ""} waiting for your weekly update.
                </div>
              </div>
              <Button onClick={() => nav("/weekly")} className="rounded-none bg-black text-white" data-testid="overdue-cta">
                Submit now →
              </Button>
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-6" data-testid="dashboard-grid">
          {/* Left: objective + plan */}
          <div className="lg:col-span-2 space-y-6">
            <div className="brutal-card p-5">
              <div className="flex items-center justify-between">
                <div className="mono-label">CURRENT OBJECTIVE</div>
                <Button variant="ghost" size="sm" onClick={() => nav(`/objectives/${currentObjective.id}`)}
                  className="rounded-none h-8 text-xs" data-testid="view-objective-btn">VIEW →</Button>
              </div>
              <h2 className="text-2xl font-semibold mt-1">{currentObjective.title}</h2>
              <p className="text-sm text-[var(--ink-soft)] mt-2">{currentObjective.description}</p>

              <div className="grid grid-cols-3 gap-0 mt-4 brutal-border border-b-0 border-r-0">
                <div className="p-3 brutal-border border-t-0 border-l-0">
                  <div className="mono-label">METRIC</div>
                  <div className="text-sm font-medium mt-1">{currentObjective.success_metric || "—"}</div>
                </div>
                <div className="p-3 brutal-border border-t-0 border-l-0">
                  <div className="mono-label">CURRENT</div>
                  <div className="text-sm font-mono mt-1">{currentObjective.current_value || "—"}</div>
                </div>
                <div className="p-3 brutal-border border-t-0 border-l-0">
                  <div className="mono-label">TARGET</div>
                  <div className="text-sm font-mono mt-1">{currentObjective.target_value || "—"}</div>
                </div>
              </div>
            </div>

            <div className="brutal-card p-5">
              <div className="flex items-center justify-between">
                <div className="mono-label">MY GOALS · THIS CYCLE</div>
                <Button variant="ghost" size="sm" onClick={() => nav("/my-plan")}
                  className="rounded-none h-8 text-xs" data-testid="edit-plan-btn">EDIT →</Button>
              </div>
              {myPlan?.goals?.length ? (
                <ol className="mt-3 space-y-2">
                  {myPlan.goals.map((g, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="mono-label pt-0.5">0{i + 1}</span>
                      <span>{g}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-[var(--ink-soft)] mt-3">You haven't filled your plan yet.</p>
              )}
              {myPlan && (
                <div className="grid grid-cols-2 gap-0 mt-5 brutal-border border-b-0 border-r-0">
                  <div className="p-3 brutal-border border-t-0 border-l-0">
                    <div className="mono-label">OWNERSHIP METRIC</div>
                    <div className="text-sm mt-1">{myPlan.ownership_metric || "—"}</div>
                  </div>
                  <div className="p-3 brutal-border border-t-0 border-l-0">
                    <div className="mono-label">STATUS</div>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusLight value={latestUpdate?.status} />
                      <span className="text-sm">{latestUpdate ? latestUpdate.update_text : "No update yet"}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: weekly widget + AI panel */}
          <div className="space-y-6">
            <WeeklyUpdateWidget objective={currentObjective} onSubmitted={load} />
            {canSeeAI && (
              <AIPanel kind="individual" userId={user.id} objectiveId={currentObjective.id}
                canRun={true} title="AI_ANALYSIS · ME" />
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
