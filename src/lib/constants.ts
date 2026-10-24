import {
  BookOpen,
  Brain,
  CalendarDays,
  Code2,
  CodeXml,
  FileStack,
  Flag,
  GraduationCap,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Map,
  Megaphone,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
  UserSearch,
  ClipboardCheck,
  History,
  BarChart3,
} from "lucide-react";
import type { ContestDisplayStatus, TeamStatus, AccountStatus, MemberStatus } from "@/types";

export const APP_NAME = "ICPC SGU Community";
export const APP_TAGLINE = "Think ... Code ... Conquer!";
export const LEVEL_LABEL = "Level 1";

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export const STUDENT_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/profile", label: "My Profile", icon: CodeXml },
  { to: "/team", label: "My Team", icon: Users },
  { to: "/find-teammates", label: "Find Teammates", icon: UserSearch },
  { to: "/team/chat", label: "Team Chat", icon: MessageSquare },
  { to: "/codeforces", label: "Codeforces", icon: Code2 },
  { to: "/training", label: "Training", icon: BookOpen },
  { to: "/roadmap", label: "Roadmap", icon: Map },
  { to: "/sheets", label: "Problem Sheets", icon: FileStack },
  { to: "/skills", label: "Skill Map", icon: Brain },
  { to: "/assignments", label: "Assignments", icon: ListChecks },
  { to: "/contests", label: "Virtual Contests", icon: Trophy },
  { to: "/mentorship", label: "Mentorship", icon: GraduationCap },
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck },
  { to: "/announcements", label: "Announcements", icon: Megaphone },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/support", label: "Support", icon: LifeBuoy },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/about", label: "About", icon: ShieldCheck },
];

export const ADMIN_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [
      { to: "/admin", label: "Admin Dashboard", icon: LayoutDashboard },
      { to: "/admin/students", label: "Students", icon: CodeXml },
      { to: "/admin/registrations", label: "Registrations", icon: ScrollText },
      { to: "/admin/teams", label: "Teams", icon: Users },
      { to: "/admin/matching", label: "Team Matching", icon: UserSearch },
      { to: "/admin/chats", label: "Team Chats", icon: MessageSquare },
    ],
  },
  {
    section: "Training",
    items: [
      { to: "/admin/training", label: "Training Weeks", icon: BookOpen },
      { to: "/admin/roadmap", label: "Roadmap", icon: Map },
      { to: "/admin/sheets", label: "Problem Sheets", icon: FileStack },
      { to: "/admin/assignments", label: "Assignments", icon: ListChecks },
      { to: "/admin/codeforces", label: "Codeforces Analytics", icon: Code2 },
      { to: "/admin/contests", label: "Virtual Contests", icon: Trophy },
      { to: "/admin/skills", label: "Skill Analytics", icon: Brain },
    ],
  },
  {
    section: "Operations",
    items: [
      { to: "/admin/mentorship", label: "Mentorship", icon: GraduationCap },
      { to: "/admin/attendance", label: "Attendance", icon: ClipboardCheck },
      { to: "/admin/announcements", label: "Announcements", icon: Megaphone },
      { to: "/admin/support", label: "Support", icon: LifeBuoy },
      { to: "/admin/reports", label: "Reports", icon: BarChart3 },
      { to: "/admin/audit", label: "Audit Logs", icon: History },
      { to: "/admin/settings", label: "Community Settings", icon: Settings },
    ],
  },
];

export const ADMIN_TOP_NAV: NavItem[] = [
  { to: "/dashboard", label: "Student View", icon: ShieldCheck },
  { to: "/admin", label: "Admin", icon: LayoutDashboard },
];

export const TEAM_STATUS_LABELS: Record<TeamStatus, string> = {
  draft: "Draft",
  pending_member_confirmation: "Pending member confirmation",
  looking_for_members: "Looking for members",
  pending_admin_review: "Pending admin review",
  approved: "Approved",
  active: "Active",
  complete: "Complete",
  rejected: "Rejected",
  cancelled: "Cancelled",
  archived: "Archived",
};

export const TEAM_STATUS_VARIANT: Record<TeamStatus, "default" | "secondary" | "destructive" | "success" | "warning" | "muted" | "info"> = {
  draft: "muted",
  pending_member_confirmation: "warning",
  looking_for_members: "info",
  pending_admin_review: "warning",
  approved: "success",
  active: "default",
  complete: "success",
  rejected: "destructive",
  cancelled: "muted",
  archived: "muted",
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pending_verification: "Pending verification",
  pending_approval: "Pending approval",
  active: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  pending_confirmation: "Pending confirmation",
  active: "Active",
  removed: "Removed",
  left: "Left",
};

export const EXPERIENCE_LEVELS = [
  { value: "none", label: "No experience" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

export const AVAILABILITY_SLOTS = [
  "sat-morning", "sat-afternoon", "sat-evening",
  "sun-morning", "sun-afternoon", "sun-evening",
  "mon-evening", "tue-evening", "wed-evening", "thu-evening", "fri-evening",
] as const;

export const RESOURCE_KIND_LABELS: Record<string, string> = {
  pdf: "PDF",
  slides: "Slides",
  document: "Document",
  video: "Video",
  youtube: "YouTube",
  link: "Link",
  problem: "Problem",
  code: "Code example",
  practice_sheet: "Practice sheet",
};

export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  team_invite: "Teams",
  team_join_request: "Teams",
  team_update: "Teams",
  team_message: "Chat",
  training: "Training",
  sheet: "Problem sheets",
  assignment: "Assignments",
  assignment_reminder: "Deadlines",
  contest: "Contests",
  roadmap: "Roadmap",
  mentorship: "Mentorship",
  attendance: "Attendance",
  announcement: "Announcements",
  support: "Support",
  system: "System",
};

/** Derives the display status of a contest from stored status + times. */
export function contestDisplayStatus(c: {
  status: string;
  starts_at: string;
  ends_at: string;
  registration_deadline: string | null;
  now?: Date;
}): ContestDisplayStatus {
  const now = c.now ?? new Date();
  const start = new Date(c.starts_at).getTime();
  const end = new Date(c.ends_at).getTime();
  switch (c.status) {
    case "draft":
      return "draft";
    case "cancelled":
      return "cancelled";
    case "archived":
      return "archived";
    case "completed":
      return "completed";
    default:
      if (now.getTime() < start) {
        const regOpen =
          !c.registration_deadline || now.getTime() < new Date(c.registration_deadline).getTime();
        return regOpen ? "registration_open" : "upcoming";
      }
      if (now.getTime() < end) return "running";
      return "ended";
  }
}

export const CONTEST_DISPLAY_LABELS: Record<ContestDisplayStatus, string> = {
  draft: "Draft",
  upcoming: "Upcoming",
  registration_open: "Registration open",
  running: "Running",
  ended: "Ended — results pending",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const TOPIC_COLORS = [
  "#3b82f6", "#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444",
  "#10b981", "#ec4899", "#14b8a6", "#f97316", "#6366f1",
];

export { Flag };
