import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { ScheduledTask, ScheduledTaskRun } from "../lib/types.js";

const DEFAULT_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  paused: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  cancelled: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
};

export default function ScheduledTasksPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [cronExpression, setCronExpression] = useState("0 8 * * *");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tasksQuery = useQuery({
    queryKey: ["scheduled-tasks"],
    queryFn: () => api.get<{ data: ScheduledTask[] }>("/scheduled-tasks").then((r) => r.data),
  });

  const runsQuery = useQuery({
    queryKey: ["scheduled-task-runs", expandedId],
    queryFn: () => api.get<{ data: ScheduledTaskRun[] }>(`/scheduled-tasks/${expandedId}/runs`).then((r) => r.data),
    enabled: !!expandedId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });

  const create = useMutation({
    mutationFn: () =>
      api.post("/scheduled-tasks", { name, timezone: DEFAULT_TZ, payload: { goal }, cronExpression }),
    onSuccess: () => {
      setName("");
      setGoal("");
      invalidate();
    },
  });
  const pause = useMutation({ mutationFn: (id: string) => api.patch(`/scheduled-tasks/${id}`, { status: "paused" }), onSuccess: invalidate });
  const resume = useMutation({ mutationFn: (id: string) => api.patch(`/scheduled-tasks/${id}`, { status: "active" }), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: (id: string) => api.delete(`/scheduled-tasks/${id}`), onSuccess: invalidate });
  const trigger = useMutation({ mutationFn: (id: string) => api.post(`/scheduled-tasks/${id}/trigger`) });

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-800">
        <div className="flex items-center gap-4">
          <span className="font-semibold">Jarvis</span>
          <Link to="/" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Chat
          </Link>
          <Link to="/tasks" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Tasks
          </Link>
          <Link to="/memory" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Memory
          </Link>
          <span className="text-sm font-medium">Scheduled</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && goal.trim() && cronExpression.trim()) create.mutate();
          }}
          className="mb-6 space-y-2 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
        >
          <h2 className="text-sm font-medium">New scheduled task</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Morning briefing)"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Goal (e.g. Summarize my calendar for today and any important unread emails)"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <div className="flex items-center gap-2">
            <input
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="cron, e.g. 0 8 * * *"
              className="w-48 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:border-slate-700 dark:bg-slate-900"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">{DEFAULT_TZ}</span>
            <button
              type="submit"
              disabled={create.isPending}
              className="ml-auto rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              Create
            </button>
          </div>
        </form>

        <ul className="space-y-3">
          {tasksQuery.data?.map((task) => (
            <li key={task.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{task.name}</span>{" "}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[task.status]}`}>{task.status}</span>
                </div>
                <div className="flex gap-2 text-xs">
                  {task.status === "active" && (
                    <button onClick={() => pause.mutate(task.id)} className="text-slate-500 hover:underline dark:text-slate-400">
                      Pause
                    </button>
                  )}
                  {task.status === "paused" && (
                    <button onClick={() => resume.mutate(task.id)} className="text-emerald-600 hover:underline dark:text-emerald-400">
                      Resume
                    </button>
                  )}
                  {task.status !== "cancelled" && (
                    <button onClick={() => trigger.mutate(task.id)} className="text-sky-600 hover:underline dark:text-sky-400">
                      Run now
                    </button>
                  )}
                  {task.status !== "cancelled" && (
                    <button onClick={() => cancel.mutate(task.id)} className="text-red-600 hover:underline dark:text-red-400">
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}
                    className="text-slate-500 hover:underline dark:text-slate-400"
                  >
                    Runs
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {task.cronExpression ? `cron: ${task.cronExpression}` : `once: ${task.runAt}`} ({task.timezone})
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{task.payload.goal}</p>
              {task.lastRunAt && (
                <p className="text-xs text-slate-400">
                  last run {new Date(task.lastRunAt).toLocaleString()} — {task.lastStatus}
                </p>
              )}
              {expandedId === task.id && (
                <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
                  {runsQuery.data?.map((run) => (
                    <li key={run.id} className="text-slate-500 dark:text-slate-400">
                      {new Date(run.createdAt).toLocaleString()} — {run.status}
                    </li>
                  ))}
                  {runsQuery.data?.length === 0 && <li className="text-slate-400">No runs yet.</li>}
                </ul>
              )}
            </li>
          ))}
          {tasksQuery.data?.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No scheduled tasks yet.</p>
          )}
        </ul>
      </main>
    </div>
  );
}
