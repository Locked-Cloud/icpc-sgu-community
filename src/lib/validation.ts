import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .url("Enter a valid URL (including https://)")
  .max(500)
  .or(z.literal("").transform(() => undefined))
  .optional();

const phoneRegex = /^\+?[0-9\s\-()]{7,20}$/;

export const signUpSchema = z
  .object({
    full_name_en: z.string().trim().min(3, "Name must be at least 3 characters").max(120),
    email: z.string().trim().email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters").max(72),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type SignUpValues = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
});

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters").max(72),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const profileSchema = z.object({
  full_name_en: z.string().trim().min(3).max(120),
  full_name_ar: z.string().trim().max(120).optional().or(z.literal("")),
  university_id: z.string().trim().regex(/^[A-Za-z0-9\-\/]{4,30}$/, "4–30 letters/digits").optional().or(z.literal("")),
  phone: z.string().trim().regex(phoneRegex, "Enter a valid phone number").optional().or(z.literal("")),
  whatsapp: z.string().trim().regex(phoneRegex, "Enter a valid phone number").optional().or(z.literal("")),
  university_email: z.string().trim().email().optional().or(z.literal("")),
  academic_year: z.string().optional(),
  faculty: z.string().trim().max(120).optional().or(z.literal("")),
  programming_experience: z.enum(["none", "beginner", "intermediate", "advanced"]).optional(),
  preferred_language: z.string().optional(),
  previous_cp_experience: z.boolean().optional(),
  availability: z.array(z.string()).optional(),
  github_url: optionalUrl,
  linkedin_url: optionalUrl,
  other_profile_urls: z.array(z.string().trim().url()).optional(),
  bio: z.string().trim().max(1000).optional().or(z.literal("")),
  show_contact: z.boolean().optional(),
  show_university_id: z.boolean().optional(),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const createTeamSchema = z
  .object({
    registration_type: z.enum(["complete", "incomplete", "individual"]),
    name: z.string().trim().max(80).optional().or(z.literal("")),
    description: z.string().trim().max(500).optional().or(z.literal("")),
    member_ids: z.array(z.string().uuid()).max(4).optional(),
    leader_id: z.string().uuid().optional(),
    preferred_languages: z.array(z.string()).optional(),
    experience_preference: z.enum(["any", "beginner", "intermediate", "advanced"]).optional(),
    availability: z.array(z.string()).optional(),
  })
  .refine((v) => v.registration_type !== "complete" || (v.member_ids?.length ?? 0) === 2, {
    message: "A complete team needs exactly two other members",
    path: ["member_ids"],
  })
  .refine((v) => v.registration_type === "individual" || (v.name && v.name.length >= 3), {
    message: "Team name must be at least 3 characters",
    path: ["name"],
  })
  .refine((v) => v.registration_type !== "complete" || (v.member_ids?.length ?? 0) <= 2, {
    message: "A team can have at most 3 members including you",
    path: ["member_ids"],
  });
export type CreateTeamValues = z.infer<typeof createTeamSchema>;

export const trainingWeekSchema = z
  .object({
    week_number: z.coerce.number().int().min(1).max(200),
    title: z.string().trim().min(3).max(150),
    description: z.string().trim().max(3000).optional().or(z.literal("")),
    objectives: z.array(z.string().trim().max(200)).optional(),
    topics: z.array(z.string().trim().max(60)).optional(),
    start_date: z.string().optional().or(z.literal("")),
    end_date: z.string().optional().or(z.literal("")),
    status: z.enum(["draft", "scheduled", "published", "archived"]),
    publish_at: z.string().optional().or(z.literal("")),
    notes: z.string().trim().max(3000).optional().or(z.literal("")),
  })
  .refine((v) => !v.start_date || !v.end_date || v.start_date <= v.end_date, {
    message: "End date must be after start date",
    path: ["end_date"],
  });

export const resourceSchema = z.object({
  title: z.string().trim().min(2).max(200),
  kind: z.enum(["pdf", "slides", "document", "video", "youtube", "link", "problem", "code", "practice_sheet"]),
  url: optionalUrl,
  description: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type ResourceValues = z.infer<typeof resourceSchema>;

export const problemInputSchema = z.object({
  url: z.string().trim().url("Enter a valid problem URL"),
  title: z.string().trim().min(1).max(200).optional().or(z.literal("")),
  rating: z.coerce.number().int().min(0).max(5000).optional(),
  topic_slugs: z.array(z.string()).optional(),
});
export type ProblemInputValues = z.infer<typeof problemInputSchema>;

export const sheetSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  week_id: z.string().uuid().optional().or(z.literal("")),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]),
  objectives: z.array(z.string().trim().max(200)).optional(),
  topic_ids: z.array(z.string().uuid()).optional(),
  deadline: z.string().optional().or(z.literal("")),
  status: z.enum(["draft", "published", "archived"]),
});

export const assignmentSchema = z
  .object({
    title: z.string().trim().min(3).max(150),
    description: z.string().trim().max(3000).optional().or(z.literal("")),
    instructions: z.string().trim().max(5000).optional().or(z.literal("")),
    topics: z.array(z.string()).optional(),
    difficulty: z.enum(["easy", "medium", "hard", "mixed"]).optional(),
    starts_at: z.string().optional().or(z.literal("")),
    due_at: z.string().optional().or(z.literal("")),
    max_score: z.coerce.number().min(0).max(1000).optional(),
    week_id: z.string().uuid().optional().or(z.literal("")),
    sheet_id: z.string().uuid().optional().or(z.literal("")),
    problem_url: optionalUrl,
    submission_requirements: z.string().trim().max(2000).optional().or(z.literal("")),
    mode: z.enum(["individual", "team"]),
    reminder_target: z.enum(["all", "leader"]),
    status: z.enum(["draft", "published", "archived"]),
  })
  .refine((v) => !v.starts_at || !v.due_at || v.starts_at <= v.due_at, {
    message: "Deadline must be after the start date",
    path: ["due_at"],
  });
export type AssignmentValues = z.infer<typeof assignmentSchema>;

export const submissionSchema = z.object({
  content_url: z.string().trim().url("Enter a valid link to your solution").max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type SubmissionValues = z.infer<typeof submissionSchema>;

export const contestSchema = z
  .object({
    title: z.string().trim().min(3).max(150),
    description: z.string().trim().max(3000).optional().or(z.literal("")),
    starts_at: z.string().min(1, "Start time is required"),
    ends_at: z.string().min(1, "End time is required"),
    registration_deadline: z.string().optional().or(z.literal("")),
    participation: z.enum(["team", "individual"]),
    scoring_mode: z.enum(["icpc", "points"]),
    penalty_minutes: z.coerce.number().int().min(0).max(240),
    rules: z.string().trim().max(5000).optional().or(z.literal("")),
    external_url: optionalUrl,
    status: z.enum(["draft", "scheduled", "completed", "cancelled", "archived"]),
  })
  .refine((v) => new Date(v.starts_at) < new Date(v.ends_at), {
    message: "End time must be after start time",
    path: ["ends_at"],
  });
export type ContestValues = z.infer<typeof contestSchema>;

export const contestProblemSchema = z.object({
  code: z.string().trim().min(1).max(5),
  title: z.string().trim().max(200).optional().or(z.literal("")),
  url: optionalUrl,
  points: z.coerce.number().min(0).optional(),
  topic_slugs: z.array(z.string()).optional(),
});

export const mentorSchema = z.object({
  profile_id: z.string().uuid(),
  headline: z.string().trim().max(150).optional().or(z.literal("")),
  bio: z.string().trim().max(1000).optional().or(z.literal("")),
  expertise: z.array(z.string().trim().max(60)).optional(),
  session_types: z.array(z.string().trim().max(60)).optional(),
  default_duration_minutes: z.coerce.number().int().min(15).max(120),
  active: z.boolean(),
});
export type MentorValues = z.infer<typeof mentorSchema>;

export const availabilityRuleSchema = z.object({
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
  duration_minutes: z.coerce.number().int().min(15).max(120),
  buffer_minutes: z.coerce.number().int().min(0).max(60),
  max_per_day: z.coerce.number().int().min(1).max(20),
  min_notice_hours: z.coerce.number().int().min(0).max(168),
});

export const bookingSchema = z.object({
  topic: z.string().trim().min(3, "Describe your question (at least 3 characters)").max(150),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  related_topic: z.string().trim().max(60).optional().or(z.literal("")),
});
export type BookingValues = z.infer<typeof bookingSchema>;

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(150),
  body: z.string().trim().min(3).max(8000),
  priority: z.enum(["normal", "important", "critical"]),
  audience: z.enum(["all", "teams", "students"]),
  audience_ids: z.array(z.string().uuid()).optional(),
  expires_at: z.string().optional().or(z.literal("")),
  status: z.enum(["draft", "published"]),
});

export const supportRequestSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  category: z.enum(["account", "team", "training", "technical", "other"]).default("other"),
  description: z.string().trim().min(10, "Please describe your issue (at least 10 characters)").max(4000),
});

export const sessionSchema = z
  .object({
    title: z.string().trim().min(3).max(150),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    starts_at: z.string().min(1, "Start time is required"),
    ends_at: z.string().optional().or(z.literal("")),
    location: z.string().trim().max(150).optional().or(z.literal("")),
    meeting_url: optionalUrl,
    week_id: z.string().uuid().optional().or(z.literal("")),
  })
  .refine((v) => !v.ends_at || new Date(v.starts_at) <= new Date(v.ends_at), {
    message: "End must be after start",
    path: ["ends_at"],
  });

export const roadmapMilestoneSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  objectives: z.array(z.string().trim().max(200)).optional(),
  topic_slugs: z.array(z.string()).optional(),
  week_id: z.string().uuid().optional().or(z.literal("")),
  sheet_id: z.string().uuid().optional().or(z.literal("")),
  assignment_id: z.string().uuid().optional().or(z.literal("")),
  completion_threshold: z.coerce.number().min(0.01).max(1),
  hard_prerequisite: z.boolean(),
  sort_order: z.coerce.number().int().min(0),
  target_date: z.string().optional().or(z.literal("")),
  status: z.enum(["draft", "published", "archived"]),
  prerequisites: z.array(z.string().uuid()).optional(),
});

export const settingsSchema = z.object({
  approval_required: z.boolean(),
  registration_open: z.boolean(),
  team_size: z.coerce.number().int().min(2).max(5),
  timezone: z.string().min(2),
  reminder_offsets_days: z.array(z.coerce.number().int().min(0).max(60)),
  send_deadline_reminder: z.boolean(),
  default_penalty_minutes: z.coerce.number().int().min(0).max(240),
  min_cf_sync_interval_minutes: z.coerce.number().int().min(5).max(1440),
  academic_years: z.array(z.string().trim().min(1)),
  programming_languages: z.array(z.string().trim().min(1)),
});
