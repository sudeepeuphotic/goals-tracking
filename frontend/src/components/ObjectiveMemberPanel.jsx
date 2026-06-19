import { useEffect, useState, useMemo } from "react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { isManagerOrAdmin } from "@/lib/roles";

function goalTexts(plan) {
  return (plan?.assigned_goals || []).map(g => (typeof g === "string" ? g : g.text));
}

function rigorList(plan) {
  return plan?.rigor_questions || [];
}

function defaultSelectedMember(members, user, userIsManagerOrAdmin, isDRI) {
  if (!members.length) return "";
  if (userIsManagerOrAdmin) {
    return members[0]?.id || "";
  }
  if (isDRI) {
    const firstContributor = members.find(m => m.isContributor);
    return firstContributor?.id || members[0]?.id || "";
  }
  return members[0]?.id || "";
}

export default function ObjectiveMemberPanel({ objective, users, plans, onSaved }) {
  const { user } = useAuth();
  const userIsManagerOrAdmin = isManagerOrAdmin(user);
  const isDRI = objective.dri_id === user.id;

  const members = useMemo(() => [
    { id: objective.dri_id, label: "DRI", isContributor: false },
    ...(objective.contributor_ids || []).map(id => ({
      id,
      label: "Contributor",
      isContributor: true,
    })),
  ], [objective.dri_id, objective.contributor_ids]);

  const canManage = userIsManagerOrAdmin || isDRI;

  const [selectedId, setSelectedId] = useState("");
  const [assignedGoals, setAssignedGoals] = useState(["", "", ""]);
  const [rigorQuestions, setRigorQuestions] = useState([""]);
  const [saving, setSaving] = useState(false);

  const planByUser = Object.fromEntries(plans.map(p => [p.user_id, p]));
  const selected = members.find(m => m.id === selectedId);
  const selectedPlan = planByUser[selectedId];

  const canEditAssigned =
    userIsManagerOrAdmin ||
    (isDRI && selected?.isContributor);

  const canEditRigor = isDRI && selected?.isContributor;

  useEffect(() => {
    if (!canManage || !members.length) return;
    setSelectedId(prev => (members.some(m => m.id === prev)
      ? prev
      : defaultSelectedMember(members, user, userIsManagerOrAdmin, isDRI)));
  }, [canManage, members, user.id, userIsManagerOrAdmin, isDRI]);

  useEffect(() => {
    if (!selectedId) return;
    const texts = goalTexts(selectedPlan);
    setAssignedGoals([0, 1, 2].map(i => texts[i] || ""));
    const rq = rigorList(selectedPlan);
    setRigorQuestions(rq.length ? rq : [""]);
  }, [selectedId, selectedPlan]);

  if (!canManage || !members.length) return null;

  const save = async () => {
    setSaving(true);
    try {
      const body = {};
      if (canEditAssigned) {
        body.assigned_goals = assignedGoals.map(g => (g || "").trim());
      }
      if (canEditRigor) {
        body.rigor_questions = rigorQuestions.map(q => (q || "").trim()).filter(Boolean);
      }
      if (!Object.keys(body).length) {
        toast.error("Nothing to save for this member");
        return;
      }
      await api.put(`/objectives/${objective.id}/members/${selectedId}/config`, body);
      toast.success("Saved");
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  const contributorCount = members.filter(m => m.isContributor).length;

  return (
    <section className="brutal-card p-5 mb-6" data-testid="member-goals-panel">
      <header className="mono-label">TEAM GOALS & RIGOR</header>
      <p className="text-sm text-[var(--ink-soft)] mt-1">
        {userIsManagerOrAdmin
          ? "Assign goals to the DRI and each contributor. DRIs can later update contributor goals and add rigor questions."
          : "Set contributor goals and rigor questions. Select a contributor tab below — your own goals are set by your manager."}
      </p>

      {isDRI && !userIsManagerOrAdmin && contributorCount === 0 && (
        <p className="mt-3 text-sm text-[var(--ink-soft)] brutal-border p-3 bg-[#FFD600]/30">
          No contributors on this objective yet. Ask your admin to add team members from the DRI&apos;s reporting line.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {members.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSelectedId(m.id)}
            className={`px-3 py-1 text-xs font-mono brutal-border ${
              selectedId === m.id ? "bg-black text-white" : "bg-white hover:bg-[var(--surface-hover)]"
            }`}
            data-testid={`member-tab-${m.id}`}
          >
            {userMap[m.id]?.name || "User"} · {m.label}
          </button>
        ))}
      </div>

      {selected && !canEditAssigned && isDRI && !selected.isContributor && (
        <p className="mt-4 text-sm text-[var(--ink-soft)]">
          Your goals are assigned by your manager. Select a contributor tab to set their goals or rigor questions.
        </p>
      )}

      {canEditAssigned && (
        <div className="mt-4">
          <Label className="mono-label">
            {selected?.isContributor ? "Contributor goals (max 3)" : "DRI goals (max 3)"}
          </Label>
          <div className="space-y-2 mt-2">
            {[0, 1, 2].map(i => (
              <Input
                key={i}
                className="rounded-none border-black"
                value={assignedGoals[i] || ""}
                placeholder={`Goal ${i + 1}`}
                onChange={e => {
                  const next = [...assignedGoals];
                  next[i] = e.target.value;
                  setAssignedGoals(next);
                }}
                data-testid={`assigned-goal-${i}`}
              />
            ))}
          </div>
        </div>
      )}

      {!canEditAssigned && selectedPlan?.assigned_goals?.length > 0 && (
        <div className="mt-4">
          <Label className="mono-label">Assigned goals</Label>
          <ol className="text-sm mt-2 list-decimal list-inside">
            {goalTexts(selectedPlan).map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ol>
        </div>
      )}

      {canEditRigor && (
        <div className="mt-4">
          <Label className="mono-label">Rigor questions for contributor</Label>
          {rigorQuestions.map((q, i) => (
            <Input
              key={i}
              value={q}
              placeholder={`Question ${i + 1}`}
              className="rounded-none border-black mt-1"
              onChange={e => {
                const next = [...rigorQuestions];
                next[i] = e.target.value;
                setRigorQuestions(next);
              }}
              data-testid={`rigor-q-${i}`}
            />
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="rounded-none mt-1"
            type="button"
            onClick={() => setRigorQuestions([...rigorQuestions, ""])}
          >
            + Add question
          </Button>
        </div>
      )}

      {(canEditAssigned || canEditRigor) && (
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-none bg-black text-white"
            data-testid="save-member-config"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </section>
  );
}
