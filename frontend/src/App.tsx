import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SessionProvider, useSession } from "./context/session-context";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { ForcePasswordPage } from "./pages/ForcePasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { OutputsPage } from "./pages/OutputsPage";
import { QuestionnairePage } from "./pages/QuestionnairePage";
import { RepositoryPage } from "./pages/RepositoryPage";
import { TutorialPage } from "./pages/TutorialPage";

function AppRoutes() {
  const { isAuthenticated, user } = useSession();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ForcePasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route
          element={
            isAuthenticated && user?.mustChangePassword ? <Navigate to="/change-password" replace /> : <AppShell />
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/questionnaire" element={<QuestionnairePage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/outputs" element={<OutputsPage />} />
          <Route path="/tutorial" element={<TutorialPage />} />
          <Route path="/repository" element={<RepositoryPage />} />
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
