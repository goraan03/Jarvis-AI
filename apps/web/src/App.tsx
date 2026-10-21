import { useEffect, useState } from "react";

type HealthStatus = "checking" | "ok" | "error";

export default function App() {
  const [apiStatus, setApiStatus] = useState<HealthStatus>("checking");

  useEffect(() => {
    fetch("/api/v1/health")
      .then((res) => (res.ok ? setApiStatus("ok") : setApiStatus("error")))
      .catch(() => setApiStatus("error"));
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Jarvis</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          Personal AI agent — foundation scaffold (Phase 1).
        </p>
        <div className="mt-8 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm">
            API status:{" "}
            <span
              className={
                apiStatus === "ok"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : apiStatus === "error"
                    ? "text-red-600 dark:text-red-400"
                    : "text-slate-400"
              }
            >
              {apiStatus}
            </span>
          </p>
        </div>
      </main>
    </div>
  );
}
