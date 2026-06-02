import { useState } from "react";
import API from "@/lib/api";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { AccountPage } from "@/pages/AccountPage";
import { AdminDashboard } from "@/pages/AdminDashboard";
import { UserDashboard } from "@/pages/UserDashboard";
import { CliAuthPage } from "@/pages/CliAuthPage";

export default function App() {
  const [role, setRole] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const pathname = window.location.pathname;
  const isRegisterRoute = pathname === "/register";
  const isCliAuthRoute = pathname === "/auth/cli";

  useState(() => {
    if (isRegisterRoute || isCliAuthRoute) { setChecked(true); return; }
    API("/api/auth/status")
      .then((r) => {
        if (!r.ok) throw new Error("not authed");
        return r.json();
      })
      .then((data) => setRole(data.user?.role || null))
      .catch(() => setRole(null))
      .finally(() => setChecked(true));
  });

  if (!checked) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  }

  // CLI auth page — handles its own auth check / redirect
  if (isCliAuthRoute) return <CliAuthPage />;

  if (isRegisterRoute) return <RegisterPage />;
  if (role === "admin") return <AdminDashboard />;
  if (role) return <UserDashboard />;
  return <LoginPage onLogin={(r) => setRole(r)} />;
}
