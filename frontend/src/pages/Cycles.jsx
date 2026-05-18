import { useEffect, useState } from "react";
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
import { isManagerOrAdmin } from "@/lib/roles";
import { asArray } from "@/lib/safe";

export default function Cycles() {
  const { user } = useAuth();
  const nav = useNavigate();
  const userIsManagerOrAdmin = isManagerOrAdmin(user);

  const [cycles, setCycles] = useState([]);
  const [objectives, setObjectives] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedCycleId, setSelectedCycleId] = useState(null);

  const [cycleForm, setCycleForm] = useState({ name: "", start_date: "", end_date: "" });
  const [objForm, setObjForm] = useState({
    title: "", description: "", dri_id: "", success_metric: "",
    current_value: "", target_value: "", contributor_ids: [], rigor_questions: [""]
  });
  const [openCycle, setOpenCycle] = useState(false);
  const [openObj, setOpenObj] = useState(false);

  const load = async () => {
    const [cy, ob, us] = await Promise.all([api.get("/cycles"), api.get("/objectives"), api.get("/users")]);
    const cyclesData = asArray(cy.data);
    setCycles(cyclesData);
    setObjectives(asArray(ob.data));
    setUsers(asArray(us.data));
    if (!selectedCycleId && cyclesData.length) setSelectedCycleId(cyclesData[0].id);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

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
      await api.post("/objectives", {
        ...objForm,
        cycle_id: selectedCycleId,
        rigor_questions: objForm.rigor_questions.filter(q => q.trim()),
      });
      toast.success("Objective created");
      setOpenObj(false);
      setObjForm({ title: "", description: "", dri_id: "", success_metric: "",
        current_value: "", target_value: "", contributor_ids: [], rigor_questions: [""] });
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const selectedCycle = cycles.find(c => c.id === selectedCycleId);
  const cycleObjectives = objectives.filter(o => o.cycle_id === selectedCycleId);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="mono-label">CYCLES & OBJECTIVES</div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-2">Execution plan</h1>
        </div>
        {userIsManagerOrAdmin && (
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

      {/* Cycles strip */}
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
            {userIsManagerOrAdmin && (
              <Dialog open={openObj} onOpenChange={setOpenObj}>
                <DialogTrigger asChild>
                  <Button className="rounded-none bg-black text-white" data-testid="new-objective-btn">+ New objective</Button>
                </DialogTrigger>
                <DialogContent className="rounded-none border border-black max-w-xl">
                  <DialogHeader><DialogTitle>New Objective</DialogTitle></DialogHeader>
                  <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                    <div><Label>Title</Label>
                      <Input className="rounded-none border-black mt-1" value={objForm.title}
                        onChange={e => setObjForm({ ...objForm, title: e.target.value })} data-testid="obj-title" /></div>
                    <div><Label>Description</Label>
                      <Textarea className="rounded-none border-black mt-1" value={objForm.description}
                        onChange={e => setObjForm({ ...objForm, description: e.target.value })} data-testid="obj-desc" /></div>
                    <div>
                      <Label>DRI</Label>
                      <Select value={objForm.dri_id} onValueChange={v => setObjForm({ ...objForm, dri_id: v })}>
                        <SelectTrigger className="rounded-none border-black mt-1" data-testid="obj-dri"><SelectValue placeholder="Select a DRI" /></SelectTrigger>
                        <SelectContent className="rounded-none">
                          {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
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
                      <Label>Contributors</Label>
                      <div className="mt-1 max-h-40 overflow-y-auto brutal-border p-2 space-y-1">
                        {users.filter(u => u.id !== objForm.dri_id).map(u => {
                          const checked = objForm.contributor_ids.includes(u.id);
                          return (
                            <label key={u.id} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={checked} onChange={() => {
                                setObjForm({
                                  ...objForm,
                                  contributor_ids: checked
                                    ? objForm.contributor_ids.filter(id => id !== u.id)
                                    : [...objForm.contributor_ids, u.id]
                                });
                              }} />
                              {u.name} <span className="mono-label">· {u.role}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <Label>Rigor questions</Label>
                      {objForm.rigor_questions.map((q, i) => (
                        <Input key={i} value={q} placeholder={`Question ${i + 1}`}
                          className="rounded-none border-black mt-1"
                          onChange={e => {
                            const next = [...objForm.rigor_questions]; next[i] = e.target.value;
                            setObjForm({ ...objForm, rigor_questions: next });
                          }} />
                      ))}
                      <Button variant="ghost" size="sm" className="rounded-none mt-1"
                        onClick={() => setObjForm({ ...objForm, rigor_questions: [...objForm.rigor_questions, ""] })}>
                        + Add question
                      </Button>
                    </div>
                  </div>
                  <DialogFooter><Button className="rounded-none bg-black text-white" onClick={createObjective} data-testid="save-objective">Create</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-0 brutal-border border-b-0 border-r-0">
            {cycleObjectives.map(o => {
              const dri = userMap[o.dri_id];
              return (
                <button key={o.id} onClick={() => nav(`/objectives/${o.id}`)} data-testid={`objective-${o.id}`}
                  className="text-left p-5 brutal-border border-t-0 border-l-0 bg-white hover:bg-[var(--surface-hover)]">
                  <div className="mono-label">OBJECTIVE</div>
                  <div className="text-lg font-semibold mt-1">{o.title}</div>
                  <p className="text-sm text-[var(--ink-soft)] mt-1 line-clamp-2">{o.description}</p>
                  <div className="mt-3 flex items-center gap-3 text-xs font-mono text-[var(--ink-soft)]">
                    <span>DRI · {dri?.name || "—"}</span>
                    <span>·</span>
                    <span>{(o.contributor_ids || []).length} contributors</span>
                  </div>
                </button>
              );
            })}
            {!cycleObjectives.length && <div className="p-10 text-sm text-[var(--ink-soft)] col-span-2">No objectives yet.</div>}
          </div>
        </>
      )}
    </div>
  );
}
