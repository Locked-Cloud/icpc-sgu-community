import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis,
} from "recharts";
import {
  BookOpen, ClipboardCheck, Code2, GraduationCap, LifeBuoy, ListChecks,
  ScrollText, Trophy, UserSearch, Users,
} from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, StatCard } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminDashboardStats } from "@/types";

export default function AdminDashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_dashboard_stats");
      if (error) throw error;
      return data as AdminDashboardStats;
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Admin Dashboard" />
      <LoadingRows rows={6} />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;
  if (!data) return <ErrorState message="No data." />;
  const d = data;

  const ratingBuckets = ["unrated", "0–499", "500–999", "1000–1499", "1500–1999", "2000+"];
  const regData = d.registrations_30d.map((r) => ({ date: r.date.slice(5), count: r.count }));

  return (
    <>
      <PageHeader
        title="Admin Dashboard"
        description="Live statistics computed from the database — registrations, teams, training and support."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Students" value={d.students_total} hint={`${d.students_active} active · ${d.students_pending} pending`} icon={Users} />
        <StatCard label="Teams" value={d.teams_total} hint={`${d.teams_complete} complete · ${d.teams_incomplete} incomplete`} icon={UserSearch} />
        <StatCard label="Pending review" value={d.teams_pending_review} hint="teams awaiting decision" icon={ScrollText} className={d.teams_pending_review > 0 ? "border-warning/40" : undefined} />
        <StatCard label="Seeking teammates" value={d.seeking_teammates} icon={UserSearch} />
        <StatCard label="Published weeks" value={d.weeks_published} icon={BookOpen} />
        <StatCard label="Assignments" value={`${d.assignments_open} open`} hint={`${d.assignments_overdue} overdue`} icon={ListChecks} className={d.assignments_overdue > 0 ? "border-warning/40" : undefined} />
        <StatCard label="Upcoming contests" value={d.contests_upcoming} icon={Trophy} />
        <StatCard label="Open support" value={d.support_open} icon={LifeBuoy} className={d.support_open > 0 ? "border-warning/40" : undefined} />
        <StatCard label="Codeforces linked" value={`${d.cf_linked}/${d.students_active}`} hint={`${d.cf_verified} verified · ${d.cf_sync_failed} sync failed`} icon={Code2} />
        <StatCard label="Mentorship upcoming" value={d.bookings_upcoming} hint={`${d.bookings_pending} pending confirmation`} icon={GraduationCap} />
        <StatCard label="Attendance (30d)" value={d.attendance_rate != null ? `${d.attendance_rate}%` : "—"} icon={ClipboardCheck} />
        <StatCard label="Sheets published" value={d.sheets_published} icon={BookOpen} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Registrations — last 30 days</CardTitle>
            <CardDescription>New student accounts per day</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={regData}>
                  <defs>
                    <linearGradient id="reg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
                  <ReTooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                  <Area type="monotone" dataKey="count" stroke="var(--primary)" fill="url(#reg)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Codeforces rating distribution</CardTitle>
            <CardDescription>Linked accounts by rating band</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.rating_distribution.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No linked accounts yet.</p>
            ) : (
              d.rating_distribution.map((b) => {
                const max = Math.max(...d.rating_distribution.map((x) => x.count), 1);
                return (
                  <div key={b.bucket} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-muted-foreground">{ratingBuckets[b.bucket] ?? `band ${b.bucket}`}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
                      <div className="h-full rounded bg-primary" style={{ width: `${(b.count / max) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums">{b.count}</span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent administrative actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {d.recent_audits.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No actions recorded yet.</p>
          ) : (
            d.recent_audits.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="font-mono text-[11px]">{a.action}</Badge>
                <span className="text-muted-foreground">{a.entity_type}</span>
                <span className="ml-auto text-xs text-muted-foreground">{timeAgo(a.created_at)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
