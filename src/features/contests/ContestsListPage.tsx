import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { CONTEST_DISPLAY_LABELS, contestDisplayStatus } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { VirtualContest } from "@/types";

export default function ContestsListPage() {
  const { profile } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["contests", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("virtual_contests")
        .select("*")
        .neq("status", "draft")
        .neq("status", "archived")
        .order("starts_at", { ascending: false });
      if (error) throw error;

      const contests = (data ?? []) as VirtualContest[];
      const { data: registrations } = await supabase
        .from("contest_registrations")
        .select("contest_id");
      const registered = new Set(((registrations ?? []) as { contest_id: string }[]).map((r) => r.contest_id));
      // team registrations of my team also count
      const { data: myTeam } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("student_id", profile!.id)
        .eq("status", "active")
        .maybeSingle();
      if (myTeam?.team_id) {
        const { data: teamRegs } = await supabase
          .from("contest_registrations")
          .select("contest_id")
          .eq("team_id", myTeam.team_id);
        for (const r of (teamRegs ?? []) as { contest_id: string }[]) registered.add(r.contest_id);
      }
      return contests.map((c) => ({ ...c, registered: registered.has(c.id) }));
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Virtual Contests" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <>
        <PageHeader title="Virtual Contests" />
        <EmptyState icon={Trophy} title="No contests announced yet" description="Contests appear here once announced." />
      </>
    );
  }

  const live = data.filter((c) => contestDisplayStatus(c) === "running");
  const rest = data.filter((c) => contestDisplayStatus(c) !== "running");

  const renderCard = (c: VirtualContest & { registered?: boolean }) => {
    const display = contestDisplayStatus(c);
    return (
      <Link key={c.id} to={`/contests/${c.id}`} className="block">
        <Card className="transition-colors hover:border-primary/50">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 py-4">
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {c.title}
                <Badge variant="secondary" className="uppercase">{c.scoring_mode}</Badge>
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(c.starts_at)} → {formatDateTime(c.ends_at)}
                {c.registration_deadline && ` · register before ${formatDateTime(c.registration_deadline)}`}
              </p>
            </div>
            <div className="flex gap-2">
              {c.registered && <Badge variant="info">Registered</Badge>}
              <Badge
                variant={
                  display === "running" ? "success" :
                  display === "completed" ? "secondary" :
                  display === "registration_open" ? "info" : "muted"
                }
              >
                {CONTEST_DISPLAY_LABELS[display]}
              </Badge>
            </div>
          </CardHeader>
        </Card>
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Virtual Contests"
        description="Practice contests run by the community. Standings are computed from recorded results."
      />
      {live.length > 0 && (
        <>
          <p className="mb-2 text-sm font-medium text-success">Live now</p>
          <div className="mb-6 space-y-3">{live.map(renderCard)}</div>
        </>
      )}
      <div className="space-y-3">{rest.map(renderCard)}</div>
    </>
  );
}
