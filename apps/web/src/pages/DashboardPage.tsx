import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { AuditLogEntry, Integration, Task, UsageResponse } from "../lib/types.js";

function formatCost(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

export default function DashboardPage() {
  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api.get<{ data: Task[] }>("/tasks").then((r) => r.data),
  });
  const usageQuery = useQuery({
    queryKey: ["usage"],
    queryFn: () => api.get<UsageResponse>("/usage"),
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.get<{ data: Integration[] }>("/integrations").then((r) => r.data),
  });
  const activityQuery = useQuery({
    queryKey: ["audit-log", "recent"],
    queryFn: () => api.get<{ data: AuditLogEntry[] }>("/audit-log").then((r) => r.data.slice(0, 5)),
  });

  const statusCounts = (tasksQuery.data ?? []).reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-800">
        <div className="flex items-center gap-4">
          <span className="font-semibold">Jarvis</span>
          <span className="text-sm font-medium">Dashboard</span>
          <Link to="/chat" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Chat
          </Link>
          <Link to="/tasks" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Tasks
          </Link>
          <Link to="/integrations" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Integrations
          </Link>
          <Link to="/approvals" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Approvals
          </Link>
          <Link to="/memory" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Memory
          </Link>
          <Link to="/scheduled" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Scheduled
          </Link>
          <Link to="/research" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Research
          </Link>
          <Link to="/usage" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Usage
          </Link>
          <Link to="/activity" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Activity
          </Link>
          <Link to="/settings" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Settings
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-6 grid grid-cols-3 gap-4">
          <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Tasks by status
            </h2>
            {tasksQuery.data && Object.keys(statusCounts).length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No tasks yet.</p>
            )}
            <ul className="space-y-1 text-sm">
              {Object.entries(statusCounts).map(([status, count]) => (
                <li key={status} className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">{status}</span>
                  <span className="font-medium">{count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Usage
            </h2>
            {usageQuery.data && (
              <ul className="space-y-1 text-sm">
                <li className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Model calls</span>
                  <span className="font-medium">{usageQuery.data.totals.callCount}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Est. cost</span>
                  <span className="font-medium">{formatCost(usageQuery.data.totals.estimatedCostMicroUsd)}</span>
                </li>
              </ul>
            )}
            <Link to="/usage" className="mt-2 inline-block text-xs text-slate-500 hover:underline dark:text-slate-400">
              View details →
            </Link>
          </section>

          <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Integrations
            </h2>
            <ul className="space-y-1 text-sm">
              {integrationsQuery.data?.map((i) => (
                <li key={i.provider} className="flex justify-between">
                  <span className="capitalize text-slate-500 dark:text-slate-400">{i.provider}</span>
                  <span className={i.status === "connected" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}>
                    {i.status}
                  </span>
                </li>
              ))}
              {integrationsQuery.data?.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400">None connected.</p>
              )}
            </ul>
            <Link to="/integrations" className="mt-2 inline-block text-xs text-slate-500 hover:underline dark:text-slate-400">
              Manage →
            </Link>
          </section>
        </div>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Recent activity
          </h2>
          <ul className="space-y-1">
            {activityQuery.data?.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                <span className="font-mono text-xs">{entry.action}</span>
                <span className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
              </li>
            ))}
            {activityQuery.data?.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No activity yet.</p>
            )}
          </ul>
          <Link to="/activity" className="mt-2 inline-block text-xs text-slate-500 hover:underline dark:text-slate-400">
            View all →
          </Link>
        </section>
      </main>
    </div>
  );
}
