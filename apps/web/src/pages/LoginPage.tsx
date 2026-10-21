import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { ApiError } from "../lib/api.js";

export default function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 p-6 dark:border-slate-800"
      >
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Jarvis</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Sign in with your owner account.</p>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
