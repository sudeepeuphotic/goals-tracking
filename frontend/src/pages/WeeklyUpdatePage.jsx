import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import WeeklyUpdateWidget from "@/components/WeeklyUpdateWidget";
import StatusLight from "@/components/StatusLight";
import EmptyState from "@/components/EmptyState";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function WeeklyUpdatePage() {
  const { user } = useAuth();
  const [objectives, setObjectives] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [updates, setUpdates] = useState([]);

  const load = async () => {
    const [ob, up] = await Promise.all([
      api.get("/objectives"),
      api.get("/updates", { params: { user_id: user.id } }),
    ]);
    const mine = ob.data.filter(o => o.dri_id === user.id || (o.contributor_ids || []).includes(user.id));
    setObjectives(mine);
    setUpdates(up.data);
    if (!activeId && mine.length) setActiveId(mine[0].id);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const active = objectives.find(o => o.id === activeId);
  const filtered = updates.filter(u => u.objective_id === activeId);

  if (!objectives.length) return <div className="p-8"><EmptyState title="Nothing to update yet" hint="You're not on any objectives." /></div>;

  return (
    <div className="p-6 md:p-8 max-w-[1100px] mx-auto">
      <div className="mono-label">WEEKLY UPDATE</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">Under 3 minutes.</h1>

      <div className="mt-6 flex items-center gap-3">
        <div className="mono-label">OBJECTIVE</div>
        <Select value={activeId} onValueChange={setActiveId}>
          <SelectTrigger className="rounded-none border-black w-[360px]" data-testid="weekly-objective-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            {objectives.map(o => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="mono-label">MY TIMELINE</div>
          {filtered.length === 0 && <div className="text-sm text-[var(--ink-soft)]">No updates yet for this objective.</div>}
          {filtered.map(u => (
            <div key={u.id} className="brutal-card p-4">
              <div className="flex items-center gap-3">
                <StatusLight value={u.status} />
                <div className="font-mono text-xs text-[var(--ink-soft)]">{u.week}</div>
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

        <div>{active && <WeeklyUpdateWidget objective={active} onSubmitted={load} />}</div>
      </div>
    </div>
  );
}
