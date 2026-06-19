/** Helpers for end-of-cycle individual reflection state. */

export function goalsFromPlan(plan) {
  if (!plan) return [];
  const assigned = (plan.assigned_goals || []).map(g => (typeof g === "string" ? g : g.text));
  const personal = (plan.goals || []);
  const seen = new Set();
  const merged = [];
  for (const g of [...assigned, ...personal]) {
    const text = (g || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    merged.push(text);
  }
  return merged;
}

export function mergeGoalOutcomes(goalTexts, existing = []) {
  const saved = Array.isArray(existing) ? existing : [];
  if (!goalTexts.length) return saved;
  return goalTexts.map((text, i) => {
    const match = saved.find(e => e.goal_text === text) || saved[i];
    return {
      goal_text: text,
      achievement: match?.achievement || "",
      actual_result: match?.actual_result || "",
      biggest_difference: match?.biggest_difference || "",
    };
  });
}

export function emptyIndividualReflection(objectiveId, plan, rigorQuestions = []) {
  const goalTexts = goalsFromPlan(plan);
  return {
    objective_id: objectiveId,
    goal_outcomes: mergeGoalOutcomes(goalTexts, []),
    objective_succeeded: "",
    my_contribution: "",
    system_breaks: "",
    what_moved_metric: "",
    quality_built_shipped: "",
    quality_validation: "",
    quality_edge_cases: "",
    quality_what_would_break: "",
    peer_reviewed: "",
    peer_reviewer: "",
    peer_feedback: "",
    peer_improved_after: "",
    what_didnt_work: "",
    biggest_wins: "",
    where_fell_short: "",
    key_learnings: "",
    friction_bottlenecks: "",
    should_change_next_cycle: "",
    support_needed: "",
    beyond_where: "",
    beyond_what_did: "",
    beyond_why_mattered: "",
    beyond_what_changed: "",
    ceo_slowing_down: "",
    ceo_doesnt_matter: "",
    ceo_over_under_invest: "",
    rigor_answers: Object.fromEntries((rigorQuestions || []).map(q => [q, ""])),
  };
}

/** Map legacy reflection documents to the new shape. */
export function normalizeIndividualReflection(saved, objectiveId, plan, rigorQuestions = []) {
  if (!saved) {
    return emptyIndividualReflection(objectiveId, plan, rigorQuestions);
  }
  const base = emptyIndividualReflection(objectiveId, plan, rigorQuestions);
  const merged = { ...base, ...saved, objective_id: objectiveId };

  merged.goal_outcomes = mergeGoalOutcomes(
    goalsFromPlan(plan),
    saved.goal_outcomes?.length ? saved.goal_outcomes : [],
  );

  if (!merged.biggest_wins && saved.wins) merged.biggest_wins = saved.wins;
  if (!merged.what_didnt_work && saved.failures) merged.what_didnt_work = saved.failures;
  if (!merged.where_fell_short && saved.failures) merged.where_fell_short = saved.failures;
  if (!merged.key_learnings && saved.learnings) merged.key_learnings = saved.learnings;
  if (!merged.friction_bottlenecks && saved.bottlenecks) merged.friction_bottlenecks = saved.bottlenecks;
  if (!merged.my_contribution && saved.contribution_to_objective) {
    merged.my_contribution = saved.contribution_to_objective;
  }
  if (!merged.beyond_what_did && saved.trajectory_change) {
    merged.beyond_what_did = saved.trajectory_change;
  }
  if (!merged.ceo_slowing_down && saved.ceo_question_response) {
    merged.ceo_slowing_down = saved.ceo_question_response;
  }

  merged.rigor_answers = {
    ...Object.fromEntries((rigorQuestions || []).map(q => [q, ""])),
    ...(saved.rigor_answers || {}),
  };

  return merged;
}
