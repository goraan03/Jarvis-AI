import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { AuditLogEntry } from "../lib/types.js";

export default function ActivityPage() {
  const [action, setAction] = useState("");

  const entriesQuery = useQuery({
    queryKey: ["audit-log", action],
    queryFn: () =>
      api.get<{ data: AuditLogEntry[] }>(`/audit-log${action ? `?action=${encodeURIComponent(action)}` : ""}`).then((r) => r.data),
  });

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-800">
        <div className="flex items-center gap-4">
          <span className="font-semibold">Jarvis</span>
          <Link to="/" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Dashboard
          </Link>
          <Link to="/chat" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Chat
          </Link>
          <Link to="/tasks" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Tasks
          </Link>
          <Link to="/usage" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Usage
          </Link>
          <span className="text-sm font-medium">Activity</span>
          <Link to="/settings" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Settings
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-6">
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Filter by action (e.g. tool.execute)"
          className="mb-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />

        <ul className="space-y-1">
          {entriesQuery.data?.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
            >
              <div className="flex items-center gap-3">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {entry.action}
                </span>
                {entry.entityType && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {entry.entityType}
                    {entry.entityId ? `:${entry.entityId}` : ""}
                  </span>
                )}
              </div>
              <span className="shrink-0 text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
            </li>
          ))}
          {entriesQuery.data?.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No activity recorded yet.</p>
          )}
        </ul>
      </main>
    </div>
  );
}
