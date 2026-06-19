import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import IndividualReflectionForm from "@/components/IndividualReflectionForm";
import { asArray } from "@/lib/safe";
import { DRI_REFLECTION_FIELDS } from "@/lib/reflectionFields";
import { normalizeIndividualReflection } from "@/lib/reflectionDefaults";

const DRI_FIELDS = DRI_REFLECTION_FIELDS;

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
  const [myPlan, setMyPlan] = useState(null);
  const [mode, setMode] = useState(REFLECTION_MODE.INDIVIDUAL);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [ob, ir, dr, pl] = await Promise.all([
      api.get("/objectives"),
      api.get("/reflections/individual").catch(() => ({ data: [] })),
      api.get("/reflections/dri").catch(() => ({ data: [] })),
      api.get("/plans").catch(() => ({ data: [] })),
    ]);
    const objectivesData = asArray(ob.data);
    const indData = asArray(ir.data);
    const driData = asArray(dr.data);
    const plansData = asArray(pl.data);
    const mine = objectivesData.filter(o => o.dri_id === user.id || (o.contributor_ids || []).includes(user.id));
    setObjectives(mine);
    if (!activeId && mine.length) setActiveId(mine[0].id);

    const active = mine.find(o => o.id === (activeId || mine[0]?.id));
    if (!active) return;
    const plan = plansData.find(p => p.objective_id === active.id && p.user_id === user.id);
    setMyPlan(plan || null);
    const rigorQs = plan?.rigor_questions || [];
    const ind = indData.find(r => r.objective_id === active.id && r.user_id === user.id);
    setIndividual(normalizeIndividualReflection(ind, active.id, plan, rigorQs));

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
    setSaving(true);
    try {
      await api.post("/reflections/individual", individual);
      toast.success("Reflection saved");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  const saveDri = async () => {
    try {
      await api.post("/reflections/dri", driRef);
      toast.success("DRI reflection saved");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (!objectives.length) {
    return (
      <div className="p-8">
        <EmptyState title="No reflections needed yet" hint="You're not on any objectives." />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-[1000px] mx-auto">
      <div className="mono-label">END-OF-CYCLE REFLECTION</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">Honest, structured, short.</h1>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="mono-label">OBJECTIVE</div>
        <Select value={activeId} onValueChange={setActiveId}>
          <SelectTrigger className="rounded-none border-black w-[360px]" data-testid="refl-objective-select">
            <SelectValue />
          </SelectTrigger>
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
        <IndividualReflectionForm
          reflection={individual}
          myPlan={myPlan}
          onChange={setIndividual}
          onSave={saveIndividual}
          saving={saving}
        />
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
