import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { rankMatches } from "@/lib/matching";
import { TEAM_STATUS_LABELS, TEAM_STATUS_VARIANT } from "@/lib/constants";
import { initials } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { ProfilePublic, Team, TeamMember } from "@/types";

export default function AdminMatchingPage() {
  const qc = useQueryClient();
  const [selectedStudent, setSelectedStudent] = useState<string>("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-matching"],
    queryFn: async () => {
      const [{ data: teams }, { data: members }] = await Promise.all([
        supabase.from("teams").select("*").neq("status", "archived"),
        supabase.from("team_members").select("*").in("status", ["active", "pending_confirmation"]),
      ]);
      const teamRows = (teams ?? []) as Team[];
      const memberRows = (members ?? []) as TeamMember[];

      const teamlessStudents = memberRows
        .filter(() => true)
        .map((m) => m.student_id);
      const inAnyTeam = new Set(teamlessStudents);

      const { data: allStudents } = await supabase
        .from("profiles_public")
        .select("*")
        .order("full_name_en");
      const students = (allStudents ?? []) as ProfilePublic[];
      const unmatched = students.filter((s) => !inAnyTeam.has(s.id));

      const openTeams = teamRows
        .filter((t) => ["looking_for_members", "active"].includes(t.status) && !t.locked)
        .map((t) => {
          const members2 = memberRows.filter((m) => m.team_id === t.id);
          return { team: t, members: members2, missing: Math.max(t.capacity - members2.length, 0) };
        })
        .filter((t) => t.missing > 0);

      const memberProfiles = await fetchProfiles(memberRows.map((m) => m.student_id));

      return {
        unmatched,
        openTeams: openTeams.map((t) => ({
          ...t,
          members: t.members.map((m) => ({ ...m, profile: memberProfiles[m.student_id] })),
        })),
      };
    },
  });

  const matches = useMemo(() => {
    if (!data || !selectedStudent) return [];
    const me = data.unmatched.find((s) => s.id === selectedStudent);
    if (!me) return [];
    return rankMatches(
      {
        id: me.id, name: me.full_name_en, preferredLanguage: me.preferred_language,
        availability: me.availability ?? [], experience: me.programming_experience,
        academicYear: me.academic_year,
      },
      data.unmatched
        .filter((s) => s.id !== selectedStudent)
        .map((s) => ({
          id: s.id, name: s.full_name_en, preferredLanguage: s.preferred_language,
          availability: s.availability ?? [], experience: s.programming_experience,
          academicYear: s.academic_year,
        })),
      8,
    );
  }, [data, selectedStudent]);

  const invite = useMutation({
    mutationFn: async ({ teamId, studentId }: { teamId: string; studentId: string }) => {
      const { error } = await supabase.rpc("invite_member", { p_team_id: teamId, p_invitee_id: studentId });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Invitation sent");
      void qc.invalidateQueries({ queryKey: ["admin-matching"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Team Matching" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const { unmatched, openTeams } = data ?? { unmatched: [], openTeams: [] };

  return (
    <>
      <PageHeader
        title="Team Matching"
        description="Students without a team and incomplete teams with open slots. Suggestions use the same transparent rules students see."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-medium">Incomplete teams ({openTeams.length})</p>
          {openTeams.length === 0 ? (
            <EmptyState title="No open teams" description="All teams are currently full." />
          ) : (
            <div className="space-y-3">
              {openTeams.map(({ team, members: teamMembers, missing }) => (
                <Card key={team.id}>
                  <CardContent className="p-4">
                    <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
                      {team.name}
                      <Badge variant={TEAM_STATUS_VARIANT[team.status]}>{TEAM_STATUS_LABELS[team.status]}</Badge>
                      <Badge variant="success">{missing} open</Badge>
                    </p>
                    <div className="space-y-1">
                      {teamMembers.map((m) => (
                        <p key={m.id} className="text-xs text-muted-foreground">
                          {m.profile?.full_name_en ?? "?"} · {m.profile?.academic_year ?? ""} · {m.profile?.preferred_language ?? ""}
                        </p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Unmatched students ({unmatched.length})</p>
            <Select value={selectedStudent} onValueChange={setSelectedStudent}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Pick student for match suggestions" /></SelectTrigger>
              <SelectContent>
                {unmatched.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.full_name_en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            {unmatched.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                <Avatar className="h-7 w-7">
                  {s.avatar_url ? <AvatarImage src={s.avatar_url} /> : null}
                  <AvatarFallback className="text-[10px]">{initials(s.full_name_en)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.full_name_en}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[s.academic_year, s.preferred_language, s.programming_experience].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {openTeams.length > 0 && (
                  <Select
                    onValueChange={(teamId) => invite.mutate({ teamId, studentId: s.id })}
                  >
                    <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Invite to team…" /></SelectTrigger>
                    <SelectContent>
                      {openTeams.map(({ team }) => (
                        <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
            {unmatched.length === 0 && <EmptyState title="Everyone has a team" description="No unmatched students." />}
          </div>

          {selectedStudent && matches.length > 0 && (
            <Card className="mt-4">
              <CardContent className="p-4">
                <p className="mb-2 text-sm font-medium">Suggested teammates</p>
                {matches.map((m) => (
                  <p key={m.id} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{m.name}</span> — {m.match.score}% · {m.match.reasons[0] ?? "no strong signals"}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
