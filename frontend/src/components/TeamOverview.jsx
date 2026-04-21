import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import StatusLight from "@/components/StatusLight";
import { Button } from "@/components/ui/button";

export default function TeamOverview({ cycle }) {
  const nav = useNavigate();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!cycle) return;
    (async () => {
      const [objRes, userRes, upRes, planRes] = await Promise.all([
        api.get("/objectives", { params: { cycle_id: cycle.id } }),
        api.get("/users"),
        api.get("/updates"),
        api.get("/plans"),
      ]);
      const userMap = Object.fromEntries(userRes.data.map(u => [u.id, u]));
      const updatesByObj = {};
      upRes.data.forEach(u => {
        const list = updatesByObj[u.objective_id] || (updatesByObj[u.objective_id] = []);
        list.push(u);
      });
      const plansByObj = {};
      planRes.data.forEach(p => {
        const list = plansByObj[p.objective_id] || (plansByObj[p.objective_id] = []);
        list.push(p);
      });

      // current ISO week
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      const yStart = new Date(d.getFullYear(), 0, 1);
      const week = `${d.getFullYear()}-W${String(Math.ceil((((d - yStart) / 86400000) + 1) / 7)).padStart(2, "0")}`;

      const result = objRes.data.map(o => {
        const contribs = o.contributor_ids || [];
        const people = [o.dri_id, ...contribs];
        const thisWeekCount = people.filter(uid =>
          (updatesByObj[o.id] || []).some(u => u.user_id === uid && u.week === week)
        ).length;
        const latest = (updatesByObj[o.id] || [])
          .slice().sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
        return {
          obj: o,
          dri: userMap[o.dri_id],
          contribs: contribs.map(id => userMap[id]).filter(Boolean),
          totalUpdates: (updatesByObj[o.id] || []).length,
          plansCount: (plansByObj[o.id] || []).length,
          thisWeekPct: people.length ? Math.round((thisWeekCount / people.length) * 100) : 0,
          latestStatus: latest?.status || null,
          latestText: latest?.update_text || "",
        };
      });
      setRows(result);
    })();
  }, [cycle]);

  if (!cycle) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="mono-label">TEAM OVERVIEW · {cycle.name}</div>
          <h2 className="text-2xl font-semibold tracking-tight mt-1">
            {rows ? `${rows.length} objective${rows.length !== 1 ? "s" : ""} this cycle` : "Loading…"}
          </h2>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => nav("/cycles")} className="rounded-none bg-black text-white" data-testid="to-manage-cycles">
            + Manage cycles →
          </Button>
        </div>
      </div>

      {rows && rows.length === 0 && (
        <div className="brutal-card scanlines p-8 text-center">
          <div className="mono-label">NO OBJECTIVES</div>
          <div className="text-lg font-semibold mt-2">This cycle has no objectives yet.</div>
          <Button onClick={() => nav("/cycles")} className="mt-4 rounded-none bg-black text-white" data-testid="to-create-objectives">
            Create objectives →
          </Button>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="grid md:grid-cols-2 gap-0 brutal-border border-b-0 border-r-0" data-testid="team-overview-grid">
          {rows.map((r) => (
            <button key={r.obj.id} onClick={() => nav(`/objectives/${r.obj.id}`)}
              data-testid={`overview-obj-${r.obj.id}`}
              className="text-left p-5 brutal-border border-t-0 border-l-0 bg-white hover:bg-[var(--surface-hover)]">
              <div className="flex items-center justify-between">
                <div className="mono-label">OBJECTIVE</div>
                <div className="flex items-center gap-2 text-xs font-mono text-[var(--ink-soft)]">
                  <StatusLight value={r.latestStatus} />
                  <span>{r.latestStatus ? r.latestStatus.toUpperCase() : "NO DATA"}</span>
                </div>
              </div>
              <div className="text-lg font-semibold mt-1">{r.obj.title}</div>
              {r.latestText && (
                <div className="text-sm text-[var(--ink-soft)] mt-2 line-clamp-2">"{r.latestText}"</div>
              )}
              <div className="grid grid-cols-3 gap-0 mt-4 brutal-border border-b-0 border-r-0">
                <div className="p-2 brutal-border border-t-0 border-l-0">
                  <div className="mono-label">DRI</div>
                  <div className="text-sm font-medium mt-0.5 truncate">{r.dri?.name || "—"}</div>
                </div>
                <div className="p-2 brutal-border border-t-0 border-l-0">
                  <div className="mono-label">THIS WEEK</div>
                  <div className="text-sm font-mono mt-0.5">{r.thisWeekPct}%</div>
                </div>
                <div className="p-2 brutal-border border-t-0 border-l-0">
                  <div className="mono-label">METRIC</div>
                  <div className="text-sm font-mono mt-0.5 truncate">
                    {r.obj.current_value || "—"} → {r.obj.target_value || "—"}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-3 text-xs font-mono text-[var(--ink-soft)]">
                <span>{r.contribs.length} contributor{r.contribs.length !== 1 && "s"}</span>
                <span>·</span>
                <span>{r.totalUpdates} update{r.totalUpdates !== 1 && "s"}</span>
                <span>·</span>
                <span>{r.plansCount} plan{r.plansCount !== 1 && "s"}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
