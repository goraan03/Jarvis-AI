import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import LoginPage from "./pages/LoginPage.js";
import ChatPage from "./pages/ChatPage.js";
import TasksPage from "./pages/TasksPage.js";
import IntegrationsPage from "./pages/IntegrationsPage.js";
import ApprovalsPage from "./pages/ApprovalsPage.js";
import MemoryPage from "./pages/MemoryPage.js";
import ScheduledTasksPage from "./pages/ScheduledTasksPage.js";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <ChatPage />
              </RequireAuth>
            }
          />
          <Route
            path="/tasks"
            element={
              <RequireAuth>
                <TasksPage />
              </RequireAuth>
            }
          />
          <Route
            path="/integrations"
            element={
              <RequireAuth>
                <IntegrationsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/approvals"
            element={
              <RequireAuth>
                <ApprovalsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/memory"
            element={
              <RequireAuth>
                <MemoryPage />
              </RequireAuth>
            }
          />
          <Route
            path="/scheduled"
            element={
              <RequireAuth>
                <ScheduledTasksPage />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
