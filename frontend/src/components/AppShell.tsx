import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../context/session-context";

const navigation = [
  { to: "/", label: "Dashboard", index: "01" },
  { to: "/questionnaire", label: "Cuestionario", index: "02" },
  { to: "/documents", label: "Documentos", index: "03" },
  { to: "/outputs", label: "Salidas", index: "04" },
  { to: "/tutorial", label: "Tutorial", index: "05" },
  { to: "/repository", label: "Plantillas", index: "06" },
];

const adminNavigation = [
  { to: "/admin/clientes", label: "Admin clientes", index: "A1" },
  { to: "/admin/templates", label: "Admin plantillas", index: "A2" },
  { to: "/admin/saq-evidence", label: "Admin evidencia SAQ", index: "A3" },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useSession();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isSidebarOpen]);

  return (
    <div className="app-shell">
      <button
        type="button"
        className={`sidebar-backdrop${isSidebarOpen ? " open" : ""}`}
        aria-label="Cerrar menu lateral"
        aria-hidden={!isSidebarOpen}
        tabIndex={isSidebarOpen ? 0 : -1}
        onClick={() => setIsSidebarOpen(false)}
      />

      <aside id="sidebar-navigation" className={`sidebar${isSidebarOpen ? " open" : ""}`} aria-label="Navegacion principal">
        <div className="brand-panel sidebar-brand-panel">
          <div className="brand-shield brand-shield-full">
            <img className="brand-logo brand-logo-full" src="/pcinexus-logo.png" alt="PCI Nexus logo" />
          </div>
        </div>

        <div className="sidebar-mobile-header">
          <div className="brand-panel">
            <div className="brand-shield brand-shield-full">
              <img className="brand-logo brand-logo-full" src="/pcinexus-logo.png" alt="PCI Nexus logo" />
            </div>
          </div>

          <button
            type="button"
            className="sidebar-close-button"
            aria-label="Cerrar menu lateral"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="sidebar-section-label">{user?.role === "ADMIN" ? "Administracion" : "Mi certificacion"}</div>
        <nav className="nav-list">
          {(user?.role === "ADMIN" ? adminNavigation : navigation).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
              onClick={() => setIsSidebarOpen(false)}
            >
              <span className="nav-index">{item.index}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <p className="muted-label sidebar-eyebrow">Acceso activo</p>
          <strong className="sidebar-user-name">
            {user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.username}
          </strong>
          <span className="role-pill">{user?.role === "CLIENT" ? "Cliente" : user?.role}</span>
          <button
            type="button"
            className="sidebar-signout"
            onClick={() => {
              signOut();
              navigate("/login", { replace: true });
            }}
          >
            Cerrar sesion
          </button>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu-button"
            aria-label="Abrir menu lateral"
            aria-expanded={isSidebarOpen}
            aria-controls="sidebar-navigation"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu aria-hidden="true" />
          </button>
          <div className="topbar-badge">PCI Nexus · Portal del cliente</div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
