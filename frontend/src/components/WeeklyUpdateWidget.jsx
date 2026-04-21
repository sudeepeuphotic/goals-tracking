import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

function currentWeekISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export default function WeeklyUpdateWidget({ objective, onSubmitted, actingAsUserId }) {
  const [status, setStatus] = useState("green");
  const [text, setText] = useState("");
  const [blockers, setBlockers] = useState("");
  const [progress, setProgress] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!text.trim()) { toast.error("Please add a short update"); return; }
    setSaving(true);
    try {
      const url = actingAsUserId ? `/updates?user_id=${actingAsUserId}` : "/updates";
      await api.post(url, {
        objective_id: objective.id,
        week: currentWeekISO(),
        status, update_text: text.trim(),
        blockers, progress,
      });
      toast.success(actingAsUserId ? "Update submitted on their behalf" : "Weekly update submitted");
      setText(""); setBlockers(""); setProgress("");
      onSubmitted?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const lights = [
    { v: "green", label: "ON TRACK" },
    { v: "yellow", label: "AT RISK" },
    { v: "red", label: "OFF TRACK" },
  ];

  return (
    <div className="brutal-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="mono-label">WEEKLY UPDATE · {currentWeekISO()}</div>
          <div className="text-sm font-medium truncate">{objective.title}</div>
        </div>
      </div>

      <div className="flex gap-0 mb-3" data-testid="weekly-traffic-light">
        {lights.map((l, i) => (
          <button key={l.v} onClick={() => setStatus(l.v)} data-testid={`status-${l.v}`}
            className={`flex-1 h-10 brutal-border ${i > 0 ? "border-l-0" : ""} text-xs font-mono
              ${status === l.v ? "bg-black text-white" : "bg-white hover:bg-[var(--surface-hover)]"}`}>
            <span className={`inline-block w-2.5 h-2.5 mr-2 align-middle status-dot-${l.v}`} />
            {l.label}
          </button>
        ))}
      </div>

      <Textarea
        placeholder="2–3 lines: what moved this week? What's next?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="rounded-none border-black min-h-[72px]"
        data-testid="weekly-update-text"
      />
      <div className="grid grid-cols-2 gap-0 mt-0 brutal-border border-t-0">
        <Input placeholder="Progress (e.g. 60%)" value={progress} onChange={(e)=>setProgress(e.target.value)}
          className="rounded-none border-0 border-r border-black h-10 font-mono" data-testid="weekly-progress" />
        <Input placeholder="Blockers (optional)" value={blockers} onChange={(e)=>setBlockers(e.target.value)}
          className="rounded-none border-0 h-10" data-testid="weekly-blockers" />
      </div>

      <Button onClick={submit} disabled={saving} data-testid="weekly-submit"
        className="w-full mt-4 rounded-none bg-black hover:bg-[var(--accent)] text-white">
        {saving ? "Submitting…" : "Submit update →"}
      </Button>
    </div>
  );
}
