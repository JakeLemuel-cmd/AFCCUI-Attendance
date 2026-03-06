import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { RoleRoute } from "@/routes/RoleRoute";
import { AuthLayout } from "@/layouts/AuthLayout";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { LoginPage } from "@/pages/auth/LoginPage";
import { VoterAccessPage } from "@/pages/auth/VoterAccessPage";
import { AttendanceAccessPage } from "@/pages/auth/AttendanceAccessPage";
import { ActiveElectionsPage } from "@/pages/elections/ActiveElectionsPage";
import { VotingPage } from "@/pages/voting/VotingPage";
import { ResultsPage } from "@/pages/voting/ResultsPage";
import { VotersPage } from "@/pages/admin/VotersPage";
import { BallotPage } from "@/pages/admin/BallotPage";
import { Raffle } from "@/pages/admin/Raffle";
import { SettingsPage } from "@/pages/admin/SettingsPage";
import { IDTemplatePage } from "@/pages/admin/IDTemplatePage";
import { AttendanceDashboard } from "@/pages/admin/AttendanceDashboard";
import { CreateElectionPage } from "@/pages/admin/CreateElectionPage";
import { EditElectionPage } from "@/pages/admin/EditElectionPage";
import { ManagePositionsPage } from "@/pages/admin/ManagePositionsPage";
import { AddCandidatesPage } from "@/pages/admin/AddCandidatesPage";
import { ElectionPreviewPage } from "@/pages/admin/ElectionPreviewPage";
import { ResultsDashboardPage } from "@/pages/admin/ResultsDashboardPage";
import { AuditLogsPage } from "@/pages/admin/AuditLogsPage";
import { PublicElectionPreviewPage } from "@/pages/preview/PublicElectionPreviewPage";
import { UnauthorizedPage } from "@/pages/system/UnauthorizedPage";
import { NotFoundPage } from "@/pages/system/NotFoundPage";
import { FullPageLoader } from "@/components/ui/loading-state";

function HomeRedirect() {
  const { user, loading } = useAuth();

  if (loading) {
    return <FullPageLoader title="Loading workspace" subtitle="Preparing your dashboard..." />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === "voter") {
    return <Navigate to="/elections/active" replace />;
  }

  return <Navigate to="/admin/attendance" replace />;
}

export function AppRouter() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />

        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/access/:id" element={<VoterAccessPage />} />
          <Route path="/attendance-access/:id" element={<AttendanceAccessPage />} />
        </Route>
        <Route path="/preview/:id" element={<PublicElectionPreviewPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route element={<RoleRoute roles={["voter"]} />}>
              <Route path="/dashboard" element={<Navigate to="/elections/active" replace />} />
              <Route path="/elections/active" element={<ActiveElectionsPage />} />
              <Route path="/voting/:id" element={<VotingPage />} />
              <Route path="/results/:id" element={<ResultsPage />} />
            </Route>

            <Route element={<RoleRoute roles={["super_admin", "election_admin"]} />}>
              <Route path="/admin" element={<Navigate to="/admin/attendance" replace />} />
              <Route path="/admin/dashboard" element={<Navigate to="/admin/attendance" replace />} />
              <Route path="/admin/attendance" element={<AttendanceDashboard view="attendance" />} />
              <Route path="/admin/attendance/records" element={<AttendanceDashboard view="records" />} />
              <Route path="/admin/attendance/export" element={<Navigate to="/admin/attendance/records" replace />} />
              <Route path="/admin/attendance/scanner" element={<Navigate to="/admin/attendance" replace />} />
              <Route path="/admin/voters" element={<VotersPage />} />
              <Route path="/admin/ballot" element={<BallotPage />} />
              <Route path="/admin/raffle" element={<Raffle />} />
              <Route path="/admin/raffle/winners" element={<Raffle view="winners" />} />
              <Route path="/admin/settings" element={<SettingsPage />} />
              <Route path="/admin/settings/id-template" element={<IDTemplatePage />} />
              <Route path="/admin/elections/create" element={<CreateElectionPage />} />
              <Route path="/admin/elections/:id/edit" element={<EditElectionPage />} />
              <Route path="/admin/elections/:id/positions" element={<ManagePositionsPage />} />
              <Route path="/admin/elections/:id/candidates" element={<AddCandidatesPage />} />
              <Route path="/admin/elections/:id/preview" element={<ElectionPreviewPage />} />
              <Route path="/admin/elections/:id/results" element={<ResultsDashboardPage />} />
            </Route>

            <Route element={<RoleRoute roles={["super_admin"]} />}>
              <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Router>
  );
}
