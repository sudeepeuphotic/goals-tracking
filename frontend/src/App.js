import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "@/pages/Login";
import AppShell from "@/components/AppShell";
import Dashboard from "@/pages/Dashboard";
import Cycles from "@/pages/Cycles";
import ObjectiveDetail from "@/pages/ObjectiveDetail";
import MyPlan from "@/pages/MyPlan";
import WeeklyUpdatePage from "@/pages/WeeklyUpdatePage";
import Reflection from "@/pages/Reflection";
import DRIFeedbackPage from "@/pages/DRIFeedbackPage";
import ManagerReview from "@/pages/ManagerReview";
import AdminUsers from "@/pages/AdminUsers";
import ResetPassword from "@/pages/ResetPassword";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) return <div className="p-10 mono-label">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/"
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="cycles" element={<Cycles />} />
        <Route path="objectives/:id" element={<ObjectiveDetail />} />
        <Route path="my-plan" element={<MyPlan />} />
        <Route path="weekly" element={<WeeklyUpdatePage />} />
        <Route path="reflection" element={<Reflection />} />
        <Route path="feedback" element={<DRIFeedbackPage />} />
        <Route path="manager" element={<ManagerReview />} />
        <Route path="admin/users" element={<AdminUsers />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="App">
          <AppRoutes />
          <Toaster position="top-right" theme="light" />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
