import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { isAdmin, isManagerOrAdmin } from "@/lib/roles";
import {
  LayoutDashboard, Target, FileText, MessageSquare, Sparkles,
  Users, LogOut, BookOpen, Gauge, Inbox
} from "lucide-react";

function NavItem({ to, icon: Icon, label, testId }) {
  return (
    <NavLink to={to} end data-testid={testId}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 text-sm brutal-hover ${
          isActive ? "bg-black text-white" : "hover:bg-[var(--surface-hover)]"
        }`}>
      <Icon size={16} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [isDri, setIsDri] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/objectives`, { credentials: "include" });
        if (!r.ok) return;
        const objs = await r.json();
        setIsDri(objs.some(o => o.dri_id === user.id));
      } catch (_e) { /* ignore */ }
    })();
  }, [user]);

  if (!user) return null;

  const userIsAdmin = isAdmin(user);
  const userIsManager = isManagerOrAdmin(user);

  const onLogout = async () => {
    await logout();
    nav("/login");
  };

  return (
    <div className="min-h-screen grid grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="brutal-border border-y-0 border-l-0 bg-white flex flex-col">
        <div className="px-5 py-5 brutal-border border-t-0 border-l-0 border-r-0">
          <div className="mono-label">NOSH</div>
          <div className="text-lg font-semibold tracking-tight">Focus Cycles</div>
        </div>

        <nav className="p-3 space-y-1 flex-1">
          <div className="mono-label px-3 pb-2 pt-1">MY WORK</div>
          <NavItem to="/" icon={LayoutDashboard} label="Dashboard" testId="nav-dashboard" />
          <NavItem to="/my-plan" icon={Target} label="My Plan" testId="nav-my-plan" />
          <NavItem to="/weekly" icon={Gauge} label="Weekly Update" testId="nav-weekly" />
          <NavItem to="/reflection" icon={BookOpen} label="Reflection" testId="nav-reflection" />
          <NavItem to="/feedback" icon={MessageSquare} label="DRI Feedback" testId="nav-feedback" />
          {isDri && <NavItem to="/my-feedback" icon={Inbox} label="My Feedback" testId="nav-my-feedback" />}

          <div className="mono-label px-3 pt-5 pb-2">TEAM</div>
          <NavItem to="/cycles" icon={Sparkles} label="Cycles & Objectives" testId="nav-cycles" />
          {userIsManager && <NavItem to="/manager" icon={FileText} label="Manager Review" testId="nav-manager" />}
          {userIsAdmin && <NavItem to="/admin/users" icon={Users} label="Users" testId="nav-users" />}
        </nav>

        <div className="p-3 brutal-border border-b-0 border-l-0 border-r-0">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-9 h-9 bg-black text-white flex items-center justify-center text-sm font-semibold">
              {user.name?.[0] || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user.name}</div>
              <div className="mono-label truncate">{user.role}</div>
            </div>
            <button onClick={onLogout} data-testid="logout-button"
              className="p-2 hover:bg-[var(--surface-hover)]" title="Log out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
