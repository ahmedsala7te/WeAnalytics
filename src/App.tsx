import { HashRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAppStore } from "@/store/useAppStore";
import { Shell } from "@/layouts/Shell";
import { LoginPage } from "@/pages/LoginPage";
import { HomePage } from "@/pages/HomePage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { SourcesPage } from "@/pages/SourcesPage";
import { SettingsPage } from "@/pages/SettingsPage";

function RequireAuth() {
  const user = useAppStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/workspace" element={<WorkspacePage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
