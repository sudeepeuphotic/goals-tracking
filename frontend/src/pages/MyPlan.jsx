import { useEffect, useState, useMemo } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import TasksSection from "@/components/TasksSection";

const FIELDS = [
  { key: "mission_context", label: "Mission context", textarea: true },
  { key: "role_in_objective", label: "Role in objective" },
  { key: "ownership_metric", label: "Ownership metric" },
];

export default function MyPlan() {
  const { user } = useAuth();
  const isManagerOrAdmin = user.role === "admin" || user.role === "manager";

  const [objectives, setObjectives] = useState([]);
  const [users, setUsers] = useState([]);
  const [manageable, setManageable] = useState([]);
  const [plans, setPlans] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [actingAs, setActingAs] = useState(user.id);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [ob, pl, us, mg] = await Promise.all([
      api.get("/objectives"),
      api.get("/plans"),
      api.get("/users"),
      api.get("/users/manageable"),
    ]);
    setObjectives(ob.data);
    setPlans(pl.data);
    setUsers(us.data);
    setManageable(mg.data);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // objectives available to the selected actingAs user
  const relevantObjectives = useMemo(() => {
    return objectives.filter(o =>
      o.dri_id === actingAs || (o.contributor_ids || []).includes(actingAs)
    );
  }, [objectives, actingAs]);

  // when actingAs changes, pick their first objective
  useEffect(() => {
    if (relevantObjectives.length && !relevantObjectives.some(o => o.id === activeId)) {
      setActiveId(relevantObjectives[0].id);
    } else if (!relevantObjectives.length) {
      setActiveId("");
    }
  }, [relevantObjectives, activeId]);

  useEffect(() => {
    if (!activeId || !actingAs) { setForm(null); return; }
    const existing = plans.find(p => p.objective_id === activeId && p.user_id === actingAs);
    setForm(existing || {
      objective_id: activeId,
      mission_context: "", role_in_objective: "", ownership_metric: "",
      metric_current: "", metric_target: "",
      goals: ["", "", ""], key_bets: "", risks: "", kill_list: "",
    });
  }, [activeId, plans, actingAs]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        goals: (form.goals || []).filter(g => (g || "").trim()).slice(0, 3),
        objective_id: activeId,
      };
      const url = (isManagerOrAdmin && actingAs !== user.id) ? `/plans?user_id=${actingAs}` : "/plans";
      await api.post(url, payload);
      toast.success("Plan saved");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  if (!objectives.length && !isManagerOrAdmin) return (
    <div className="p-8"><EmptyState title="No objectives assigned" hint="Ask your admin to add you as a DRI or contributor." /></div>
  );

  const selectedUser = users.find(u => u.id === actingAs);

  return (
    <div className="p-6 md:p-8 max-w-[1100px] mx-auto">
      <div className="mono-label">MY PLAN</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">Individual Planning</h1>
      <p className="text-[var(--ink-soft)] mt-2">&lt; 20 minutes. Crisp. Real.</p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {isManagerOrAdmin && (
          <div className="flex items-center gap-2">
            <div className="mono-label">ACTING AS</div>
            <Select value={actingAs} onValueChange={setActingAs}>
              <SelectTrigger className="rounded-none border-black w-[260px]" data-testid="plan-acting-as"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={user.id}>Myself</SelectItem>
                {manageable.filter(u => u.id !== user.id).map(u =>
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
            <SelectTrigger className="rounded-none border-black w-[360px]" data-testid="plan-objective-select"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {relevantObjectives.length ? relevantObjectives.map(o =>
                <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
              ) : <div className="px-3 py-2 text-sm text-[var(--ink-soft)]">No objectives for this person</div>}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isManagerOrAdmin && selectedUser && actingAs !== user.id && (
        <div className="mt-4 brutal-border p-3 bg-[#FFD600] text-sm flex items-center gap-2">
          <span className="mono-label">EDITING ON BEHALF OF</span>
          <span className="font-semibold">{selectedUser.name}</span>
          <span className="mono-label opacity-70">· {selectedUser.role}</span>
        </div>
      )}

      {!form && isManagerOrAdmin && !relevantObjectives.length && (
        <div className="mt-8"><EmptyState title={`${selectedUser?.name || "This user"} is not on any objective yet`}
          hint="Assign them as a DRI or contributor in Cycles & Objectives first." /></div>
      )}

      {form && (
        <div className="mt-6 space-y-0 brutal-border border-b-0">
          {FIELDS.map(f => (
            <div key={f.key} className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white">
              <Label className="mono-label">{f.label}</Label>
              {f.textarea ? (
                <Textarea className="rounded-none border-black mt-2 min-h-[80px]"
                  value={form[f.key] || ""} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  data-testid={`plan-${f.key}`} />
              ) : (
                <Input className="rounded-none border-black mt-2" value={form[f.key] || ""}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })} data-testid={`plan-${f.key}`} />
              )}
            </div>
          ))}

          <div className="grid grid-cols-2 gap-0 brutal-border border-t-0 border-l-0 border-r-0">
            <div className="p-5 brutal-border border-t-0 border-l-0">
              <Label className="mono-label">Metric — current</Label>
              <Input className="rounded-none border-black mt-2 font-mono" value={form.metric_current || ""}
                onChange={e => setForm({ ...form, metric_current: e.target.value })} data-testid="plan-metric-current" />
            </div>
            <div className="p-5 brutal-border border-t-0 border-l-0">
              <Label className="mono-label">Metric — target</Label>
              <Input className="rounded-none border-black mt-2 font-mono" value={form.metric_target || ""}
                onChange={e => setForm({ ...form, metric_target: e.target.value })} data-testid="plan-metric-target" />
            </div>
          </div>

          <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white">
            <Label className="mono-label">Goals (max 3)</Label>
            <div className="space-y-2 mt-2">
              {(form.goals || ["", "", ""]).slice(0, 3).map((g, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="mono-label w-6">0{i + 1}</span>
                  <Input className="rounded-none border-black" value={g}
                    onChange={e => {
                      const g2 = [...(form.goals || ["", "", ""])]; g2[i] = e.target.value;
                      setForm({ ...form, goals: g2 });
                    }} data-testid={`plan-goal-${i}`} />
                </div>
              ))}
            </div>
          </div>

          {["key_bets", "risks", "kill_list"].map(k => (
            <div key={k} className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white">
              <Label className="mono-label">{k.replaceAll("_", " ")}</Label>
              <Textarea className="rounded-none border-black mt-2 min-h-[70px]" value={form[k] || ""}
                onChange={e => setForm({ ...form, [k]: e.target.value })} data-testid={`plan-${k}`} />
            </div>
          ))}

          <TasksSection
            plan={plans.find(p => p.objective_id === activeId && p.user_id === actingAs)}
            onChanged={load}
          />
        </div>
      )}

      {form && (
        <div className="mt-6 flex justify-end">
          <Button onClick={save} disabled={saving} className="rounded-none bg-black text-white" data-testid="plan-save">
            {saving ? "Saving…" : (isManagerOrAdmin && actingAs !== user.id ? `Save plan for ${selectedUser?.name} →` : "Save plan →")}
          </Button>
        </div>
      )}
    </div>
  );
}
