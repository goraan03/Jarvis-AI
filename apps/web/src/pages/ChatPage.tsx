import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../lib/api.js";
import type { Conversation, ConversationDetail } from "../lib/types.js";

export default function ChatPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<{ data: Conversation[] }>("/conversations").then((r) => r.data),
  });

  useEffect(() => {
    if (!activeId && conversationsQuery.data && conversationsQuery.data.length > 0) {
      setActiveId(conversationsQuery.data[0].id);
    }
  }, [activeId, conversationsQuery.data]);

  const conversationQuery = useQuery({
    queryKey: ["conversation", activeId],
    queryFn: () => api.get<ConversationDetail>(`/conversations/${activeId}`),
    enabled: !!activeId,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationQuery.data?.messages.length]);

  const createConversation = useMutation({
    mutationFn: () => api.post<Conversation>("/conversations", {}),
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setActiveId(conversation.id);
    },
  });

  const sendMessage = useMutation({
    mutationFn: (content: string) => api.post(`/conversations/${activeId}/messages`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversation", activeId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  function handleSend() {
    const content = draft.trim();
    if (!content || !activeId || sendMessage.isPending) return;
    setDraft("");
    sendMessage.mutate(content);
  }

  return (
    <div className="flex h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside className="w-64 border-r border-slate-200 p-4 dark:border-slate-800">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-semibold">Jarvis</span>
          <button onClick={() => logout()} className="text-xs text-slate-500 hover:underline dark:text-slate-400">
            Sign out
          </button>
        </div>
        <Link to="/tasks" className="mb-1 block text-sm text-slate-500 hover:underline dark:text-slate-400">
          Tasks →
        </Link>
        <Link to="/integrations" className="mb-1 block text-sm text-slate-500 hover:underline dark:text-slate-400">
          Integrations →
        </Link>
        <Link to="/approvals" className="mb-1 block text-sm text-slate-500 hover:underline dark:text-slate-400">
          Approvals →
        </Link>
        <Link to="/memory" className="mb-1 block text-sm text-slate-500 hover:underline dark:text-slate-400">
          Memory →
        </Link>
        <Link to="/scheduled" className="mb-3 block text-sm text-slate-500 hover:underline dark:text-slate-400">
          Scheduled →
        </Link>
        <button
          onClick={() => createConversation.mutate()}
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
        >
          + New conversation
        </button>
        <ul className="space-y-1 overflow-y-auto">
          {conversationsQuery.data?.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setActiveId(c.id)}
                className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                  c.id === activeId
                    ? "bg-slate-100 dark:bg-slate-800"
                    : "hover:bg-slate-50 dark:hover:bg-slate-900"
                }`}
              >
                {c.title ?? "Untitled conversation"}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="border-b border-slate-200 px-6 py-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Signed in as {user?.email}
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!activeId && <p className="text-sm text-slate-500 dark:text-slate-400">Start a new conversation.</p>}
          {conversationQuery.data?.messages.map((m) => (
            <div key={m.id} className={`mb-4 flex ${m.role === "USER" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-lg rounded-lg px-4 py-2 text-sm ${
                  m.role === "USER"
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.providerUsed && (
                  <p className="mt-1 text-[10px] uppercase tracking-wide opacity-60">via {m.providerUsed}</p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2 border-t border-slate-200 px-6 py-3 dark:border-slate-800"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!activeId}
            placeholder={activeId ? "Message Jarvis..." : "Create a conversation to start chatting"}
            className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={!activeId || sendMessage.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {sendMessage.isPending ? "Sending..." : "Send"}
          </button>
        </form>
      </main>
    </div>
  );
}
