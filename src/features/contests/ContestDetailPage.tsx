import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Trophy, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { CONTEST_DISPLAY_LABELS, contestDisplayStatus } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { toCSV, downloadCSV } from "@/lib/csv";
import { PageHeader, ErrorState, LoadingRows } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { ContestProblem, StandingRow, VirtualContest } from "@/types";

export default function ContestDetailPage() {
  const { contestId } = useParams<{ contestId: string }>();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["contest", contestId, profile?.id],
    enabled: !!contestId && !!profile,
    queryFn: async () => {
      const { data: contest, error: cErr } = await supabase
        .from("virtual_contests")
        .select("*")
        .eq("id", contestId!)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!contest) throw new Error("Contest not found.");

      const [{ data: problems }, { data: registrations }] = await Promise.all([
        supabase.from("contest_problems").select("*").eq("contest_id", contestId!).order("sort_order"),
        supabase.from("contest_registrations").select("*").eq("contest_id", contestId!),
      ]);

      // my registration state
      const { data: myTeam } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("student_id", profile!.id)
        .eq("status", "active")
        .maybeSingle();
      const regs = (registrations ?? []) as { id: string; team_id: string | null; student_id: string | null }[];
      const mine = regs.some(
        (r) => r.student_id === profile!.id || (myTeam?.team_id && r.team_id === myTeam.team_id),
      );

      // standings (visible when completed/running)
      const c = contest as VirtualContest;
      let standings: StandingRow[] = [];
      if (["completed", "running"].includes(c.status)) {
        const { data: st, error: stErr } = await supabase.rpc("contest_standings", { p_contest_id: contestId });
        if (stErr) throw stErr;
        standings = (st ?? []) as StandingRow[];
      }

      return {
        contest: c,
        problems: (problems ?? []) as ContestProblem[],
        registrations: regs,
        mine,
        standings,
      };
    },
  });

  const register = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("register_for_contest", { p_contest_id: contestId });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Registered!");
      void qc.invalidateQueries({ queryKey: ["contest", contestId] });
      void qc.invalidateQueries({ queryKey: ["contests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Contest" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const { contest: c, problems, mine, standings } = data!;
  const display = contestDisplayStatus(c);

  const exportStandings = () => {
    const csv = toCSV(
      standings.map((s) => ({
        rank: s.rank,
        participant: s.participant_label,
        solved: s.solved,
        score: s.total_score,
        penalty: s.penalty_minutes,
      })),
      ["rank", "participant", "solved", "score", "penalty"],
    );
    downloadCSV(`${c.title.replace(/\s+/g, "-").toLowerCase()}-standings.csv`, csv);
  };

  return (
    <>
      <PageHeader
        title={c.title}
        description={c.description ?? undefined}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/contests"><ArrowLeft /> All contests</Link>
            </Button>
            {display === "registration_open" && !mine && (
              <Button onClick={() => register.mutate()} disabled={register.isPending}>
                {c.participation === "team" ? <Users /> : null} Register {c.participation === "team" ? "team" : ""}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge
          variant={display === "running" ? "success" : display === "registration_open" ? "info" : "secondary"}
        >
          {CONTEST_DISPLAY_LABELS[display]}
        </Badge>
        <Badge variant="secondary" className="uppercase">{c.scoring_mode} scoring</Badge>
        {c.participation === "team" && <Badge variant="outline">Team contest</Badge>}
        {mine && <Badge variant="info">You are registered</Badge>}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4 text-sm"><p className="text-xs uppercase text-muted-foreground">Starts</p><p className="font-medium">{formatDateTime(c.starts_at)}</p></CardContent></Card>
        <Card><CardContent className="p-4 text-sm"><p className="text-xs uppercase text-muted-foreground">Ends</p><p className="font-medium">{formatDateTime(c.ends_at)}</p></CardContent></Card>
        <Card><CardContent className="p-4 text-sm"><p className="text-xs uppercase text-muted-foreground">Penalty</p><p className="font-medium">{c.penalty_minutes} min per wrong attempt</p></CardContent></Card>
      </div>

      {c.rules && (
        <Card className="mb-6">
          <CardHeader className="pb-2"><CardTitle className="text-base">Rules</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-wrap text-sm text-muted-foreground">{c.rules}</p></CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Problems</CardTitle>
          <CardDescription>
            Problems are solved on the external platform — links open the original statements.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {problems.length === 0 && <p className="text-sm text-muted-foreground">Problem set will be published with the contest.</p>}
          {problems.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3">
              <Badge variant="secondary" className="font-mono">{p.code}</Badge>
              <span className="min-w-0 flex-1 truncate text-sm">{p.title ?? "Problem"}</span>
              {p.points != null && <Badge variant="outline">{p.points} pts</Badge>}
              {p.url && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={p.url} target="_blank" rel="noreferrer"><ExternalLink /> Open</a>
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4 text-primary" /> Standings</CardTitle>
            <CardDescription>Computed from recorded results only.</CardDescription>
          </div>
          {standings.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportStandings}>Export CSV</Button>
          )}
        </CardHeader>
        <CardContent>
          {!["completed", "running"].includes(c.status) ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Results appear after the contest ends and results are published.
            </p>
          ) : standings.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No results recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">#</TableHead>
                  <TableHead>Participant</TableHead>
                  <TableHead>Solved</TableHead>
                  {c.scoring_mode === "points" && <TableHead>Score</TableHead>}
                  <TableHead>Penalty</TableHead>
                  <TableHead className="hidden md:table-cell">Per problem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standings.map((s) => (
                  <TableRow key={`${s.team_id ?? s.student_id}`}>
                    <TableCell className="font-semibold tabular-nums">{s.rank}</TableCell>
                    <TableCell className="max-w-56 truncate">{s.participant_label}</TableCell>
                    <TableCell className="tabular-nums">{s.solved}</TableCell>
                    {c.scoring_mode === "points" && <TableCell className="tabular-nums">{s.total_score}</TableCell>}
                    <TableCell className="tabular-nums">{s.penalty_minutes}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex gap-1">
                        {s.problems.map((p) => (
                          <span
                            key={p.code}
                            title={`${p.code}: ${p.solved ? `solved, ${p.attempts} attempt(s), ${p.solve_time_minutes ?? "?"} min` : `unsolved, ${p.attempts} attempt(s)`}`}
                            className={`inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-mono ${
                              p.solved ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {p.code}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
