import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { Memory } from "../lib/types.js";

type Tab = "proposed" | "approved";

export default function MemoryPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("proposed");
  const [query, setQuery] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newContent, setNewContent] = useState("");

  const memoriesQuery = useQuery({
    queryKey: ["memories", tab, query],
    queryFn: () =>
      api
        .get<{ data: Memory[] }>(`/memories?status=${tab}${query ? `&q=${encodeURIComponent(query)}` : ""}`)
        .then((r) => r.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["memories"] });

  const approve = useMutation({
    mutationFn: (id: string) => api.patch(`/memories/${id}`, { status: "APPROVED" }),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.patch(`/memories/${id}`, { status: "REJECTED" }),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.patch(`/memories/${id}`, { status: "ARCHIVED" }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/memories/${id}`),
    onSuccess: invalidate,
  });
  const create = useMutation({
    mutationFn: () => api.post("/memories", { category: newCategory, content: newContent }),
    onSuccess: () => {
      setNewCategory("");
      setNewContent("");
      invalidate();
    },
  });

  async function handleExport() {
    const res = await fetch("/api/v1/memories/export", { credentials: "include" });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jarvis-memory-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

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
          <Link to="/scheduled" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            Scheduled
          </Link>
          <span className="text-sm font-medium">Memory</span>
        </div>
        <button onClick={handleExport} className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          Export all
        </button>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newCategory.trim() && newContent.trim()) create.mutate();
          }}
          className="mb-6 flex gap-2"
        >
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="category (e.g. preference)"
            className="w-40 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <input
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Add a memory manually..."
            className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            Add
          </button>
        </form>

        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setTab("proposed")}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === "proposed" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "border border-slate-300 dark:border-slate-700"}`}
            >
              Proposed
            </button>
            <button
              onClick={() => setTab("approved")}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === "approved" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "border border-slate-300 dark:border-slate-700"}`}
            >
              Approved
            </button>
          </div>
          {tab === "approved" && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          )}
        </div>

        <ul className="space-y-2">
          {memoriesQuery.data?.map((memory) => (
            <li key={memory.id} className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
              <div>
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {memory.category}
                </span>
                <span className="text-sm">{memory.content}</span>
                <p className="mt-1 text-xs text-slate-400">source: {memory.source}</p>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                {tab === "proposed" ? (
                  <>
                    <button onClick={() => approve.mutate(memory.id)} className="text-emerald-600 hover:underline dark:text-emerald-400">
                      Approve
                    </button>
                    <button onClick={() => reject.mutate(memory.id)} className="text-red-600 hover:underline dark:text-red-400">
                      Reject
                    </button>
                  </>
                ) : (
                  <button onClick={() => archive.mutate(memory.id)} className="text-slate-500 hover:underline dark:text-slate-400">
                    Archive
                  </button>
                )}
                <button onClick={() => remove.mutate(memory.id)} className="text-red-600 hover:underline dark:text-red-400">
                  Delete
                </button>
              </div>
            </li>
          ))}
          {memoriesQuery.data?.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing here yet.</p>
          )}
        </ul>
      </main>
    </div>
  );
}
