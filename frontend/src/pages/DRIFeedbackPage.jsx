import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { asArray } from "@/lib/safe";

const DIMS = [
  ["clarity", "Clarity", "How clearly did the DRI communicate direction?"],
  ["alignment", "Alignment", "How well was the team aligned with the mission?"],
  ["unblocking", "Unblocking", "How effectively did the DRI remove blockers?"],
  ["decision_making", "Decision making", "Quality and speed of decisions?"],
  ["quality_bar", "Quality bar", "Did the DRI hold a high bar?"],
  ["trajectory_impact", "Trajectory impact", "Did working with them change your trajectory?"],
];
const OPTS = ["excellent", "good", "okay", "poor"];

function SegControl({ value, onChange, testIdPrefix }) {
  return (
    <div className="flex brutal-border">
      {OPTS.map((o, i) => (
        <button key={o} onClick={() => onChange(o)}
          data-testid={`${testIdPrefix}-${o}`}
          className={`flex-1 px-3 py-2 text-xs font-mono uppercase ${i > 0 ? "border-l border-black" : ""}
            ${value === o ? "bg-black text-white" : "bg-white hover:bg-[var(--surface-hover)]"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

export default function DRIFeedbackPage() {
  const { user } = useAuth();
  const [objectives, setObjectives] = useState([]);
  const [users, setUsers] = useState([]);
  const [feedbackMap, setFeedbackMap] = useState({}); // objective_id -> fb
  const [activeId, setActiveId] = useState("");
  const [form, setForm] = useState(null);

  const load = async () => {
    const [ob, us] = await Promise.all([api.get("/objectives"), api.get("/users")]);
    const objectivesData = asArray(ob.data);
    const usersData = asArray(us.data);
    // I can give feedback where I am contributor (not DRI)
    const mine = objectivesData.filter(o => (o.contributor_ids || []).includes(user.id) && o.dri_id !== user.id);
    setObjectives(mine);
    setUsers(usersData);
    if (!activeId && mine.length) setActiveId(mine[0].id);

    const fbMap = {};
    for (const o of mine) {
      const r = await api.get("/feedback", { params: { objective_id: o.id } });
      const mine_fb = asArray(r.data).find(f => f.user_id === user.id);
      if (mine_fb) fbMap[o.id] = mine_fb;
    }
    setFeedbackMap(fbMap);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user.id]);

  useEffect(() => {
    if (!activeId) return;
    const existing = feedbackMap[activeId];
    setForm(existing || {
      objective_id: activeId,
      clarity: "good", alignment: "good", unblocking: "good",
      decision_making: "good", quality_bar: "good", trajectory_impact: "good",
      clarity_example: "", alignment_example: "", unblocking_example: "",
      decision_example: "", quality_example: "", trajectory_example: "",
      what_worked: "", what_should_improve: "",
    });
  }, [activeId, feedbackMap]);

  const active = objectives.find(o => o.id === activeId);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  const dri = active ? userMap[active.dri_id] : null;

  const submit = async () => {
    try {
      await api.post("/feedback", form);
      toast.success("Feedback submitted");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (!objectives.length) return <div className="p-8"><EmptyState title="No DRI feedback requested" hint="You're not a contributor on any objectives yet." /></div>;

  return (
    <div className="p-6 md:p-8 max-w-[1100px] mx-auto">
      <div className="mono-label">DRI FEEDBACK</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">Rate your leads.</h1>
      <p className="text-[var(--ink-soft)] mt-2">Signal quality helps the org. Manager-only visibility for raw feedback.</p>

      <div className="mt-6 flex flex-wrap gap-0 brutal-border border-r-0 border-b-0">
        {objectives.map(o => (
          <button key={o.id} onClick={() => setActiveId(o.id)}
            data-testid={`fb-objective-${o.id}`}
            className={`p-4 brutal-border border-t-0 border-l-0 text-left min-w-[240px]
              ${activeId === o.id ? "bg-black text-white" : "bg-white hover:bg-[var(--surface-hover)]"}`}>
            <div className="mono-label">{feedbackMap[o.id] ? "SUBMITTED" : "PENDING"}</div>
            <div className="text-sm font-medium">{o.title}</div>
            <div className="mono-label mt-1">DRI · {userMap[o.dri_id]?.name || "—"}</div>
          </button>
        ))}
      </div>

      {form && active && (
        <div className="mt-6 brutal-border border-r-0 border-b-0">
          {DIMS.map(([k, label, hint]) => (
            <div key={k} className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white">
              <div className="flex items-baseline justify-between">
                <Label className="mono-label">{label}</Label>
                <div className="text-xs text-[var(--ink-soft)]">{hint}</div>
              </div>
              <div className="mt-2">
                <SegControl value={form[k]} onChange={(v) => setForm({ ...form, [k]: v })} testIdPrefix={`fb-${k}`} />
              </div>
              <Textarea className="rounded-none border-black mt-2 min-h-[56px]"
                placeholder={`Example of ${label.toLowerCase()} (optional)`}
                value={form[`${k === "decision_making" ? "decision" : k === "quality_bar" ? "quality" : k === "trajectory_impact" ? "trajectory" : k}_example`] || ""}
                onChange={(e) => setForm({
                  ...form,
                  [`${k === "decision_making" ? "decision" : k === "quality_bar" ? "quality" : k === "trajectory_impact" ? "trajectory" : k}_example`]: e.target.value
                })}
                data-testid={`fb-${k}-example`}
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-0 brutal-border border-t-0 border-l-0 border-r-0">
            <div className="p-5 brutal-border border-t-0 border-l-0 bg-white">
              <Label className="mono-label">What worked?</Label>
              <Textarea className="rounded-none border-black mt-2" value={form.what_worked}
                onChange={e => setForm({ ...form, what_worked: e.target.value })} data-testid="fb-what-worked" />
            </div>
            <div className="p-5 brutal-border border-t-0 border-l-0 bg-white">
              <Label className="mono-label">What should improve?</Label>
              <Textarea className="rounded-none border-black mt-2" value={form.what_should_improve}
                onChange={e => setForm({ ...form, what_should_improve: e.target.value })} data-testid="fb-improve" />
            </div>
          </div>
          <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-[var(--surface-hover)] flex justify-end">
            <Button onClick={submit} className="rounded-none bg-black text-white" data-testid="fb-submit">Submit feedback →</Button>
          </div>
        </div>
      )}
    </div>
  );
}
