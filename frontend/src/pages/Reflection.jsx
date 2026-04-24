import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { asArray } from "@/lib/safe";

const IND_FIELDS = [
  ["goal_outcomes", "Goal outcomes — what happened on each goal?"],
  ["contribution_to_objective", "Your contribution to the objective"],
  ["what_moved_metric", "What moved the metric?"],
  ["wins", "Wins"],
  ["failures", "Failures"],
  ["learnings", "Learnings"],
  ["support_needed", "Support needed"],
  ["bottlenecks", "Bottlenecks"],
  ["trajectory_change", "Trajectory change"],
  ["ceo_question_response", "CEO question"],
];

const DRI_FIELDS = [
  ["actual_metrics", "Actual metrics at end of cycle"],
  ["what_worked", "What worked"],
  ["what_failed", "What failed"],
  ["alignment_quality", "Alignment quality"],
  ["execution_quality", "Execution quality"],
  ["major_blockers", "Major blockers"],
  ["what_should_change", "What should change next cycle"],
  ["ceo_question_response", "CEO question"],
];

const REFLECTION_MODE = {
  INDIVIDUAL: "individual",
  DRI: "dri",
};

export default function Reflection() {
  const { user } = useAuth();
  const [objectives, setObjectives] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [individual, setIndividual] = useState(null);
  const [driRef, setDriRef] = useState(null);
  const [mode, setMode] = useState(REFLECTION_MODE.INDIVIDUAL);

  const load = async () => {
    const [ob, ir, dr] = await Promise.all([
      api.get("/objectives"),
      api.get("/reflections/individual").catch(()=>({data:[]})),
      api.get("/reflections/dri").catch(()=>({data:[]})),
    ]);
    const objectivesData = asArray(ob.data);
    const indData = asArray(ir.data);
    const driData = asArray(dr.data);
    const mine = objectivesData.filter(o => o.dri_id === user.id || (o.contributor_ids || []).includes(user.id));
    setObjectives(mine);
    if (!activeId && mine.length) setActiveId(mine[0].id);

    const active = mine.find(o => o.id === (activeId || mine[0]?.id));
    if (!active) return;
    const ind = indData.find(r => r.objective_id === active.id && r.user_id === user.id);
    setIndividual(ind || {
      objective_id: active.id,
      goal_outcomes: "", contribution_to_objective: "", what_moved_metric: "",
      wins: "", failures: "", learnings: "", support_needed: "",
      bottlenecks: "", trajectory_change: "", ceo_question_response: "",
      rigor_answers: Object.fromEntries((active.rigor_questions || []).map(q => [q, ""])),
    });
    if (active.dri_id === user.id) {
      const d = driData.find(r => r.objective_id === active.id);
      setDriRef(d || {
        objective_id: active.id,
        objective_outcome: "achieved",
        actual_metrics: "", what_worked: "", what_failed: "",
        alignment_quality: "", execution_quality: "",
        major_blockers: "", what_should_change: "", ceo_question_response: "",
      });
    } else {
      setDriRef(null);
      if (mode === REFLECTION_MODE.DRI) setMode(REFLECTION_MODE.INDIVIDUAL);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeId, user.id]);

  const active = objectives.find(o => o.id === activeId);

  const saveIndividual = async () => {
    try {
      await api.post("/reflections/individual", individual);
      toast.success("Reflection saved");
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const saveDri = async () => {
    try {
      await api.post("/reflections/dri", driRef);
      toast.success("DRI reflection saved");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (!objectives.length) return <div className="p-8"><EmptyState title="No reflections needed yet" hint="You're not on any objectives." /></div>;

  return (
    <div className="p-6 md:p-8 max-w-[1000px] mx-auto">
      <div className="mono-label">END-OF-CYCLE REFLECTION</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">Honest, structured, short.</h1>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="mono-label">OBJECTIVE</div>
        <Select value={activeId} onValueChange={setActiveId}>
          <SelectTrigger className="rounded-none border-black w-[360px]" data-testid="refl-objective-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            {objectives.map(o => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}
          </SelectContent>
        </Select>
        {active?.dri_id === user.id && (
          <div className="flex brutal-border" data-testid="refl-mode-toggle">
            <button onClick={() => setMode(REFLECTION_MODE.INDIVIDUAL)} className={`px-3 py-1 text-xs font-mono ${mode === REFLECTION_MODE.INDIVIDUAL ? "bg-black text-white" : "bg-white"}`}>INDIVIDUAL</button>
            <button onClick={() => setMode(REFLECTION_MODE.DRI)} className={`px-3 py-1 text-xs font-mono border-l border-black ${mode === REFLECTION_MODE.DRI ? "bg-black text-white" : "bg-white"}`}>DRI</button>
          </div>
        )}
      </div>

      {mode === REFLECTION_MODE.INDIVIDUAL && individual && (
        <div className="mt-6 brutal-border border-r-0 border-b-0">
          {IND_FIELDS.map(([k, label]) => (
            <div key={k} className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white">
              <Label className="mono-label">{label}</Label>
              <Textarea className="rounded-none border-black mt-2" value={individual[k] || ""}
                onChange={e => setIndividual({ ...individual, [k]: e.target.value })} data-testid={`refl-${k}`} />
            </div>
          ))}
          {active && (active.rigor_questions || []).length > 0 && (
            <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white">
              <Label className="mono-label">Rigor questions</Label>
              <div className="mt-2 space-y-3">
                {active.rigor_questions.map((q, i) => (
                  <div key={i}>
                    <div className="text-sm font-medium">{q}</div>
                    <Input className="rounded-none border-black mt-1"
                      value={individual.rigor_answers?.[q] || ""}
                      onChange={e => setIndividual({ ...individual,
                        rigor_answers: { ...(individual.rigor_answers || {}), [q]: e.target.value } })}
                      data-testid={`refl-rigor-${i}`} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-[var(--surface-hover)] flex justify-end">
            <Button onClick={saveIndividual} className="rounded-none bg-black text-white" data-testid="refl-save-individual">Save reflection →</Button>
          </div>
        </div>
      )}

      {mode === REFLECTION_MODE.DRI && driRef && (
        <div className="mt-6 brutal-border border-r-0 border-b-0">
          <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white">
            <Label className="mono-label">Objective outcome</Label>
            <div className="flex mt-2 brutal-border">
              {["achieved", "partial", "not_achieved"].map((v, i) => (
                <button key={v} onClick={() => setDriRef({ ...driRef, objective_outcome: v })}
                  className={`flex-1 px-3 py-2 text-xs font-mono uppercase ${i > 0 ? "border-l border-black" : ""}
                    ${driRef.objective_outcome === v ? "bg-black text-white" : "bg-white hover:bg-[var(--surface-hover)]"}`}
                  data-testid={`dri-outcome-${v}`}>
                  {v.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
          {DRI_FIELDS.map(([k, label]) => (
            <div key={k} className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white">
              <Label className="mono-label">{label}</Label>
              <Textarea className="rounded-none border-black mt-2" value={driRef[k] || ""}
                onChange={e => setDriRef({ ...driRef, [k]: e.target.value })} data-testid={`dri-${k}`} />
            </div>
          ))}
          <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-[var(--surface-hover)] flex justify-end">
            <Button onClick={saveDri} className="rounded-none bg-black text-white" data-testid="dri-save">Save DRI reflection →</Button>
          </div>
        </div>
      )}
    </div>
  );
}
