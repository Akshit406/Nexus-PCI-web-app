import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SessionProvider, useSession } from "./context/session-context";
import { AdminClientsPage } from "./pages/AdminClientsPage";
import { AdminExecutivesPage } from "./pages/AdminExecutivesPage";
import { AdminOperationsPage } from "./pages/AdminOperationsPage";
import { AdminSaqEvidencePage } from "./pages/AdminSaqEvidencePage";
import { AdminSaqPreviewPage } from "./pages/AdminSaqPreviewPage";
import { AdminTemplatesPage } from "./pages/AdminTemplatesPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { ExecutivePortalPage } from "./pages/ExecutivePortalPage";
import { ForcePasswordPage } from "./pages/ForcePasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { MfaSettingsPage } from "./pages/MfaSettingsPage";
import { OutputsPage } from "./pages/OutputsPage";
import { QuestionnairePage } from "./pages/QuestionnairePage";
import { RepositoryPage } from "./pages/RepositoryPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { TutorialPage } from "./pages/TutorialPage";

function AppRoutes() {
  const { isAuthenticated, user } = useSession();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/change-password" element={<ForcePasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route
          element={
            isAuthenticated && user?.mustChangePassword ? <Navigate to="/change-password" replace /> : <AppShell />
          }
        >
          <Route path="/" element={user?.role === "ADMIN" ? <Navigate to="/admin/clientes" replace /> : user?.role === "EXECUTIVE" ? <Navigate to="/executive" replace /> : <DashboardPage />} />
          <Route path="/questionnaire" element={user?.role !== "CLIENT" ? <Navigate to="/" replace /> : <QuestionnairePage />} />
          <Route path="/documents" element={user?.role !== "CLIENT" ? <Navigate to="/" replace /> : <DocumentsPage />} />
          <Route path="/outputs" element={user?.role !== "CLIENT" ? <Navigate to="/" replace /> : <OutputsPage />} />
          <Route path="/tutorial" element={user?.role !== "CLIENT" ? <Navigate to="/" replace /> : <TutorialPage />} />
          <Route path="/repository" element={user?.role === "ADMIN" ? <Navigate to="/admin/clientes" replace /> : <RepositoryPage />} />
          <Route path="/executive" element={user?.role === "EXECUTIVE" ? <ExecutivePortalPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/clientes" element={user?.role === "ADMIN" ? <AdminClientsPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/templates" element={user?.role === "ADMIN" ? <AdminTemplatesPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/saq-evidence" element={user?.role === "ADMIN" ? <AdminSaqEvidencePage /> : <Navigate to="/" replace />} />
          <Route path="/admin/saq-preview" element={user?.role === "ADMIN" ? <AdminSaqPreviewPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/operaciones" element={user?.role === "ADMIN" ? <AdminOperationsPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/executives" element={user?.role === "ADMIN" ? <AdminExecutivesPage /> : <Navigate to="/" replace />} />
          <Route
            path="/account/mfa"
            element={user?.role === "ADMIN" || user?.role === "EXECUTIVE" ? <MfaSettingsPage /> : <Navigate to="/" replace />}
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to={isAuthenticated ? "/" : "/login"} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <AppRoutes />
    </SessionProvider>
  );
}
