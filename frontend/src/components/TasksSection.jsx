import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, CircleCheck, Circle, CircleDashed } from "lucide-react";
import { toast } from "sonner";

const STATUS_ORDER = ["todo", "doing", "done"];

function TaskStatusButton({ status, onChange }) {
  const next = () => onChange(STATUS_ORDER[(STATUS_ORDER.indexOf(status) + 1) % STATUS_ORDER.length]);
  const Icon = status === "done" ? CircleCheck : status === "doing" ? CircleDashed : Circle;
  const color = status === "done" ? "text-[var(--green)]" : status === "doing" ? "text-[var(--yellow)]" : "text-[var(--ink-soft)]";
  return (
    <button onClick={next} className={`p-1 ${color} hover:scale-110 transition-transform`} title="Cycle status">
      <Icon size={16} />
    </button>
  );
}

export default function TasksSection({ plan, onChanged }) {
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  if (!plan?.id) {
    return (
      <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white">
        <div className="mono-label">TASKS</div>
        <p className="text-sm text-[var(--ink-soft)] mt-2">Save the plan first to add tasks.</p>
      </div>
    );
  }

  const addTask = async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      await api.post(`/plans/${plan.id}/tasks`, { title: newTitle.trim(), status: "todo" });
      setNewTitle("");
      onChanged?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const setStatus = async (taskId, status) => {
    try {
      await api.patch(`/plans/${plan.id}/tasks/${taskId}`, { status });
      onChanged?.();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const deleteTask = async (taskId) => {
    try {
      await api.delete(`/plans/${plan.id}/tasks/${taskId}`);
      onChanged?.();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const tasks = plan.tasks || [];
  const doneCount = tasks.filter(t => t.status === "done").length;

  return (
    <div className="p-5 brutal-border border-t-0 border-l-0 border-r-0 bg-white" data-testid="tasks-section">
      <div className="flex items-center justify-between">
        <div className="mono-label">TASKS · {doneCount} / {tasks.length} done</div>
      </div>

      <div className="mt-3 space-y-0 brutal-border border-b-0 border-r-0">
        {tasks.length === 0 && (
          <div className="p-3 brutal-border border-t-0 border-l-0 text-sm text-[var(--ink-soft)]">
            No tasks yet. Add the first one below.
          </div>
        )}
        {tasks.map(t => (
          <div key={t.id} data-testid={`task-${t.id}`}
            className="grid grid-cols-[36px_1fr_90px_36px] items-center p-2 brutal-border border-t-0 border-l-0">
            <TaskStatusButton status={t.status} onChange={(s) => setStatus(t.id, s)} />
            <div className={`text-sm ${t.status === "done" ? "line-through text-[var(--ink-soft)]" : ""}`}>
              {t.title}
            </div>
            <div className="mono-label">{t.status}</div>
            <button onClick={() => deleteTask(t.id)} className="p-1 text-[var(--ink-soft)] hover:text-[var(--red)]" title="Delete">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-0 brutal-border">
        <Input className="rounded-none border-0 h-10" placeholder="Add a task — press Enter"
          value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTask(); } }}
          data-testid="task-input" />
        <Button onClick={addTask} disabled={busy || !newTitle.trim()}
          className="rounded-none bg-black text-white border-l border-black h-10 px-4"
          data-testid="task-add">+ Add</Button>
      </div>
    </div>
  );
}
