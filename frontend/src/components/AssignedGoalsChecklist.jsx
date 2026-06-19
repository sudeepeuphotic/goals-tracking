import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { assignedGoalsFromPlan } from "@/lib/goalHelpers";
import { toast } from "sonner";

export default function AssignedGoalsChecklist({
  objectiveId,
  plan,
  canToggle = false,
  onUpdated,
  className = "",
}) {
  const [busyId, setBusyId] = useState(null);
  const goals = assignedGoalsFromPlan(plan);

  if (!goals.length) return null;

  const toggle = async (goal) => {
    if (!canToggle || !goal.id) return;
    setBusyId(goal.id);
    try {
      await api.patch(
        `/objectives/${objectiveId}/members/${plan.user_id}/goals/${goal.id}`,
        { completed: !goal.completed },
      );
      onUpdated?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusyId(null);
    }
  };

  const done = goals.filter(g => g.completed).length;
  const percent = Math.round((done / goals.length) * 100);

  return (
    <div className={className} data-testid="assigned-goals-checklist">
      <div className="flex items-baseline justify-between gap-2">
        <div className="mono-label">ASSIGNED GOALS</div>
        <span className="text-xs font-mono text-[var(--ink-soft)]">{done}/{goals.length} · {percent}%</span>
      </div>
      <ul className="mt-2 space-y-2">
        {goals.map(goal => (
          <li key={goal.id} className="flex items-start gap-2 text-sm">
            {canToggle ? (
              <input
                type="checkbox"
                checked={goal.completed}
                disabled={busyId === goal.id}
                onChange={() => toggle(goal)}
                className="mt-0.5"
                data-testid={`goal-complete-${goal.id}`}
              />
            ) : (
              <span className="mono-label mt-0.5">{goal.completed ? "✓" : "○"}</span>
            )}
            <span className={goal.completed ? "line-through text-[var(--ink-soft)]" : ""}>{goal.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
