import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { ResearchReport, ResearchReportDetail } from "../lib/types.js";

export default function ResearchPage() {
  const [activeId, setActiveId] = useState<string | null>(null);

  const reportsQuery = useQuery({
    queryKey: ["research-reports"],
    queryFn: () => api.get<{ data: ResearchReport[] }>("/research-reports").then((r) => r.data),
  });

  const reportDetailQuery = useQuery({
    queryKey: ["research-report", activeId],
    queryFn: () => api.get<ResearchReportDetail>(`/research-reports/${activeId}`),
    enabled: !!activeId,
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
          <span className="text-sm font-medium">Research</span>
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

      <main className="mx-auto max-w-3xl px-6 py-6">
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          Ask the agent to research something (e.g. “Research our Q3 budget using Drive and give me a cited
          report”) from the Tasks page — reports with verified sources will show up here.
        </p>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-6">
          <ul className="space-y-2">
            {reportsQuery.data?.map((report) => (
              <li key={report.id}>
                <button
                  onClick={() => setActiveId(report.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    report.id === activeId
                      ? "border-slate-400 dark:border-slate-500"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{report.title}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {report.sourceCount} source{report.sourceCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </button>
              </li>
            ))}
            {reportsQuery.data?.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">No research reports yet.</p>
            )}
          </ul>

          <div>
            {!activeId && <p className="text-sm text-slate-500 dark:text-slate-400">Select a report to see detail.</p>}
            {reportDetailQuery.data && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">{reportDetailQuery.data.title}</h2>

                <div className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-800">
                  <p className="whitespace-pre-wrap">{reportDetailQuery.data.summary}</p>
                </div>

                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Cited sources — verified against real tool calls, not just what the model claimed
                  </h3>
                  <ul className="space-y-1">
                    {reportDetailQuery.data.sources.map((source, i) => (
                      <li key={i} className="rounded-md border border-slate-200 p-2 text-xs dark:border-slate-800">
                        <p className="text-slate-700 dark:text-slate-300">{source.note}</p>
                        {source.toolExecution ? (
                          <div className="mt-1 flex items-center justify-between font-mono text-slate-500 dark:text-slate-400">
                            <span>{source.toolExecution.toolName}</span>
                            <span>{source.toolExecution.status}</span>
                          </div>
                        ) : (
                          <p className="mt-1 text-red-600 dark:text-red-400">
                            Could not verify this citation against a real tool call.
                          </p>
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
