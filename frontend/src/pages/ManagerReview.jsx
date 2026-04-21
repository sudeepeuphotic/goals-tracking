import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import StatusLight from "@/components/StatusLight";
import AIPanel from "@/components/AIPanel";
import { toast } from "sonner";

export default function ManagerReview() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [objectives, setObjectives] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedObjective, setSelectedObjective] = useState("");
  const [plans, setPlans] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [indRefls, setIndRefls] = useState([]);
  const [driRefls, setDriRefls] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [summary, setSummary] = useState(null);
  const [review, setReview] = useState({ final_evaluation: "", optional_score: "", disagreement_note_vs_ai: "" });

  const load = async () => {
    const [us, ob, cy] = await Promise.all([api.get("/users"), api.get("/objectives"), api.get("/cycles")]);
    setUsers(us.data);
    setObjectives(ob.data);
    setCycles(cy.data);
    if (!selectedUser && us.data.length) setSelectedUser(us.data.find(u => u.role !== "admin")?.id || us.data[0].id);
    if (!selectedObjective && ob.data.length) setSelectedObjective(ob.data[0].id);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!selectedUser) return;
    (async () => {
      const [pl, up, ir] = await Promise.all([
        api.get("/plans", { params: { user_id: selectedUser } }),
        api.get("/updates", { params: { user_id: selectedUser } }),
        api.get("/reflections/individual", { params: { user_id: selectedUser } }),
      ]);
      setPlans(pl.data);
      setUpdates(up.data);
      setIndRefls(ir.data);
    })();
  }, [selectedUser]);

  useEffect(() => {
    if (!selectedObjective) return;
    (async () => {
      const [dr, fb, sm] = await Promise.all([
        api.get("/reflections/dri", { params: { objective_id: selectedObjective } }),
        api.get("/feedback", { params: { objective_id: selectedObjective } }),
        api.get("/feedback/summary", { params: { objective_id: selectedObjective } }),
      ]);
      setDriRefls(dr.data);
      setFeedback(fb.data);
      setSummary(sm.data);
    })();
  }, [selectedObjective]);

  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  const activeCycle = cycles.find(c => c.status === "active") || cycles[0];
  const targetObjective = objectives.find(o => o.id === selectedObjective);

  const saveReview = async (subject_type, subject_id) => {
    try {
      await api.post("/manager-review", {
        subject_type, subject_id, cycle_id: activeCycle?.id,
        final_evaluation: review.final_evaluation,
        optional_score: review.optional_score ? Number(review.optional_score) : null,
        disagreement_note_vs_ai: review.disagreement_note_vs_ai,
      });
      toast.success("Manager review saved");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (!(user.role === "manager" || user.role === "admin")) {
    return <div className="p-8 mono-label">Manager or admin only.</div>;
  }

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <div className="mono-label">MANAGER REVIEW</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">Evaluate the cycle.</h1>

      <Tabs defaultValue="individual" className="mt-6">
        <TabsList className="rounded-none bg-transparent p-0 border-b-2 border-black w-full justify-start gap-0">
          <TabsTrigger value="individual" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white px-4 py-2" data-testid="mr-tab-individual">Individual</TabsTrigger>
          <TabsTrigger value="objective" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white px-4 py-2" data-testid="mr-tab-objective">Objective / DRI</TabsTrigger>
          <TabsTrigger value="team-fb" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white px-4 py-2" data-testid="mr-tab-team">DRI feedback</TabsTrigger>
          <TabsTrigger value="ai" className="rounded-none data-[state=active]:bg-black data-[state=active]:text-white px-4 py-2" data-testid="mr-tab-ai">AI analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="individual" className="mt-6">
          <div className="flex gap-3 items-center mb-4">
            <div className="mono-label">PERSON</div>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger className="rounded-none border-black w-[320px]" data-testid="mr-select-user"><SelectValue /></SelectTrigger>
              <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="brutal-card p-5">
                <div className="mono-label">PLANS ({plans.length})</div>
                {plans.map(p => (
                  <div key={p.id} className="mt-3 text-sm">
                    <div className="font-medium">{objectives.find(o=>o.id===p.objective_id)?.title || "Objective"}</div>
                    <div className="text-[var(--ink-soft)]">Goals: {(p.goals || []).join(" · ")}</div>
                  </div>
                ))}
                {!plans.length && <div className="text-sm text-[var(--ink-soft)] mt-2">No plans submitted.</div>}
              </div>

              <div className="brutal-card p-5">
                <div className="mono-label">UPDATE TIMELINE ({updates.length})</div>
                <div className="mt-3 space-y-2">
                  {updates.slice(0, 12).map(u => (
                    <div key={u.id} className="flex items-center gap-3 text-sm">
                      <StatusLight value={u.status} />
                      <span className="font-mono text-xs text-[var(--ink-soft)] w-24">{u.week}</span>
                      <span className="truncate">{u.update_text}</span>
                    </div>
                  ))}
                  {!updates.length && <div className="text-sm text-[var(--ink-soft)]">No updates.</div>}
                </div>
              </div>

              <div className="brutal-card p-5">
                <div className="mono-label">REFLECTIONS</div>
                {indRefls.length ? indRefls.map(r => (
                  <div key={r.id} className="mt-3 text-sm">
                    <div className="font-medium">{objectives.find(o=>o.id===r.objective_id)?.title}</div>
                    <div className="text-[var(--ink-soft)] text-xs mt-1">Wins: {r.wins || "—"}</div>
                    <div className="text-[var(--ink-soft)] text-xs">Failures: {r.failures || "—"}</div>
                    <div className="text-[var(--ink-soft)] text-xs">Learnings: {r.learnings || "—"}</div>
                  </div>
                )) : <div className="text-sm text-[var(--ink-soft)] mt-2">No reflection yet.</div>}
              </div>
            </div>

            <div className="space-y-4">
              <AIPanel kind="individual" userId={selectedUser} objectiveId={selectedObjective} canRun={true} title="AI_ANALYSIS · INDIVIDUAL" />
              <div className="brutal-card p-5">
                <div className="mono-label">FINAL EVALUATION</div>
                <Textarea className="rounded-none border-black mt-2" value={review.final_evaluation}
                  onChange={e => setReview({ ...review, final_evaluation: e.target.value })} data-testid="mr-eval" />
                <Label className="mono-label mt-3 block">Optional score (1-5)</Label>
                <Input className="rounded-none border-black mt-1 font-mono" type="number" min="1" max="5"
                  value={review.optional_score} onChange={e => setReview({ ...review, optional_score: e.target.value })}
                  data-testid="mr-score" />
                <Label className="mono-label mt-3 block">Disagreement note vs AI</Label>
                <Textarea className="rounded-none border-black mt-1" value={review.disagreement_note_vs_ai}
                  onChange={e => setReview({ ...review, disagreement_note_vs_ai: e.target.value })}
                  data-testid="mr-disagreement" />
                <Button className="mt-3 w-full rounded-none bg-black text-white" data-testid="mr-save-individual"
                  onClick={() => saveReview("individual", selectedUser)}>Save review →</Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="objective" className="mt-6">
          <div className="flex gap-3 items-center mb-4">
            <div className="mono-label">OBJECTIVE</div>
            <Select value={selectedObjective} onValueChange={setSelectedObjective}>
              <SelectTrigger className="rounded-none border-black w-[320px]" data-testid="mr-select-obj"><SelectValue /></SelectTrigger>
              <SelectContent>{objectives.map(o => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="brutal-card p-5">
                <div className="mono-label">DRI REFLECTION</div>
                {driRefls.length ? driRefls.map(r => (
                  <div key={r.id} className="mt-3 text-sm">
                    <div className="font-mono text-xs">Outcome: {r.objective_outcome}</div>
                    <div className="text-[var(--ink-soft)] text-xs mt-1">Worked: {r.what_worked}</div>
                    <div className="text-[var(--ink-soft)] text-xs">Failed: {r.what_failed}</div>
                    <div className="text-[var(--ink-soft)] text-xs">Change: {r.what_should_change}</div>
                  </div>
                )) : <div className="text-sm text-[var(--ink-soft)] mt-2">No DRI reflection yet.</div>}
              </div>
            </div>
            <div className="space-y-4">
              <AIPanel kind="objective" objectiveId={selectedObjective} canRun={true} title="AI_ANALYSIS · OBJECTIVE" />
              <div className="brutal-card p-5">
                <div className="mono-label">EVALUATE DRI</div>
                <Textarea className="rounded-none border-black mt-2" placeholder="Final evaluation"
                  value={review.final_evaluation} onChange={e => setReview({ ...review, final_evaluation: e.target.value })} />
                <Input className="rounded-none border-black mt-3 font-mono" placeholder="Score 1-5" type="number"
                  value={review.optional_score} onChange={e => setReview({ ...review, optional_score: e.target.value })} />
                <Button className="mt-3 w-full rounded-none bg-black text-white" data-testid="mr-save-objective"
                  onClick={() => saveReview("objective", selectedObjective)}>Save review →</Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="team-fb" className="mt-6">
          <div className="flex gap-3 items-center mb-4">
            <div className="mono-label">OBJECTIVE</div>
            <Select value={selectedObjective} onValueChange={setSelectedObjective}>
              <SelectTrigger className="rounded-none border-black w-[320px]"><SelectValue /></SelectTrigger>
              <SelectContent>{objectives.map(o => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {summary && (
            <div className="brutal-card p-5">
              <div className="mono-label">TEAM FEEDBACK · {summary.count} respondents · DRI: {userMap[targetObjective?.dri_id]?.name}</div>
              <div className="grid md:grid-cols-3 gap-4 mt-3">
                {Object.entries(summary.dimensions).map(([k, v]) => (
                  <div key={k} className="brutal-border p-3">
                    <div className="mono-label">{k.replaceAll("_", " ")}</div>
                    <div className="text-3xl font-mono mt-1">{v.avg}<span className="text-sm text-[var(--ink-soft)]">/4</span></div>
                    <div className="text-xs font-mono text-[var(--ink-soft)] mt-1">
                      exc {v.distribution.excellent} · good {v.distribution.good} · ok {v.distribution.okay} · poor {v.distribution.poor}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-6 space-y-3">
            {feedback.map(f => (
              <div key={f.id} className="brutal-card p-4">
                <div className="mono-label">FROM · {userMap[f.user_id]?.name || "Contributor"}</div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs font-mono">
                  {["clarity","alignment","unblocking","decision_making","quality_bar","trajectory_impact"].map(k =>
                    <div key={k}>{k}: <b>{f[k]}</b></div>)}
                </div>
                {(f.what_worked || f.what_should_improve) && (
                  <div className="text-sm mt-2 space-y-1">
                    {f.what_worked && <div><b>Worked:</b> {f.what_worked}</div>}
                    {f.what_should_improve && <div><b>Improve:</b> {f.what_should_improve}</div>}
                  </div>
                )}
              </div>
            ))}
            {!feedback.length && <div className="text-sm text-[var(--ink-soft)]">No feedback yet.</div>}
          </div>
        </TabsContent>

        <TabsContent value="ai" className="mt-6">
          <div className="grid lg:grid-cols-2 gap-6">
            <AIPanel kind="objective" objectiveId={selectedObjective} canRun={true} title="AI · OBJECTIVE" />
            <AIPanel kind="individual" userId={selectedUser} objectiveId={selectedObjective} canRun={true} title="AI · INDIVIDUAL" />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
