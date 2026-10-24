import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, Bell, BookOpen, CalendarDays, CheckCircle2, ClipboardCheck,
  Code2, Crown, ListChecks, Megaphone, MessageSquare, Trophy, UserPlus, Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDate, formatDateTime, initials, daysUntil } from "@/lib/utils";
import { APP_NAME, LEVEL_LABEL } from "@/lib/constants";
import { PageHeader, ErrorState, LoadingRows, StatCard } from "@/components/shared/PageComponents";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CF_RANK_COLORS } from "@/lib/cf-constants";
import type { StudentDashboard } from "@/types";

export default function DashboardPage() {
  const { profile } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["student-dashboard", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_dashboard_data");
      if (error) throw error;
      return data as StudentDashboard;
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Dashboard" />
      <LoadingRows rows={6} />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;
  if (!data) return <ErrorState message="Could not load dashboard." />;

  const d = data;

  return (
    <>
      <PageHeader
        title={`Welcome, ${profile?.full_name_en?.split(" ")[0] ?? "student"} 👋`}
        description={`${APP_NAME} · ${LEVEL_LABEL} Management Platform`}
      />

      {/* Priority: no team yet */}
      {!d.team && (
        <Card className="mb-6 border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" /> You are not in a team yet</CardTitle>
            <CardDescription>
              {d.pending_invitations.length > 0
                ? "You have a pending team invitation below — respond to join."
                : "Official teams have 3 members. Register a team or find teammates to get started."}
            </CardDescription>
          </CardHeader>
          {d.pending_invitations.length === 0 && (
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild><Link to="/team"><UserPlus /> Register a team</Link></Button>
              <Button variant="outline" asChild><Link to="/find-teammates">Find teammates</Link></Button>
            </CardContent>
          )}
        </Card>
      )}

      {d.pending_invitations.length > 0 && (
        <Card className="mb-6 border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pending team invitations ({d.pending_invitations.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.pending_invitations.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <p className="text-sm">Invitation to join <span className="font-medium">{inv.team_name}</span></p>
                <Button asChild size="sm"><Link to="/team">Review</Link></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Profile completion"
          value={`${d.profile_completion.percent}%`}
          icon={CheckCircle2}
          className={d.profile_completion.percent < 100 ? "border-warning/40" : "border-success/40"}
        />
        <StatCard label="Unread notifications" value={d.unread_notifications} icon={Bell} />
        <StatCard label="Unread team messages" value={d.unread_messages} icon={MessageSquare} />
        <StatCard
          label="Attendance"
          value={
            d.attendance_summary.total > 0
              ? `${Math.round(((d.attendance_summary.present + d.attendance_summary.late) / d.attendance_summary.total) * 100)}%`
              : "—"
          }
          icon={ClipboardCheck}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Team */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">My team</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/team">Open <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent>
            {d.team ? (
              <>
                <p className="mb-3 flex items-center gap-2 font-medium">
                  {d.team.name}
                  {d.team.is_leader && <Badge variant="info" className="gap-1"><Crown className="h-3 w-3" /> You lead</Badge>}
                  <Badge variant={d.team.status === "complete" ? "success" : "warning"}>
                    {d.team.status.replace(/_/g, " ")}
                  </Badge>
                </p>
                <div className="space-y-2">
                  {d.team.members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-sm">
                      <Avatar className="h-6 w-6">
                        {m.avatar_url ? <AvatarImage src={m.avatar_url} /> : null}
                        <AvatarFallback className="text-[10px]">{initials(m.name)}</AvatarFallback>
                      </Avatar>
                      <span className="flex-1 truncate">{m.name}</span>
                      {m.is_leader && <Crown className="h-3.5 w-3.5 text-warning" />}
                      {m.status === "pending_confirmation" && (
                        <Badge variant="warning">pending confirmation</Badge>
                      )}
                    </div>
                  ))}
                  {d.team.members.filter((m) => m.status === "active").length < d.team.capacity && (
                    <p className="text-xs text-muted-foreground">
                      {d.team.capacity - d.team.members.filter((m) => m.status === "active").length} member slot(s) open —{" "}
                      <Link to="/find-teammates" className="text-primary hover:underline">find teammates</Link>
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No team yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Codeforces */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Code2 className="h-4 w-4 text-primary" /> Codeforces</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/codeforces">Open <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent>
            {d.codeforces?.handle ? (
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Handle</p>
                  <p className="font-medium">{d.codeforces.handle}{d.codeforces.verified && " ✓"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Rating</p>
                  <p className="font-semibold">
                    {d.codeforces.rating ?? "—"}
                    {d.codeforces.rank && (
                      <span className={`ml-1 text-xs font-normal ${CF_RANK_COLORS[d.codeforces.rank.toLowerCase()] ?? ""}`}>
                        {d.codeforces.rank}
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Max</p>
                  <p className="font-medium">{d.codeforces.max_rating ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Solved</p>
                  <p className="font-medium">{d.codeforces.solved_count}</p>
                </div>
                {d.codeforces.recent_contest && (
                  <p className="col-span-full text-xs text-muted-foreground">
                    Last contest: {d.codeforces.recent_contest.name} — rank {d.codeforces.recent_contest.rank ?? "?"}{" "}
                    ({d.codeforces.recent_contest.delta != null && d.codeforces.recent_contest.delta >= 0 ? "+" : ""}
                    {d.codeforces.recent_contest.delta})
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground">No handle linked — link it to track your rating and solved problems automatically.</p>
                <Button size="sm" className="mt-2" asChild><Link to="/codeforces">Link handle</Link></Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assignments */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><ListChecks className="h-4 w-4 text-primary" /> Upcoming assignments</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/assignments">All <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.upcoming_assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open assignments.</p>
            ) : (
              d.upcoming_assignments.map((a) => {
                const dd = a.due_at ? daysUntil(a.due_at) : null;
                return (
                  <Link key={a.id} to={`/assignments/${a.id}`} className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent/50">
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    {a.submitted ? (
                      <Badge variant="success">submitted</Badge>
                    ) : dd != null && dd < 0 ? (
                      <Badge variant="destructive">overdue</Badge>
                    ) : (
                      <Badge variant="secondary">{dd}d left</Badge>
                    )}
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Training */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4 text-primary" /> Training</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/training">Open <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.current_week ? (
              <Link to={`/training/${d.current_week.id}`} className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
                <span className="font-medium">Current: Week {d.current_week.week_number} — {d.current_week.title}</span>
                <ArrowRight className="h-4 w-4 text-primary" />
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">No current week scheduled.</p>
            )}
            {d.recent_weeks.slice(0, 2).map((w) => (
              <Link key={w.id} to={`/training/${w.id}`} className="block truncate rounded-md border p-2 text-sm hover:bg-accent/50">
                Week {w.week_number} — {w.title}
              </Link>
            ))}
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link to="/roadmap"><CalendarDays /> View roadmap</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Contests */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4 text-primary" /> Upcoming contests</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/contests">All <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.upcoming_contests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scheduled contests.</p>
            ) : (
              d.upcoming_contests.map((c) => (
                <Link key={c.id} to={`/contests/${c.id}`} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm hover:bg-accent/50">
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(c.starts_at)}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Mentorship */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Mentorship</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/mentorship">Book <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.next_bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming sessions — book one when you need help.</p>
            ) : (
              d.next_bookings.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{b.topic}</span>
                  <Badge variant={b.status === "confirmed" ? "success" : "warning"}>{b.status}</Badge>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(b.starts_at)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Announcements */}
      {d.announcements.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Megaphone className="h-4 w-4 text-primary" /> Latest announcements</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/announcements">All <ArrowRight /></Link></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.announcements.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
                <Badge variant={a.priority === "critical" ? "destructive" : a.priority === "important" ? "warning" : "secondary"}>
                  {a.priority}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Profile completion nudge */}
      {!d.profile_completion.completed && (
        <Card className="mt-6">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Complete your profile</p>
              <Progress value={d.profile_completion.percent} className="mt-2" />
            </div>
            <Button size="sm" asChild><Link to="/profile">Finish profile</Link></Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
