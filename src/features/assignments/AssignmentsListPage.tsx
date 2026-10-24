import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, ListChecks, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDate, daysUntil } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState, StatCard } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { Assignment } from "@/types";

export default function AssignmentsListPage() {
  const { profile } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["assignments", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: assignments, error } = await supabase
        .from("assignments")
        .select("*")
        .eq("status", "published")
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      if (!assignments || assignments.length === 0) return { assignments: [], submissions: new Map() };

      const { data: myTeam } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("student_id", profile!.id)
        .eq("status", "active")
        .maybeSingle();

      const { data: submissions } = await supabase
        .from("assignment_submissions")
        .select("*")
        .in("assignment_id", assignments.map((a: Assignment) => a.id))
        .or(`student_id.eq.${profile!.id}${myTeam?.team_id ? `,team_id.eq.${myTeam.team_id}` : ""}`);

      const map = new Map<string, { status: string }>();
      for (const s of (submissions ?? []) as { assignment_id: string; status: string }[]) {
        map.set(s.assignment_id, s);
      }
      return { assignments: assignments as Assignment[], submissions: map };
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Assignments" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const assignments = data?.assignments ?? [];
  const submissions = data?.submissions ?? new Map();
  const open = assignments.filter((a) => !a.due_at || new Date(a.due_at) > new Date());
  const submitted = assignments.filter((a) => submissions.has(a.id)).length;
  const overdue = assignments.filter(
    (a) => a.due_at && new Date(a.due_at) < new Date() && !submissions.has(a.id),
  ).length;

  return (
    <>
      <PageHeader title="Assignments" description="Practice work with deadlines. Submit links to your solutions." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Open assignments" value={open.length} icon={ListChecks} />
        <StatCard label="Submitted" value={submitted} icon={CheckCircle2} />
        <StatCard label="Overdue" value={overdue} icon={CalendarClock} />
      </div>

      {assignments.length === 0 ? (
        <EmptyState icon={ListChecks} title="No assignments yet" description="Published assignments will appear here." />
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const sub = submissions.get(a.id);
            const d = a.due_at ? daysUntil(a.due_at) : null;
            return (
              <Link key={a.id} to={`/assignments/${a.id}`} className="block">
                <Card className="transition-colors hover:border-primary/50">
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-4">
                    <div className="min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {a.title}
                        <Badge variant="secondary" className="gap-1">
                          {a.mode === "team" ? <><Users className="h-3 w-3" /> Team</> : "Individual"}
                        </Badge>
                        {a.difficulty && <Badge variant="outline" className="capitalize">{a.difficulty}</Badge>}
                      </CardTitle>
                      {a.due_at && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Due {formatDate(a.due_at)}
                          {d != null && d >= 0 && !sub && ` · ${d} day${d !== 1 ? "s" : ""} left`}
                        </p>
                      )}
                    </div>
                    {sub ? (
                      <Badge variant={["accepted"].includes(sub.status) ? "success" : sub.status === "late" ? "warning" : "info"}>
                        {sub.status.replace("_", " ")}
                      </Badge>
                    ) : d != null && d < 0 ? (
                      <Badge variant="destructive">Overdue</Badge>
                    ) : (
                      <Badge variant="muted">Not started</Badge>
                    )}
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
