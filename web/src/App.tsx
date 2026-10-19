import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { RunsListPage } from "./runs/RunsListPage";
import { RunDetailPage } from "./runs/RunDetailPage";
import { WorkersPage } from "./workers/WorkersPage";
import { WorkflowBuilderPage } from "./workflows/WorkflowBuilderPage";

function Nav() {
  const { logout } = useAuth();
  return (
    <nav style={{ padding: "8px 24px", background: "#1a1a2e", display: "flex", gap: 24, alignItems: "center" }}>
      <span style={{ color: "#fff", fontWeight: 700 }}>Conductor</span>
      <Link style={{ color: "#ccc" }} to="/runs">Runs</Link>
      <Link style={{ color: "#ccc" }} to="/workflows/new">Builder</Link>
      <Link style={{ color: "#ccc" }} to="/workers">Workers</Link>
      <button style={{ marginLeft: "auto" }} onClick={logout}>Sign out</button>
    </nav>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { token } = useAuth();
  return (
    <>
      {token && <Nav />}
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/runs" element={<Protected><RunsListPage /></Protected>} />
        <Route path="/runs/:id" element={<Protected><RunDetailPage /></Protected>} />
        <Route path="/workers" element={<Protected><WorkersPage /></Protected>} />
        <Route path="/workflows/new" element={<Protected><WorkflowBuilderPage /></Protected>} />
        <Route path="*" element={<Navigate to={token ? "/runs" : "/login"} replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}