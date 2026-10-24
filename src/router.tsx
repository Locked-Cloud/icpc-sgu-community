import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import { FullScreenLoader, RequireAdmin, RequireAuth } from "@/components/layout/guards";

// ── Public (auth) ────────────────────────────────────────────────────────────
const AuthLayout = lazy(() => import("@/features/auth/AuthLayout"));
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const RegisterPage = lazy(() => import("@/features/auth/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("@/features/auth/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/features/auth/ResetPasswordPage"));
const AuthCallbackPage = lazy(() => import("@/features/auth/AuthCallbackPage"));

// ── Student ──────────────────────────────────────────────────────────────────
const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage"));
const ProfilePage = lazy(() => import("@/features/profile/ProfilePage"));
const MyTeamPage = lazy(() => import("@/features/teams/MyTeamPage"));
const TeamChatPage = lazy(() => import("@/features/chat/TeamChatPage"));
const FindTeammatesPage = lazy(() => import("@/features/teams/FindTeammatesPage"));
const CodeforcesPage = lazy(() => import("@/features/codeforces/CodeforcesPage"));
const TrainingListPage = lazy(() => import("@/features/training/TrainingListPage"));
const TrainingWeekPage = lazy(() => import("@/features/training/TrainingWeekPage"));
const RoadmapPage = lazy(() => import("@/features/roadmap/RoadmapPage"));
const SheetsListPage = lazy(() => import("@/features/sheets/SheetsListPage"));
const SheetDetailPage = lazy(() => import("@/features/sheets/SheetDetailPage"));
const SkillMapPage = lazy(() => import("@/features/skills/SkillMapPage"));
const AssignmentsListPage = lazy(() => import("@/features/assignments/AssignmentsListPage"));
const AssignmentDetailPage = lazy(() => import("@/features/assignments/AssignmentDetailPage"));
const ContestsListPage = lazy(() => import("@/features/contests/ContestsListPage"));
const ContestDetailPage = lazy(() => import("@/features/contests/ContestDetailPage"));
const MentorshipPage = lazy(() => import("@/features/mentorship/MentorshipPage"));
const AttendancePage = lazy(() => import("@/features/attendance/AttendancePage"));
const AnnouncementsPage = lazy(() => import("@/features/announcements/AnnouncementsPage"));
const NotificationsPage = lazy(() => import("@/features/notifications/NotificationsPage"));
const CalendarPage = lazy(() => import("@/features/calendar/CalendarPage"));
const SupportPage = lazy(() => import("@/features/support/SupportPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));

// ── Admin ────────────────────────────────────────────────────────────────────
const AdminDashboardPage = lazy(() => import("@/features/admin/AdminDashboardPage"));
const AdminStudentsPage = lazy(() => import("@/features/admin/AdminStudentsPage"));
const AdminRegistrationsPage = lazy(() => import("@/features/admin/AdminRegistrationsPage"));
const AdminTeamsPage = lazy(() => import("@/features/admin/AdminTeamsPage"));
const AdminMatchingPage = lazy(() => import("@/features/admin/AdminMatchingPage"));
const AdminChatsPage = lazy(() => import("@/features/admin/AdminChatsPage"));
const AdminTrainingPage = lazy(() => import("@/features/admin/AdminTrainingPage"));
const AdminRoadmapPage = lazy(() => import("@/features/admin/AdminRoadmapPage"));
const AdminSheetsPage = lazy(() => import("@/features/admin/AdminSheetsPage"));
const AdminAssignmentsPage = lazy(() => import("@/features/admin/AdminAssignmentsPage"));
const AdminCodeforcesPage = lazy(() => import("@/features/admin/AdminCodeforcesPage"));
const AdminContestsPage = lazy(() => import("@/features/admin/AdminContestsPage"));
const AdminSkillsPage = lazy(() => import("@/features/admin/AdminSkillsPage"));
const AdminMentorshipPage = lazy(() => import("@/features/admin/AdminMentorshipPage"));
const AdminAttendancePage = lazy(() => import("@/features/admin/AdminAttendancePage"));
const AdminAnnouncementsPage = lazy(() => import("@/features/admin/AdminAnnouncementsPage"));
const AdminSupportPage = lazy(() => import("@/features/admin/AdminSupportPage"));
const AdminReportsPage = lazy(() => import("@/features/admin/AdminReportsPage"));
const AdminAuditPage = lazy(() => import("@/features/admin/AdminAuditPage"));
const AdminSettingsPage = lazy(() => import("@/features/admin/AdminSettingsPage"));

const NotFoundPage = lazy(() => import("@/features/misc/NotFoundPage"));
const AboutPage = lazy(() => import("@/features/misc/AboutPage"));

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<FullScreenLoader label="Loading page…" />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: (
      <Lazy>
        <AuthLayout />
      </Lazy>
    ),
    children: [
      { path: "/login", element: <Lazy><LoginPage /></Lazy> },
      { path: "/register", element: <Lazy><RegisterPage /></Lazy> },
      { path: "/forgot-password", element: <Lazy><ForgotPasswordPage /></Lazy> },
      { path: "/reset-password", element: <Lazy><ResetPasswordPage /></Lazy> },
    ],
  },
  { path: "/auth/callback", element: <Lazy><AuthCallbackPage /></Lazy> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: <Navigate to="/dashboard" replace /> },
      { path: "/dashboard", element: <Lazy><DashboardPage /></Lazy> },
      { path: "/profile", element: <Lazy><ProfilePage /></Lazy> },
      { path: "/team", element: <Lazy><MyTeamPage /></Lazy> },
      { path: "/team/chat", element: <Lazy><TeamChatPage /></Lazy> },
      { path: "/find-teammates", element: <Lazy><FindTeammatesPage /></Lazy> },
      { path: "/codeforces", element: <Lazy><CodeforcesPage /></Lazy> },
      { path: "/training", element: <Lazy><TrainingListPage /></Lazy> },
      { path: "/training/:weekId", element: <Lazy><TrainingWeekPage /></Lazy> },
      { path: "/roadmap", element: <Lazy><RoadmapPage /></Lazy> },
      { path: "/sheets", element: <Lazy><SheetsListPage /></Lazy> },
      { path: "/sheets/:sheetId", element: <Lazy><SheetDetailPage /></Lazy> },
      { path: "/skills", element: <Lazy><SkillMapPage /></Lazy> },
      { path: "/assignments", element: <Lazy><AssignmentsListPage /></Lazy> },
      { path: "/assignments/:assignmentId", element: <Lazy><AssignmentDetailPage /></Lazy> },
      { path: "/contests", element: <Lazy><ContestsListPage /></Lazy> },
      { path: "/contests/:contestId", element: <Lazy><ContestDetailPage /></Lazy> },
      { path: "/mentorship", element: <Lazy><MentorshipPage /></Lazy> },
      { path: "/attendance", element: <Lazy><AttendancePage /></Lazy> },
      { path: "/announcements", element: <Lazy><AnnouncementsPage /></Lazy> },
      { path: "/notifications", element: <Lazy><NotificationsPage /></Lazy> },
      { path: "/calendar", element: <Lazy><CalendarPage /></Lazy> },
      { path: "/support", element: <Lazy><SupportPage /></Lazy> },
      { path: "/settings", element: <Lazy><SettingsPage /></Lazy> },
      { path: "/about", element: <Lazy><AboutPage /></Lazy> },
      {
        path: "/admin",
        element: (
          <RequireAdmin>
            <Outlet />
          </RequireAdmin>
        ),
        children: [
          { index: true, element: <Lazy><AdminDashboardPage /></Lazy> },
          { path: "students", element: <Lazy><AdminStudentsPage /></Lazy> },
          { path: "registrations", element: <Lazy><AdminRegistrationsPage /></Lazy> },
          { path: "teams", element: <Lazy><AdminTeamsPage /></Lazy> },
          { path: "matching", element: <Lazy><AdminMatchingPage /></Lazy> },
          { path: "chats", element: <Lazy><AdminChatsPage /></Lazy> },
          { path: "training", element: <Lazy><AdminTrainingPage /></Lazy> },
          { path: "roadmap", element: <Lazy><AdminRoadmapPage /></Lazy> },
          { path: "sheets", element: <Lazy><AdminSheetsPage /></Lazy> },
          { path: "assignments", element: <Lazy><AdminAssignmentsPage /></Lazy> },
          { path: "codeforces", element: <Lazy><AdminCodeforcesPage /></Lazy> },
          { path: "contests", element: <Lazy><AdminContestsPage /></Lazy> },
          { path: "skills", element: <Lazy><AdminSkillsPage /></Lazy> },
          { path: "mentorship", element: <Lazy><AdminMentorshipPage /></Lazy> },
          { path: "attendance", element: <Lazy><AdminAttendancePage /></Lazy> },
          { path: "announcements", element: <Lazy><AdminAnnouncementsPage /></Lazy> },
          { path: "support", element: <Lazy><AdminSupportPage /></Lazy> },
          { path: "reports", element: <Lazy><AdminReportsPage /></Lazy> },
          { path: "audit", element: <Lazy><AdminAuditPage /></Lazy> },
          { path: "settings", element: <Lazy><AdminSettingsPage /></Lazy> },
        ],
      },
    ],
  },
  { path: "*", element: <Lazy><NotFoundPage /></Lazy> },
]);
