import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ACHIEVEMENT_OPTIONS } from "@/lib/reflectionFields";

function Section({ number, title, children, testId }) {
  return (
    <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white" data-testid={testId}>
      <Label className="mono-label">{number} {title}</Label>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, testId, rows = 3 }) {
  return (
    <div>
      {label ? <div className="text-sm font-medium">{label}</div> : null}
      <Textarea
        className="rounded-none border-black mt-1 min-h-[72px]"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        data-testid={testId}
        rows={rows}
      />
    </div>
  );
}

export default function IndividualReflectionForm({ reflection, myPlan, onChange, onSave, saving }) {
  const set = (key, value) => onChange({ ...reflection, [key]: value });

  const setGoalOutcome = (index, patch) => {
    const next = [...(reflection.goal_outcomes || [])];
    next[index] = { ...next[index], ...patch };
    set("goal_outcomes", next);
  };

  const rigorQuestions = myPlan?.rigor_questions || [];

  return (
    <div className="mt-6 brutal-border border-r-0 border-b-0">
      <Section number="5.1" title="Goal Outcomes" testId="refl-section-goal-outcomes">
        {(reflection.goal_outcomes || []).length === 0 && (
          <p className="text-sm text-[var(--ink-soft)]">No goals on your plan yet. Ask your DRI or admin to assign goals.</p>
        )}
        {(reflection.goal_outcomes || []).map((g, i) => (
          <div key={g.goal_text || i} className="brutal-border p-3 space-y-2">
            <div className="text-sm font-semibold">{g.goal_text || `Goal ${i + 1}`}</div>
            <div>
              <div className="text-xs font-mono text-[var(--ink-soft)] mb-1">Achievement</div>
              <Select
                value={g.achievement || ""}
                onValueChange={v => setGoalOutcome(i, { achievement: v })}
              >
                <SelectTrigger className="rounded-none border-black" data-testid={`refl-goal-achievement-${i}`}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  {ACHIEVEMENT_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field label="Actual result" value={g.actual_result} onChange={v => setGoalOutcome(i, { actual_result: v })}
              testId={`refl-goal-result-${i}`} />
            <Field label="What made the biggest difference" value={g.biggest_difference}
              onChange={v => setGoalOutcome(i, { biggest_difference: v })} testId={`refl-goal-diff-${i}`} />
          </div>
        ))}
      </Section>

      <Section number="5.2" title="Contribution to Team Objective" testId="refl-section-contribution">
        <Field label="Did the objective succeed? Why / why not?" value={reflection.objective_succeeded}
          onChange={v => set("objective_succeeded", v)} testId="refl-objective-succeeded" />
        <Field label="What was your contribution?" value={reflection.my_contribution}
          onChange={v => set("my_contribution", v)} testId="refl-my-contribution" />
        <Field label="Where did things break at system level?" value={reflection.system_breaks}
          onChange={v => set("system_breaks", v)} testId="refl-system-breaks" />
      </Section>

      <Section number="5.3" title="What Actually Moved the Metric" testId="refl-section-metric">
        <Field label="" value={reflection.what_moved_metric}
          onChange={v => set("what_moved_metric", v)} testId="refl-what-moved-metric" rows={4} />
      </Section>

      <Section number="5.4" title="Quality of Work (Rigor Check)" testId="refl-section-quality">
        <Field label="What did you build / ship?" value={reflection.quality_built_shipped}
          onChange={v => set("quality_built_shipped", v)} testId="refl-quality-built" />
        <Field label="How was it validated? (tests, real-world runs, metrics)" value={reflection.quality_validation}
          onChange={v => set("quality_validation", v)} testId="refl-quality-validation" />
        <Field label="What edge cases / failure modes were considered?" value={reflection.quality_edge_cases}
          onChange={v => set("quality_edge_cases", v)} testId="refl-quality-edge" />
        <Field label="What would break today?" value={reflection.quality_what_would_break}
          onChange={v => set("quality_what_would_break", v)} testId="refl-quality-break" />
      </Section>

      <Section number="5.5" title="Peer / Review Signal" testId="refl-section-peer">
        <Field label="Was this reviewed? By whom?" value={reflection.peer_reviewed}
          onChange={v => set("peer_reviewed", v)} testId="refl-peer-reviewed" rows={2} />
        <Field label="Key feedback received" value={reflection.peer_feedback}
          onChange={v => set("peer_feedback", v)} testId="refl-peer-feedback" />
        <Field label="What improved after review" value={reflection.peer_improved_after}
          onChange={v => set("peer_improved_after", v)} testId="refl-peer-improved" />
      </Section>

      <Section number="5.6" title="What Didn't Work (and Why)" testId="refl-section-didnt-work">
        <Field label="" value={reflection.what_didnt_work}
          onChange={v => set("what_didnt_work", v)} testId="refl-what-didnt-work" rows={4} />
      </Section>

      <Section number="5.7" title="Biggest Wins / Contributions" testId="refl-section-wins">
        <Field label="" value={reflection.biggest_wins}
          onChange={v => set("biggest_wins", v)} testId="refl-biggest-wins" rows={4} />
      </Section>

      <Section number="5.8" title="Where I Fell Short" testId="refl-section-fell-short">
        <Field label="" value={reflection.where_fell_short}
          onChange={v => set("where_fell_short", v)} testId="refl-where-fell-short" rows={4} />
      </Section>

      <Section number="5.9" title="Key Learnings" testId="refl-section-learnings">
        <Field label="" value={reflection.key_learnings}
          onChange={v => set("key_learnings", v)} testId="refl-key-learnings" rows={4} />
      </Section>

      <Section number="5.10" title="Friction / Bottlenecks" testId="refl-section-friction">
        <Field label="" value={reflection.friction_bottlenecks}
          onChange={v => set("friction_bottlenecks", v)} testId="refl-friction" rows={4} />
      </Section>

      <Section number="5.11" title="What Should Change Next Cycle" testId="refl-section-change">
        <Field label="" value={reflection.should_change_next_cycle}
          onChange={v => set("should_change_next_cycle", v)} testId="refl-should-change" rows={4} />
      </Section>

      <Section number="5.12" title="Support Needed" testId="refl-section-support">
        <Field label="" value={reflection.support_needed}
          onChange={v => set("support_needed", v)} testId="refl-support-needed" rows={3} />
      </Section>

      <Section number="5.13" title="Going Beyond Ownership (Trajectory Change)" testId="refl-section-beyond">
        <Field label="Where did you go beyond your assigned responsibility?" value={reflection.beyond_where}
          onChange={v => set("beyond_where", v)} testId="refl-beyond-where" />
        <Field label="What did you do?" value={reflection.beyond_what_did}
          onChange={v => set("beyond_what_did", v)} testId="refl-beyond-what" />
        <Field label="Why did it matter?" value={reflection.beyond_why_mattered}
          onChange={v => set("beyond_why_mattered", v)} testId="refl-beyond-why" />
        <Field label="What changed because of it?" value={reflection.beyond_what_changed}
          onChange={v => set("beyond_what_changed", v)} testId="refl-beyond-changed" />
      </Section>

      <Section number="5.14" title="If I Were CEO for a Day" testId="refl-section-ceo">
        <Field label="What is slowing the company down the most?" value={reflection.ceo_slowing_down}
          onChange={v => set("ceo_slowing_down", v)} testId="refl-ceo-slowing" />
        <Field label="What are we doing that doesn't matter?" value={reflection.ceo_doesnt_matter}
          onChange={v => set("ceo_doesnt_matter", v)} testId="refl-ceo-doesnt-matter" />
        <Field label="Where are we over / under investing?" value={reflection.ceo_over_under_invest}
          onChange={v => set("ceo_over_under_invest", v)} testId="refl-ceo-invest" />
      </Section>

      {rigorQuestions.length > 0 && (
        <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white" data-testid="refl-section-dri-rigor">
          <Label className="mono-label">DRI rigor questions</Label>
          <div className="mt-2 space-y-3">
            {rigorQuestions.map((q, i) => (
              <div key={q}>
                <div className="text-sm font-medium">{q}</div>
                <Input
                  className="rounded-none border-black mt-1"
                  value={reflection.rigor_answers?.[q] || ""}
                  onChange={e => set("rigor_answers", {
                    ...(reflection.rigor_answers || {}),
                    [q]: e.target.value,
                  })}
                  data-testid={`refl-rigor-${i}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-[var(--surface-hover)] flex justify-end">
        <Button
          onClick={onSave}
          disabled={saving}
          className="rounded-none bg-black text-white"
          data-testid="refl-save-individual"
        >
          {saving ? "Saving…" : "Save reflection →"}
        </Button>
      </div>
    </div>
  );
}
