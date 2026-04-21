import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import WeeklyUpdateWidget from "@/components/WeeklyUpdateWidget";
import StatusLight from "@/components/StatusLight";
import EmptyState from "@/components/EmptyState";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

function currentWeekISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export default function WeeklyUpdatePage() {
  const { user } = useAuth();
  const isManagerOrAdmin = user.role === "admin" || user.role === "manager";

  const [objectives, setObjectives] = useState([]);
  const [users, setUsers] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [actingAs, setActingAs] = useState(user.id);
  const [allUpdates, setAllUpdates] = useState([]);

  const load = async () => {
    const [ob, us] = await Promise.all([api.get("/objectives"), api.get("/users")]);
    setObjectives(ob.data);
    setUsers(us.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // objectives relevant to actingAs
  const relevantObjectives = useMemo(() => objectives.filter(o =>
    isManagerOrAdmin ? true : (o.dri_id === user.id || (o.contributor_ids || []).includes(user.id))
  ), [objectives, isManagerOrAdmin, user.id]);

  useEffect(() => {
    if (relevantObjectives.length && !relevantObjectives.some(o => o.id === activeId)) {
      setActiveId(relevantObjectives[0].id);
    }
  }, [relevantObjectives, activeId]);

  // load updates based on current view
  useEffect(() => {
    if (!activeId) return;
    (async () => {
      const params = { objective_id: activeId };
      const r = await api.get("/updates", { params });
      setAllUpdates(r.data);
    })();
  }, [activeId]);

  const active = relevantObjectives.find(o => o.id === activeId);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  const selectedUser = users.find(u => u.id === actingAs);

  // team tracker: updates for this objective, grouped by user, this week
  const trackerRows = useMemo(() => {
    if (!active) return [];
    const people = [active.dri_id, ...(active.contributor_ids || [])];
    const week = currentWeekISO();
    return people.map(uid => {
      const uUpdates = allUpdates
        .filter(u => u.user_id === uid)
        .slice()
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      const thisWeek = uUpdates.find(u => u.week === week);
      return {
        user: userMap[uid],
        thisWeek,
        latest: uUpdates[0],
        total: uUpdates.length,
        isDri: uid === active.dri_id,
      };
    }).filter(r => r.user);
  }, [active, allUpdates, userMap]);

  if (!relevantObjectives.length) return <div className="p-8"><EmptyState title="Nothing to update yet" hint="You're not on any objectives." /></div>;

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto">
      <div className="mono-label">WEEKLY UPDATE</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">Under 3 minutes.</h1>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {isManagerOrAdmin && (
          <div className="flex items-center gap-2">
            <div className="mono-label">ACTING AS</div>
            <Select value={actingAs} onValueChange={setActingAs}>
              <SelectTrigger className="rounded-none border-black w-[260px]" data-testid="weekly-acting-as"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={user.id}>Myself</SelectItem>
                {users.filter(u => u.id !== user.id).map(u =>
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} · {u.role}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="mono-label">OBJECTIVE</div>
          <Select value={activeId} onValueChange={setActiveId}>
            <SelectTrigger className="rounded-none border-black w-[360px]" data-testid="weekly-objective-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {relevantObjectives.map(o => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isManagerOrAdmin && selectedUser && actingAs !== user.id && (
        <div className="mt-4 brutal-border p-3 bg-[#FFD600] text-sm flex items-center gap-2">
          <span className="mono-label">SUBMITTING ON BEHALF OF</span>
          <span className="font-semibold">{selectedUser.name}</span>
          <span className="mono-label opacity-70">· {selectedUser.role}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2 space-y-3">
          {isManagerOrAdmin ? (
            <>
              <div className="mono-label">TEAM TRACKER · {currentWeekISO()}</div>
              <div className="brutal-border border-b-0 border-r-0" data-testid="team-tracker-grid">
                {trackerRows.map(r => (
                  <div key={r.user.id} className="grid grid-cols-[170px_100px_1fr_70px] items-center p-3 brutal-border border-t-0 border-l-0 bg-white">
                    <div>
                      <div className="text-sm font-medium">{r.user.name}</div>
                      <div className="mono-label">{r.isDri ? "DRI" : r.user.role}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusLight value={r.thisWeek?.status} />
                      <span className="text-xs font-mono">{r.thisWeek ? r.thisWeek.status.toUpperCase() : "PENDING"}</span>
                    </div>
                    <div className="text-sm pr-4 truncate">
                      {r.thisWeek
                        ? r.thisWeek.update_text
                        : <span className="text-[var(--ink-soft)]">No update this week · last: {r.latest ? `"${(r.latest.update_text || "").slice(0, 60)}…"` : "none"}</span>}
                    </div>
                    <div className="text-xs font-mono text-[var(--ink-soft)] text-right">{r.total} total</div>
                  </div>
                ))}
                {!trackerRows.length && <div className="p-6 text-sm text-[var(--ink-soft)]">No team members on this objective.</div>}
              </div>

              <div className="mt-6 mono-label">FULL TIMELINE</div>
              {allUpdates.length === 0 && <div className="text-sm text-[var(--ink-soft)]">No updates yet for this objective.</div>}
              {allUpdates.map(u => (
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
            </>
          ) : (
            <>
              <div className="mono-label">MY TIMELINE</div>
              {allUpdates.filter(u => u.user_id === user.id).length === 0 &&
                <div className="text-sm text-[var(--ink-soft)]">No updates yet for this objective.</div>}
              {allUpdates.filter(u => u.user_id === user.id).map(u => (
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
            </>
          )}
        </div>

        <div>
          {active && (
            <WeeklyUpdateWidget objective={active}
              actingAsUserId={actingAs !== user.id ? actingAs : null}
              onSubmitted={() => {
                // refresh updates
                (async () => {
                  const r = await api.get("/updates", { params: { objective_id: activeId } });
                  setAllUpdates(r.data);
                })();
              }} />
          )}
        </div>
      </div>
    </div>
  );
}
