import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { ApprovalRequest } from "../lib/types.js";

export default function ApprovalsPage() {
  const queryClient = useQueryClient();

  const approvalsQuery = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api.get<{ data: ApprovalRequest[] }>("/approvals?status=pending").then((r) => r.data),
    refetchInterval: 3000,
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      api.post(`/approvals/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
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
          <span className="text-sm font-medium">Approvals</span>
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

      <main className="mx-auto max-w-2xl px-6 py-6">
        {approvalsQuery.data?.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing waiting on you right now.</p>
        )}

        <ul className="space-y-4">
          {approvalsQuery.data?.map((approval) => (
            <li key={approval.id} className="rounded-lg border border-amber-300 p-4 dark:border-amber-700">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-sm">{approval.toolName}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  via {approval.requestedVia} · expires {new Date(approval.expiresAt).toLocaleString()}
                </span>
              </div>
              <pre className="mb-3 overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">
                {JSON.stringify(approval.boundInput, null, 2)}
              </pre>
              <div className="flex gap-2">
                <button
                  onClick={() => decide.mutate({ id: approval.id, action: "approve" })}
                  disabled={decide.isPending}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide.mutate({ id: approval.id, action: "reject" })}
                  disabled={decide.isPending}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
