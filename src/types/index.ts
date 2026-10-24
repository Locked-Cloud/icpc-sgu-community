// ─────────────────────────────────────────────────────────────────────────────
// Database row types (hand-maintained to match supabase/migrations/*.sql).
// The supabase client is used untyped; these types annotate query results.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "student" | "admin" | "mentor";
export type AccountStatus = "pending_verification" | "pending_approval" | "active" | "suspended" | "deactivated";
export type TeamStatus =
  | "draft"
  | "pending_member_confirmation"
  | "looking_for_members"
  | "pending_admin_review"
  | "approved"
  | "active"
  | "complete"
  | "rejected"
  | "cancelled"
  | "archived";
export type RegistrationType = "complete" | "incomplete" | "individual";
export type MemberStatus = "pending_confirmation" | "active" | "removed" | "left";
export type PublishStatus = "draft" | "scheduled" | "published" | "archived";
export type ProblemSource = "codeforces" | "atcoder" | "cses" | "other";
export type CompletionSource = "manual" | "codeforces" | "imported";
export type SubmissionStatus = "submitted" | "late" | "under_review" | "accepted" | "needs_improvement";
export type ContestStatus = "draft" | "scheduled" | "completed" | "cancelled" | "archived";
export type ContestDisplayStatus = "upcoming" | "registration_open" | "running" | "ended" | "completed" | "cancelled" | "archived" | "draft";
export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show" | "rescheduled";
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type SupportStatus = "open" | "in_progress" | "resolved" | "closed";
export type ResourceKind = "pdf" | "slides" | "document" | "video" | "youtube" | "link" | "problem" | "code" | "practice_sheet";

export interface CommunitySettings {
  id: number;
  community_name: string;
  university_name: string;
  tagline: string;
  timezone: string;
  program_label: string;
  intake_label: string;
  team_size: number;
  approval_required: boolean;
  registration_open: boolean;
  academic_years: string[];
  programming_languages: string[];
  reminder_offsets_days: number[];
  send_deadline_reminder: boolean;
  default_penalty_minutes: number;
  min_cf_sync_interval_minutes: number;
  updated_at: string;
}

export interface Profile {
  id: string;
  role: Role;
  status: AccountStatus;
  full_name_en: string;
  full_name_ar: string | null;
  university_id: string | null;
  avatar_url: string | null;
  university_email: string | null;
  personal_email: string | null;
  phone: string | null;
  whatsapp: string | null;
  academic_year: string | null;
  faculty: string | null;
  programming_experience: "none" | "beginner" | "intermediate" | "advanced" | null;
  preferred_language: string | null;
  previous_cp_experience: boolean;
  availability: string[];
  codeforces_handle: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  other_profile_urls: string[];
  bio: string | null;
  show_contact: boolean;
  show_university_id: boolean;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  profile_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Safe public projection of a profile (see profiles_public view). */
export interface ProfilePublic {
  id: string;
  full_name_en: string;
  full_name_ar: string | null;
  avatar_url: string | null;
  academic_year: string | null;
  faculty: string | null;
  programming_experience: Profile["programming_experience"];
  preferred_language: string | null;
  previous_cp_experience: boolean;
  availability: string[];
  codeforces_handle: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  other_profile_urls: string[];
  bio: string | null;
  show_contact: boolean;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  status: TeamStatus;
  registration_type: RegistrationType;
  leader_id: string | null;
  description: string | null;
  preferred_languages: string[];
  experience_preference: "any" | "beginner" | "intermediate" | "advanced" | null;
  availability: string[];
  capacity: number;
  program: string;
  intake: string;
  locked: boolean;
  rejection_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  student_id: string;
  status: MemberStatus;
  joined_at: string | null;
  confirmed_at: string | null;
  removed_at: string | null;
  created_at: string;
}

export interface TeamMemberWithProfile extends TeamMember {
  profile?: ProfilePublic | null;
}

export interface TeamInvitation {
  id: string;
  team_id: string;
  inviter_id: string;
  invitee_id: string;
  message: string | null;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  responded_at: string | null;
  created_at: string;
  team?: Pick<Team, "id" | "name" | "status">;
  invitee?: ProfilePublic | null;
}

export interface TeamJoinRequest {
  id: string;
  team_id: string;
  student_id: string;
  message: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
  student?: ProfilePublic | null;
  team?: Pick<Team, "id" | "name">;
}

export interface TeamConversation {
  id: string;
  team_id: string;
  created_at: string;
}

export interface Message {
  id: number;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  kind: "user" | "system";
  reply_to_id: number | null;
  pinned: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  sender?: ProfilePublic | null;
}

export interface TrainingWeek {
  id: string;
  week_number: number;
  title: string;
  description: string | null;
  objectives: string[];
  topics: string[];
  start_date: string | null;
  end_date: string | null;
  status: PublishStatus;
  publish_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  resources?: TrainingResource[];
  completed_resources?: number;
}

export interface TrainingResource {
  id: string;
  week_id: string;
  title: string;
  kind: ResourceKind;
  url: string | null;
  storage_path: string | null;
  description: string | null;
  sort_order: number;
  visible: boolean;
  created_at: string;
  updated_at: string;
  completed?: boolean;
}

export interface Topic {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
}

export interface Problem {
  id: string;
  source: ProblemSource;
  external_id: string;
  title: string;
  url: string;
  rating: number | null;
  created_at: string;
  topics?: Topic[];
}

export interface ProblemSheet {
  id: string;
  title: string;
  description: string | null;
  week_id: string | null;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  objectives: string[];
  status: PublishStatus;
  deadline: string | null;
  created_at: string;
  updated_at: string;
  topics?: Topic[];
  items?: (ProblemSheetItem & { problem?: Problem })[];
}

export interface ProblemSheetItem {
  id: string;
  sheet_id: string;
  problem_id: string;
  sort_order: number;
  required: boolean;
}

export interface ProblemCompletion {
  id: string;
  user_id: string;
  problem_id: string;
  source: CompletionSource;
  verified_at: string | null;
  completed_at: string;
}

export interface CFAccount {
  id: string;
  user_id: string;
  handle: string;
  verified: boolean;
  verify_challenge: string | null;
  sync_status: "idle" | "queued" | "syncing" | "ok" | "failed";
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CFSnapshot {
  account_id: string;
  handle: string;
  rating: number | null;
  max_rating: number | null;
  rank: string | null;
  max_rank: string | null;
  contribution: number;
  title_photo: string | null;
  contests_count: number;
  fetched_at: string;
}

export interface CFRatingEntry {
  id: number;
  account_id: string;
  contest_id: number;
  contest_name: string;
  rank: number | null;
  rating_update_at: string;
  old_rating: number | null;
  new_rating: number | null;
}

export interface CFSolved {
  id: number;
  account_id: string;
  contest_id: number;
  problem_index: string;
  problem_name: string | null;
  rating: number | null;
  tags: string[];
  solved_at: string | null;
}

export interface Assignment {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  topics: string[];
  difficulty: "easy" | "medium" | "hard" | "mixed" | null;
  starts_at: string | null;
  due_at: string | null;
  max_score: number | null;
  week_id: string | null;
  sheet_id: string | null;
  problem_url: string | null;
  submission_requirements: string | null;
  attachments: { name: string; url: string }[];
  mode: "individual" | "team";
  reminder_target: "all" | "leader";
  status: PublishStatus;
  created_at: string;
  updated_at: string;
}

export interface AssignmentSubmission {
  id: string;
  assignment_id: string;
  student_id: string;
  team_id: string | null;
  content_url: string | null;
  notes: string | null;
  status: SubmissionStatus;
  score: number | null;
  feedback: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string;
  updated_at: string;
  student?: ProfilePublic | null;
}

export interface ScheduledReminder {
  id: string;
  assignment_id: string;
  kind: "advance" | "deadline";
  offset_days: number;
  remind_at: string;
  status: "scheduled" | "processing" | "sent" | "cancelled" | "failed";
}

export interface VirtualContest {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  registration_deadline: string | null;
  participation: "team" | "individual";
  scoring_mode: "icpc" | "points";
  penalty_minutes: number;
  rules: string | null;
  external_url: string | null;
  announcement: string | null;
  status: ContestStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  problems?: ContestProblem[];
  registered?: boolean;
}

export interface ContestProblem {
  id: string;
  contest_id: string;
  code: string;
  title: string | null;
  url: string | null;
  points: number | null;
  difficulty: string | null;
  topic_slugs: string[];
  sort_order: number;
}

export interface ContestRegistration {
  id: string;
  contest_id: string;
  team_id: string | null;
  student_id: string | null;
  registered_by: string;
  created_at: string;
}

export interface StandingProblem {
  code: string;
  solved: boolean;
  attempts: number;
  solve_time_minutes: number | null;
  points: number | null;
}

export interface StandingRow {
  rank: number;
  participant_label: string;
  team_id: string | null;
  student_id: string | null;
  solved: number;
  total_score: number;
  penalty_minutes: number;
  last_solve_minute: number;
  problems: StandingProblem[];
}

export interface TrainingSession {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  meeting_url: string | null;
  week_id: string | null;
  mentor_id: string | null;
  resources: { name: string; url: string }[];
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
  note: string | null;
  recorded_by: string | null;
  recorded_at: string;
  updated_at: string;
  student?: ProfilePublic | null;
}

export interface Mentor {
  id: string;
  profile_id: string;
  headline: string | null;
  bio: string | null;
  expertise: string[];
  session_types: string[];
  default_duration_minutes: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  profile?: ProfilePublic | null;
}

export interface MentorAvailabilityRule {
  id: string;
  mentor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  buffer_minutes: number;
  max_per_day: number;
  min_notice_hours: number;
}

export interface MentorBooking {
  id: string;
  mentor_id: string;
  student_id: string;
  topic: string;
  description: string | null;
  related_topic: string | null;
  related_assignment_id: string | null;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  meeting_url: string | null;
  outcome_notes: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  mentor?: Mentor | null;
  student_profile?: ProfilePublic | null;
}

export interface MentorSlot {
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: "normal" | "important" | "critical";
  audience: "all" | "teams" | "students";
  audience_ids: string[];
  status: "draft" | "published";
  published_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: number;
  recipient_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPreferences {
  user_id: string;
  email_enabled: boolean;
  email_kinds: string[];
  muted_kinds: string[];
  updated_at: string;
}

export interface SupportRequest {
  id: string;
  student_id: string;
  subject: string;
  category: string;
  description: string;
  attachment_url: string | null;
  status: SupportStatus;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  student?: ProfilePublic | null;
  replies?: SupportReply[];
}

export interface SupportReply {
  id: string;
  request_id: string;
  author_id: string;
  body: string;
  internal: boolean;
  created_at: string;
  author?: ProfilePublic | null;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: ProfilePublic | null;
}

// ── JSONB bundles returned by dashboard RPCs ─────────────────────────────────

export interface StudentDashboard {
  team: {
    id: string;
    name: string;
    status: TeamStatus;
    capacity: number;
    is_leader: boolean;
    members: { id: string; name: string; avatar_url: string | null; status: MemberStatus; is_leader: boolean }[];
  } | null;
  pending_invitations: { id: string; team_name: string; message: string | null; created_at: string }[];
  unread_messages: number;
  unread_notifications: number;
  current_week: { id: string; week_number: number; title: string } | null;
  recent_weeks: { id: string; week_number: number; title: string }[];
  upcoming_assignments: { id: string; title: string; due_at: string | null; mode: string; submitted: boolean }[];
  upcoming_contests: { id: string; title: string; starts_at: string; ends_at: string }[];
  next_bookings: { id: string; topic: string; starts_at: string; status: string }[];
  attendance_summary: { total: number; present: number; late: number; absent: number; excused: number };
  codeforces: {
    handle: string;
    verified: boolean;
    sync_status: string;
    last_synced_at: string | null;
    rating: number | null;
    max_rating: number | null;
    rank: string | null;
    contests_count: number;
    solved_count: number;
    recent_contest: { name: string; rank: number | null; new_rating: number | null; delta: number | null } | null;
  } | null;
  announcements: { id: string; title: string; priority: string; published_at: string | null }[];
  profile_completion: { completed: boolean; percent: number };
}

export interface AdminDashboardStats {
  students_total: number;
  students_active: number;
  students_pending: number;
  students_suspended: number;
  teams_total: number;
  teams_complete: number;
  teams_incomplete: number;
  teams_pending_review: number;
  seeking_teammates: number;
  weeks_published: number;
  sheets_published: number;
  assignments_open: number;
  assignments_overdue: number;
  contests_upcoming: number;
  bookings_upcoming: number;
  bookings_pending: number;
  support_open: number;
  cf_linked: number;
  cf_verified: number;
  cf_sync_failed: number;
  registrations_30d: { date: string; count: number }[];
  rating_distribution: { bucket: number; count: number }[];
  attendance_rate: number | null;
  recent_audits: { id: number; action: string; entity_type: string; actor: string | null; created_at: string }[];
}

export interface RoadmapMilestone {
  id: string;
  title: string;
  description: string | null;
  objectives: string[];
  topic_slugs: string[];
  week_id: string | null;
  sheet_id: string | null;
  assignment_id: string | null;
  completion_threshold: string | number;
  hard_prerequisite: boolean;
  sort_order: number;
  target_date: string | null;
  status: PublishStatus;
  created_at: string;
  updated_at: string;
}

export interface RoadmapMilestoneProgress {
  id: string;
  title: string;
  description: string | null;
  objectives: string[];
  topic_slugs: string[];
  week_id: string | null;
  sheet_id: string | null;
  assignment_id: string | null;
  completion_threshold: number;
  hard_prerequisite: boolean;
  sort_order: number;
  target_date: string | null;
  status: "locked" | "completed" | "in_progress" | "not_started";
  prereqs_met: boolean;
  prerequisites: string[];
  progress: { week_ratio: number | null; sheet_ratio: number | null; assignment_done: boolean };
  overdue: boolean;
  is_draft: boolean;
}
