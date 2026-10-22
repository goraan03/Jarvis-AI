import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { UsageResponse } from "../lib/types.js";

function formatCost(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

export default function UsagePage() {
  const usageQuery = useQuery({
    queryKey: ["usage"],
    queryFn: () => api.get<UsageResponse>("/usage"),
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
          <span className="text-sm font-medium">Usage</span>
          <Link to="/activity" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Activity
          </Link>
          <Link to="/settings" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Settings
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-6">
        {usageQuery.data && (
          <>
            <div className="mb-6 grid grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Model calls</p>
                <p className="text-xl font-semibold">{usageQuery.data.totals.callCount}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Input tokens</p>
                <p className="text-xl font-semibold">{usageQuery.data.totals.inputTokens.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Output tokens</p>
                <p className="text-xl font-semibold">{usageQuery.data.totals.outputTokens.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Estimated cost</p>
                <p className="text-xl font-semibold">{formatCost(usageQuery.data.totals.estimatedCostMicroUsd)}</p>
              </div>
            </div>

            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">By day</h3>
            {usageQuery.data.byDay.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No model calls recorded yet.</p>
            )}
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="py-1">Date</th>
                  <th className="py-1">Calls</th>
                  <th className="py-1">Input</th>
                  <th className="py-1">Output</th>
                  <th className="py-1">Cost</th>
                </tr>
              </thead>
              <tbody>
                {usageQuery.data.byDay.map((day) => (
                  <tr key={day.date} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-1">{day.date}</td>
                    <td className="py-1">{day.callCount}</td>
                    <td className="py-1">{day.inputTokens.toLocaleString()}</td>
                    <td className="py-1">{day.outputTokens.toLocaleString()}</td>
                    <td className="py-1">{formatCost(day.estimatedCostMicroUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </main>
    </div>
  );
}
