import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { Task, TaskDetail } from "../lib/types.js";

const ACTIVE_STATUSES = new Set(["PENDING", "PLANNING", "RUNNING", "AWAITING_APPROVAL"]);

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  PLANNING: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  RUNNING: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  AWAITING_APPROVAL: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  CANCELLED: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? ""}`}>{status}</span>
  );
}

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api.get<{ data: Task[] }>("/tasks").then((r) => r.data),
    refetchInterval: (query) => (query.state.data?.some((t) => ACTIVE_STATUSES.has(t.status)) ? 1500 : false),
  });

  const activeTaskHasActiveStatus = tasksQuery.data?.find((t) => t.id === activeId);
  const taskDetailQuery = useQuery({
    queryKey: ["task", activeId],
    queryFn: () => api.get<TaskDetail>(`/tasks/${activeId}`),
    enabled: !!activeId,
    refetchInterval: activeTaskHasActiveStatus && ACTIVE_STATUSES.has(activeTaskHasActiveStatus.status) ? 1500 : false,
  });

  const createTask = useMutation({
    mutationFn: (goalText: string) => api.post<Task>("/tasks", { goal: goalText }),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setActiveId(task.id);
      setGoal("");
    },
  });

  const cancelTask = useMutation({
    mutationFn: (id: string) => api.post(`/tasks/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", activeId] });
    },
  });

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-800">
        <div className="flex items-center gap-4">
          <span className="font-semibold">Jarvis</span>
          <Link to="/" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Chat
          </Link>
          <span className="text-sm font-medium">Tasks</span>
          <Link to="/integrations" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Integrations
          </Link>
          <Link to="/approvals" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Approvals
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (goal.trim()) createTask.mutate(goal.trim());
          }}
          className="mb-6 flex gap-2"
        >
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Ask the agent to do something, e.g. “What time is it?”"
            className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={createTask.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {createTask.isPending ? "Starting..." : "Run task"}
          </button>
        </form>
        {createTask.isError && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">{(createTask.error as Error).message}</p>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-6">
          <ul className="space-y-2">
            {tasksQuery.data?.map((task) => (
              <li key={task.id}>
                <button
                  onClick={() => setActiveId(task.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    task.id === activeId
                      ? "border-slate-400 dark:border-slate-500"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{task.goal}</span>
                    <StatusBadge status={task.status} />
                  </div>
                </button>
              </li>
            ))}
            {tasksQuery.data?.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No tasks yet — run one above.</p>
            )}
          </ul>

          <div>
            {!activeId && <p className="text-sm text-slate-500 dark:text-slate-400">Select a task to see detail.</p>}
            {taskDetailQuery.data && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <StatusBadge status={taskDetailQuery.data.status} />
                  {ACTIVE_STATUSES.has(taskDetailQuery.data.status) && (
                    <button
                      onClick={() => cancelTask.mutate(taskDetailQuery.data!.id)}
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                {taskDetailQuery.data.resultSummary && (
                  <div className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-800">
                    <p className="whitespace-pre-wrap">{taskDetailQuery.data.resultSummary}</p>
                  </div>
                )}
                {taskDetailQuery.data.failureReason && (
                  <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                    {taskDetailQuery.data.failureReason}
                  </p>
                )}

                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Tool activity
                  </h3>
                  {taskDetailQuery.data.toolExecutions.length === 0 && (
                    <p className="text-sm text-slate-400">No tool calls yet.</p>
                  )}
                  <ul className="space-y-1">
                    {taskDetailQuery.data.toolExecutions.map((exec) => (
                      <li key={exec.id} className="rounded-md border border-slate-200 p-2 text-xs dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="font-mono">{exec.toolName}</span>
                          <span>{exec.status}</span>
                        </div>
                        {exec.errorMessage && <p className="mt-1 text-red-600 dark:text-red-400">{exec.errorMessage}</p>}
                        {exec.output != null && (
                          <pre className="mt-1 overflow-x-auto text-slate-600 dark:text-slate-400">
                            {JSON.stringify(exec.output)}
                          </pre>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
