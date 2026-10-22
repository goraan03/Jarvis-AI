import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { Integration, LinkCodeResponse } from "../lib/types.js";

export default function IntegrationsPage() {
  const queryClient = useQueryClient();

  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.get<{ data: Integration[] }>("/integrations").then((r) => r.data),
  });

  const telegram = integrationsQuery.data?.find((i) => i.provider === "telegram");
  const isConnected = telegram?.status === "connected";
  const google = integrationsQuery.data?.find((i) => i.provider === "google");
  const isGoogleConnected = google?.status === "connected";

  const generateCode = useMutation({
    mutationFn: () => api.post<LinkCodeResponse>("/integrations/telegram/link-code"),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete("/integrations/telegram"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
  });

  const disconnectGoogle = useMutation({
    mutationFn: () => api.delete("/integrations/google"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations"] }),
  });

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
          <span className="text-sm font-medium">Integrations</span>
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
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-6 py-6">
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium">Google (Gmail + Calendar)</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isGoogleConnected
                  ? `Connected${google?.externalId ? ` as ${google.externalId}` : ""}`
                  : "Not connected"}
              </p>
            </div>
            {isGoogleConnected ? (
              <button
                onClick={() => disconnectGoogle.mutate()}
                disabled={disconnectGoogle.isPending}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700"
              >
                {disconnectGoogle.isPending ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : (
              <a
                href="/api/v1/integrations/google/connect"
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              >
                Connect Google
              </a>
            )}
          </div>
          {!isGoogleConnected && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Requires GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI and ENCRYPTION_MASTER_KEY configured on the server — see
              README. Gmail search/read/draft and Calendar read work immediately after connecting; sending an email
              always requires your approval first.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium">Telegram</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isConnected
                  ? `Connected${telegram?.metadata?.username ? ` as @${telegram.metadata.username}` : ""}`
                  : "Not connected"}
              </p>
            </div>
            {isConnected ? (
              <button
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700"
              >
                {disconnect.isPending ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : (
              <button
                onClick={() => generateCode.mutate()}
                disabled={generateCode.isPending}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              >
                {generateCode.isPending ? "Generating..." : "Generate linking code"}
              </button>
            )}
          </div>

          {generateCode.data && !isConnected && (
            <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-900">
              <p>
                Open your bot in Telegram and send:{" "}
                <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">/start {generateCode.data.code}</code>
              </p>
              {generateCode.data.deepLink && (
                <p className="mt-2">
                  Or tap:{" "}
                  <a
                    href={generateCode.data.deepLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-600 underline dark:text-sky-400"
                  >
                    {generateCode.data.deepLink}
                  </a>
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Code expires at {new Date(generateCode.data.expiresAt).toLocaleTimeString()}.
              </p>
            </div>
          )}

          {!telegram && !generateCode.data && (
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Requires the owner to configure TELEGRAM_BOT_TOKEN on the server first — see README.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
