import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SessionProvider, useSession } from "./context/session-context";
import { DashboardPage } from "./pages/DashboardPage";
import { ForcePasswordPage } from "./pages/ForcePasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
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
          <Route
            path="/documents"
            element={
              <PlaceholderPage
                title="Documents and evidence"
                description="The Phase 1 route is reserved so the client journey already reflects the full PCI Nexus product. The actual upload tree, validation, and retention workflows are planned for the next phase."
              />
            }
          />
          <Route
            path="/outputs"
            element={
              <PlaceholderPage
                title="Certification outputs"
                description="SAQ, AOC, and diploma generation rules are documented, but their final output engine depends on the remaining official templates and Phase 2 implementation."
              />
            }
          />
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
