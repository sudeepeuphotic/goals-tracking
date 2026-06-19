import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { isAdmin, isManagerOrAdmin } from "@/lib/roles";
import { asArray } from "@/lib/safe";

const EMPTY_GOALS = ["", "", ""];

function goalSlots(map, userId) {
  return map[userId] || EMPTY_GOALS;
}

function MemberGoalInputs({ label, userId, goals, onChange }) {
  return (
    <div className="brutal-border p-3 mt-2">
      <div className="mono-label text-xs">{label}</div>
      {[0, 1, 2].map(i => (
        <Input
          key={i}
          className="rounded-none border-black mt-1"
          placeholder={`Goal ${i + 1}`}
          value={goals[i] || ""}
          onChange={e => {
            const next = [...goals];
            next[i] = e.target.value;
            onChange(userId, next);
          }}
          data-testid={`obj-member-goal-${userId}-${i}`}
        />
      ))}
    </div>
  );
}

export default function Cycles() {
  const { user } = useAuth();
  const nav = useNavigate();
  const userIsAdmin = isAdmin(user);

  const [cycles, setCycles] = useState([]);
  const [objectives, setObjectives] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedCycleId, setSelectedCycleId] = useState(null);

  const [cycleForm, setCycleForm] = useState({ name: "", start_date: "", end_date: "" });
  const [objForm, setObjForm] = useState({
    title: "", description: "", dri_id: "", success_metric: "",
    current_value: "", target_value: "", contributor_ids: [],
    parent_objective_id: "",
  });
  const [memberGoals, setMemberGoals] = useState({});
  const [reportees, setReportees] = useState([]);
  const [openCycle, setOpenCycle] = useState(false);
  const [openObj, setOpenObj] = useState(false);
  const [objMode, setObjMode] = useState("top");

  const load = async () => {
    const [cy, ob, us] = await Promise.all([api.get("/cycles"), api.get("/objectives"), api.get("/users")]);
    const cyclesData = asArray(cy.data);
    setCycles(cyclesData);
    setObjectives(asArray(ob.data));
    setUsers(asArray(us.data));
    if (!selectedCycleId && cyclesData.length) setSelectedCycleId(cyclesData[0].id);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!objForm.dri_id) {
      setReportees([]);
      return;
    }
    api.get("/users/reportees", { params: { manager_id: objForm.dri_id } })
      .then(r => setReportees(asArray(r.data)))
      .catch(() => setReportees([]));
  }, [objForm.dri_id]);

  useEffect(() => {
    if (openObj && objMode === "sub") {
      setObjForm(prev => ({
        ...prev,
        dri_id: user.id,
        contributor_ids: [],
        parent_objective_id: "",
      }));
      setMemberGoals({});
    }
  }, [openObj, objMode, user.id]);

  const selectedCycle = cycles.find(c => c.id === selectedCycleId);
  const cycleObjectives = objectives.filter(o => o.cycle_id === selectedCycleId);

  const parentObjectivesAsDri = useMemo(() => (
    objectives.filter(o =>
      o.dri_id === user.id &&
      !o.parent_objective_id &&
      o.cycle_id === selectedCycleId
    )
  ), [objectives, user.id, selectedCycleId]);
  const userCanCreateSubObjective = parentObjectivesAsDri.length > 0;
  const userCanCreateObjective = isManagerOrAdmin(user) || userCanCreateSubObjective;
  const parentObjectives = parentObjectivesAsDri;

  const topLevelObjectives = useMemo(
    () => cycleObjectives.filter(o => !o.parent_objective_id),
    [cycleObjectives],
  );

  const childrenByParent = useMemo(() => {
    const map = {};
    cycleObjectives.filter(o => o.parent_objective_id).forEach(o => {
      const pid = o.parent_objective_id;
      if (!map[pid]) map[pid] = [];
      map[pid].push(o);
    });
    return map;
  }, [cycleObjectives]);

  const userMap = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);

  const setMemberGoalRow = (userId, goals) => {
    setMemberGoals(prev => ({ ...prev, [userId]: goals }));
  };

  const createCycle = async () => {
    try {
      await api.post("/cycles", cycleForm);
      toast.success("Cycle created");
      setOpenCycle(false);
      setCycleForm({ name: "", start_date: "", end_date: "" });
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const createObjective = async () => {
    try {
      const isSubObjective = objMode === "sub";
      const driId = isSubObjective ? user.id : objForm.dri_id;
      if (!driId) {
        toast.error("Select a DRI");
        return;
      }
      if (isSubObjective) {
        if (!objForm.parent_objective_id) {
          toast.error("Select the manager-assigned parent objective");
          return;
        }
        if (objForm.contributor_ids.length !== 1) {
          toast.error("Select exactly one contributor for this team sub-objective");
          return;
        }
      }
      const contributorId = isSubObjective ? objForm.contributor_ids[0] : null;
      const initialGoals = contributorId
        ? (memberGoals[contributorId] || []).map(g => (g || "").trim()).filter(Boolean)
        : [];
      const res = await api.post("/objectives", {
        ...objForm,
        dri_id: driId,
        cycle_id: selectedCycleId,
        parent_objective_id: isSubObjective ? objForm.parent_objective_id : null,
        initial_assigned_goals: isSubObjective && initialGoals.length ? initialGoals : undefined,
      });
      const objectiveId = res.data.id;
      if (!isSubObjective) {
        const memberIds = [driId, ...objForm.contributor_ids];
        for (const uid of memberIds) {
          const goals = (memberGoals[uid] || []).map(g => (g || "").trim()).filter(Boolean);
          if (!goals.length) continue;
          await api.put(`/objectives/${objectiveId}/members/${uid}/config`, { assigned_goals: goals });
        }
      }
      toast.success(isSubObjective ? "Team sub-objective created" : "Objective created with team goals");
      setOpenObj(false);
      setObjForm({ title: "", description: "", dri_id: "", success_metric: "",
        current_value: "", target_value: "", contributor_ids: [], parent_objective_id: "" });
      setMemberGoals({});
      load();
    } catch (e) {
      const status = e?.response?.status;
      const detail = formatApiError(e);
      toast.error(status ? `${detail} (HTTP ${status})` : detail);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="mono-label">CYCLES & OBJECTIVES</div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-2">Execution plan</h1>
        </div>
        {userIsAdmin && (
          <Dialog open={openCycle} onOpenChange={setOpenCycle}>
            <DialogTrigger asChild>
              <Button className="rounded-none bg-black text-white brutal-shadow-sm" data-testid="new-cycle-btn">+ New cycle</Button>
            </DialogTrigger>
            <DialogContent className="rounded-none border border-black">
              <DialogHeader><DialogTitle>New Focus Cycle</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label>
                  <Input className="rounded-none border-black mt-1" value={cycleForm.name}
                    onChange={e => setCycleForm({ ...cycleForm, name: e.target.value })} data-testid="cycle-name" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Start date</Label>
                    <Input type="date" className="rounded-none border-black mt-1" value={cycleForm.start_date}
                      onChange={e => setCycleForm({ ...cycleForm, start_date: e.target.value })} data-testid="cycle-start" /></div>
                  <div><Label>End date</Label>
                    <Input type="date" className="rounded-none border-black mt-1" value={cycleForm.end_date}
                      onChange={e => setCycleForm({ ...cycleForm, end_date: e.target.value })} data-testid="cycle-end" /></div>
                </div>
              </div>
              <DialogFooter><Button className="rounded-none bg-black text-white" onClick={createCycle} data-testid="save-cycle">Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex flex-wrap gap-0 mb-6 brutal-border border-b-0 border-r-0">
        {cycles.map(c => (
          <button key={c.id} onClick={() => setSelectedCycleId(c.id)}
            data-testid={`cycle-${c.id}`}
            className={`px-4 py-3 brutal-border border-t-0 border-l-0 text-left min-w-[220px]
              ${selectedCycleId === c.id ? "bg-black text-white" : "bg-white hover:bg-[var(--surface-hover)]"}`}>
            <div className="mono-label">{c.status === "active" ? "ACTIVE" : "CLOSED"}</div>
            <div className="text-sm font-medium">{c.name}</div>
            <div className="text-xs font-mono opacity-70">{c.start_date} → {c.end_date}</div>
          </button>
        ))}
        {!cycles.length && <div className="p-6 text-sm text-[var(--ink-soft)]">No cycles yet.</div>}
      </div>

      {selectedCycle && (
        <>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="mono-label">OBJECTIVES · {selectedCycle.name}</div>
              <div className="text-xl font-semibold">{cycleObjectives.length} objective{cycleObjectives.length !== 1 && "s"}</div>
            </div>
            {userCanCreateObjective && (
              <div className="flex flex-wrap gap-2">
                {userCanCreateSubObjective && (
                  <Button
                    className="rounded-none bg-black text-white"
                    data-testid="new-sub-objective-btn"
                    onClick={() => { setObjMode("sub"); setOpenObj(true); }}
                  >
                    + New team sub-objective
                  </Button>
                )}
                {isManagerOrAdmin(user) && (
                  <Button
                    className="rounded-none bg-black text-white"
                    data-testid="new-objective-btn"
                    onClick={() => { setObjMode("top"); setOpenObj(true); }}
                  >
                    + New objective
                  </Button>
                )}
              </div>
            )}
            <Dialog open={openObj} onOpenChange={setOpenObj}>
                <DialogContent className="rounded-none border border-black max-w-xl">
                  <DialogHeader>
                    <DialogTitle>{objMode === "sub" ? "New team sub-objective" : "New Objective"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                    {objMode === "sub" && (
                      <div>
                        <Label>Parent objective (assigned by manager)</Label>
                        <Select
                          value={objForm.parent_objective_id}
                          onValueChange={v => setObjForm({
                            ...objForm,
                            parent_objective_id: v,
                            contributor_ids: [],
                          })}
                        >
                          <SelectTrigger className="rounded-none border-black mt-1" data-testid="obj-parent">
                            <SelectValue placeholder="Select your assigned objective" />
                          </SelectTrigger>
                          <SelectContent className="rounded-none">
                            {parentObjectives.map(o => (
                              <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!parentObjectives.length && (
                          <p className="text-xs text-[var(--ink-soft)] mt-1">
                            No manager-assigned objectives in this cycle yet.
                          </p>
                        )}
                      </div>
                    )}
                    <div><Label>Title</Label>
                      <Input className="rounded-none border-black mt-1" value={objForm.title}
                        onChange={e => setObjForm({ ...objForm, title: e.target.value })} data-testid="obj-title" /></div>
                    <div><Label>Description</Label>
                      <Textarea className="rounded-none border-black mt-1" value={objForm.description}
                        onChange={e => setObjForm({ ...objForm, description: e.target.value })} data-testid="obj-desc" /></div>
                    {objMode === "sub" ? (
                      <div className="brutal-border p-3 text-sm">
                        <div className="mono-label">DRI</div>
                        <div className="mt-1 font-medium">{user.name} · you</div>
                        <p className="text-xs text-[var(--ink-soft)] mt-1">
                          Progress on this sub-objective rolls up to the parent objective.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <Label>DRI</Label>
                        <Select value={objForm.dri_id} onValueChange={v => setObjForm({
                          ...objForm, dri_id: v, contributor_ids: [],
                        })}>
                          <SelectTrigger className="rounded-none border-black mt-1" data-testid="obj-dri"><SelectValue placeholder="Select a DRI" /></SelectTrigger>
                          <SelectContent className="rounded-none">
                            {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div>
                      <Label>Success metric</Label>
                      <Input className="rounded-none border-black mt-1" value={objForm.success_metric}
                        onChange={e => setObjForm({ ...objForm, success_metric: e.target.value })} data-testid="obj-metric" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Current</Label>
                        <Input className="rounded-none border-black mt-1 font-mono" value={objForm.current_value}
                          onChange={e => setObjForm({ ...objForm, current_value: e.target.value })} /></div>
                      <div><Label>Target</Label>
                        <Input className="rounded-none border-black mt-1 font-mono" value={objForm.target_value}
                          onChange={e => setObjForm({ ...objForm, target_value: e.target.value })} /></div>
                    </div>
                    <div>
                      <Label>{objMode === "sub" ? "Contributor" : "Contributors (from DRI's team)"}</Label>
                      <div className="mt-1 max-h-40 overflow-y-auto brutal-border p-2 space-y-1">
                        {!objForm.dri_id && objMode === "top" && (
                          <p className="text-xs text-[var(--ink-soft)]">Select a DRI first.</p>
                        )}
                        {objMode === "sub" && !objForm.parent_objective_id && (
                          <p className="text-xs text-[var(--ink-soft)]">Select a parent objective first.</p>
                        )}
                        {objForm.dri_id && !reportees.length && (
                          <p className="text-xs text-[var(--ink-soft)]">No team members under this DRI. Set reporting structure in Team &amp; Reporting.</p>
                        )}
                        {reportees.map(u => {
                          const checked = objMode === "sub"
                            ? objForm.contributor_ids[0] === u.id
                            : objForm.contributor_ids.includes(u.id);
                          return (
                            <label key={u.id} className="flex items-center gap-2 text-sm">
                              <input
                                type={objMode === "sub" ? "radio" : "checkbox"}
                                name={objMode === "sub" ? "dri-contributor" : undefined}
                                checked={checked}
                                onChange={() => {
                                  if (objMode === "sub") {
                                    setObjForm({ ...objForm, contributor_ids: [u.id] });
                                    return;
                                  }
                                  setObjForm({
                                    ...objForm,
                                    contributor_ids: checked
                                      ? objForm.contributor_ids.filter(id => id !== u.id)
                                      : [...objForm.contributor_ids, u.id],
                                  });
                                }}
                              />
                              {u.name} <span className="mono-label">· {u.role}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {objForm.dri_id && (objMode === "sub" ? objForm.contributor_ids.length > 0 : true) && (
                      <div>
                        <Label>{objMode === "sub" ? "Contributor goals" : "Individual goals (assigned at creation)"}</Label>
                        <p className="text-xs text-[var(--ink-soft)] mt-1">
                          {objMode === "sub"
                            ? "Set up to 3 goals. Completion rolls up to your parent objective."
                            : "Set up to 3 goals per person. DRI can update contributor goals later."}
                        </p>
                        {objMode === "top" && (
                          <MemberGoalInputs
                            label={`DRI · ${userMap[objForm.dri_id]?.name || "—"}`}
                            userId={objForm.dri_id}
                            goals={goalSlots(memberGoals, objForm.dri_id)}
                            onChange={setMemberGoalRow}
                          />
                        )}
                        {objForm.contributor_ids.map(cid => (
                          <MemberGoalInputs
                            key={cid}
                            label={`Contributor · ${userMap[cid]?.name || "—"}`}
                            userId={cid}
                            goals={goalSlots(memberGoals, cid)}
                            onChange={setMemberGoalRow}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <DialogFooter><Button className="rounded-none bg-black text-white" onClick={createObjective} data-testid="save-objective">Create</Button></DialogFooter>
                </DialogContent>
              </Dialog>
          </div>

          <div className="grid md:grid-cols-2 gap-0 brutal-border border-b-0 border-r-0">
            {topLevelObjectives.map(o => {
              const dri = userMap[o.dri_id];
              const children = childrenByParent[o.id] || [];
              return (
                <div key={o.id} className="brutal-border border-t-0 border-l-0 bg-white">
                  <button type="button" onClick={() => nav(`/objectives/${o.id}`)} data-testid={`objective-${o.id}`}
                    className="w-full text-left p-5 hover:bg-[var(--surface-hover)]">
                    <div className="mono-label">PARENT OBJECTIVE</div>
                    <div className="text-lg font-semibold mt-1">{o.title}</div>
                    <p className="text-sm text-[var(--ink-soft)] mt-1 line-clamp-2">{o.description}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-mono text-[var(--ink-soft)]">
                      <span>DRI · {dri?.name || "—"}</span>
                      {o.rollup_progress != null && (
                        <span className="text-black">ROLLUP · {o.rollup_progress}%</span>
                      )}
                      <span>· {children.length} team sub-objective{children.length !== 1 ? "s" : ""}</span>
                    </div>
                  </button>
                  {children.map(child => {
                    const contrib = userMap[child.contributor_ids?.[0]];
                    return (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => nav(`/objectives/${child.id}`)}
                        data-testid={`objective-${child.id}`}
                        className="w-full text-left p-4 pl-8 border-t border-black/20 hover:bg-[var(--surface-hover)]"
                      >
                        <div className="mono-label">SUB-OBJECTIVE · {contrib?.name || "Contributor"}</div>
                        <div className="text-sm font-medium mt-0.5">{child.title}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {!topLevelObjectives.length && <div className="p-10 text-sm text-[var(--ink-soft)] col-span-2">No objectives yet.</div>}
          </div>
        </>
      )}
    </div>
  );
}
