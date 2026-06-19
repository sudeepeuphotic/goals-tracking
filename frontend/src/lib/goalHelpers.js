export function normalizeAssignedGoal(goal) {
  if (typeof goal === "string") {
    return { id: goal, text: goal, completed: false };
  }
  return {
    id: goal?.id || goal?.text || "",
    text: goal?.text || "",
    completed: Boolean(goal?.completed),
  };
}

export function assignedGoalsFromPlan(plan) {
  return (plan?.assigned_goals || []).map(normalizeAssignedGoal).filter(g => g.text);
}

export function planGoalCompletionPercent(plan) {
  const goals = assignedGoalsFromPlan(plan);
  if (!goals.length) return null;
  const done = goals.filter(g => g.completed).length;
  return Math.round((done / goals.length) * 100);
}
