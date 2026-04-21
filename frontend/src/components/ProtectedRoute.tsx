import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../context/session-context";

export function ProtectedRoute() {
  const location = useLocation();
  const { isAuthenticated } = useSession();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
