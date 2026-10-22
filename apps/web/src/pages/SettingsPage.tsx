import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { AgentSettings } from "../lib/types.js";

const NUMBER_FIELDS: Array<{ key: keyof AgentSettings; label: string }> = [
  { key: "maxToolCallsPerTask", label: "Max tool calls per task" },
  { key: "maxModelCallsPerTask", label: "Max model calls per task" },
  { key: "maxTaskDurationMs", label: "Max task duration (ms)" },
  { key: "maxTokensPerTask", label: "Max tokens per task" },
  { key: "maxCostMicroUsdPerTask", label: "Max cost per task (micro-USD)" },
  { key: "maxConcurrentTasks", label: "Max concurrent tasks" },
  { key: "maxRetriesPerToolCall", label: "Max retries per tool call" },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<AgentSettings>("/settings"),
  });

  const [form, setForm] = useState<AgentSettings | null>(null);
  useEffect(() => {
    if (settingsQuery.data && !form) setForm(settingsQuery.data);
  }, [settingsQuery.data, form]);

  const save = useMutation({
    mutationFn: (data: Partial<AgentSettings>) => api.patch<AgentSettings>("/settings", data),
    onSuccess: (updated) => {
      setForm(updated);
      queryClient.setQueryData(["settings"], updated);
    },
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
          <Link to="/research" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Research
          </Link>
          <Link to="/usage" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Usage
          </Link>
          <Link to="/activity" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Activity
          </Link>
          <span className="text-sm font-medium">Settings</span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-6 py-6">
        {!form && <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>}
        {form && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
            className="space-y-4"
          >
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Default model
              </label>
              <input
                value={form.defaultModel}
                onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            {NUMBER_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {label}
                </label>
                <input
                  type="number"
                  value={form[key] as number}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
            ))}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.autoMemoryEnabled}
                onChange={(e) => setForm({ ...form, autoMemoryEnabled: e.target.checked })}
              />
              Auto-propose memories from task activity
            </label>

            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {save.isPending ? "Saving..." : "Save settings"}
            </button>
            {save.isSuccess && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}
            {save.isError && <p className="text-sm text-red-600 dark:text-red-400">{(save.error as Error).message}</p>}
          </form>
        )}
      </main>
    </div>
  );
}
