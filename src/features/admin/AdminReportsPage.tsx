import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { toCSV, downloadCSV } from "@/lib/csv";
import { formatDate, formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AssignmentSubmission, AttendanceRecord, Profile, Team, TrainingSession } from "@/types";

export default function AdminReportsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-reports"],
    queryFn: async () => {
      const [students, teams, sessions, attendance, submissions] = await Promise.all([
        supabase.from("profiles").select("*").eq("role", "student").order("full_name_en"),
        supabase.from("teams").select("*").neq("status", "archived").order("name"),
        supabase.from("training_sessions").select("*").order("starts_at", { ascending: false }).limit(100),
        supabase.from("attendance_records").select("*"),
        supabase.from("assignment_submissions").select("*").order("submitted_at", { ascending: false }).limit(500),
      ]);
      return {
        students: (students.data ?? []) as Profile[],
        teams: (teams.data ?? []) as Team[],
        sessions: (sessions.data ?? []) as TrainingSession[],
        attendance: (attendance.data ?? []) as AttendanceRecord[],
        submissions: (submissions.data ?? []) as AssignmentSubmission[],
      };
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Reports" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} />;

  const d = data!;

  const exportStudents = () =>
    downloadCSV("report-students.csv", toCSV(d.students.map((s) => ({
      name: s.full_name_en, university_id: s.university_id ?? "", academic_year: s.academic_year ?? "",
      status: s.status, codeforces: s.codeforces_handle ?? "", joined: formatDate(s.created_at),
    }))));

  const exportTeams = () =>
    downloadCSV("report-teams.csv", toCSV(d.teams.map((t) => ({
      name: t.name, status: t.status, type: t.registration_type, capacity: t.capacity,
      approved: t.approved_at ? formatDate(t.approved_at) : "", created: formatDate(t.created_at),
    }))));

  const exportAttendance = async () => {
    const profiles = await fetchProfiles(d.attendance.map((a) => a.student_id));
    const sessionMap = new Map(d.sessions.map((s) => [s.id, s]));
    downloadCSV("report-attendance.csv", toCSV(d.attendance.map((a) => ({
      student: profiles[a.student_id]?.full_name_en ?? a.student_id,
      session: sessionMap.get(a.session_id)?.title ?? a.session_id,
      date: sessionMap.get(a.session_id) ? formatDateTime(sessionMap.get(a.session_id)!.starts_at) : "",
      status: a.status, recorded: formatDateTime(a.recorded_at),
    }))));
  };

  const exportSubmissions = () =>
    downloadCSV("report-submissions.csv", toCSV(d.submissions.map((s) => ({
      assignment: s.assignment_id, student: s.student_id, mode: s.team_id ? "team" : "individual",
      status: s.status, score: s.score ?? "", submitted: formatDateTime(s.submitted_at),
    }))));

  const reports = [
    {
      title: "Students",
      description: `${d.students.length} students — names, IDs, status, Codeforces handles.`,
      onExport: exportStudents,
    },
    {
      title: "Teams",
      description: `${d.teams.length} teams — status, type, approval dates.`,
      onExport: exportTeams,
    },
    {
      title: "Attendance records",
      description: `${d.attendance.length} records across ${d.sessions.length} sessions.`,
      onExport: exportAttendance,
    },
    {
      title: "Assignment submissions",
      description: `${d.submissions.length} submissions with status and scores.`,
      onExport: exportSubmissions,
    },
  ];

  return (
    <>
      <PageHeader
        title="Reports & Exports"
        description="Authorized CSV exports computed from actual stored data."
      />
      {reports.length === 0 ? (
        <EmptyState title="No data to report yet" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {reports.map((r) => (
            <Card key={r.title}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{r.title}</CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" onClick={() => void r.onExport()}>
                  <Download /> Export CSV
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
