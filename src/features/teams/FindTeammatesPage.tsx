import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { useFindTeammates, useMyTeam } from "@/features/teams/api";
import { rankMatches, suggestTeams } from "@/lib/matching";
import { TEAM_STATUS_VARIANT, TEAM_STATUS_LABELS } from "@/lib/constants";
import { initials } from "@/lib/utils";
import { PageHeader, EmptyState, ErrorState, LoadingRows, ConfirmDialog } from "@/components/shared/PageComponents";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function FindTeammatesPage() {
  const { profile } = useAuth();
  const { data, isLoading, error, refetch } = useFindTeammates();
  const { data: myTeam } = useMyTeam();
  const qc = useQueryClient();
  const [requestMessage, setRequestMessage] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");

  const hasTeam = !!myTeam?.team;

  const recommendations = useMemo(() => {
    if (!profile || !data) return [];
    const individuals = data.individuals
      .flatMap((entry) => entry.members.filter((m) => m.status === "active" && m.profile))
      .map((m) => ({
        id: m.student_id,
        name: m.profile!.full_name_en,
        preferredLanguage: m.profile!.preferred_language,
        availability: m.profile!.availability ?? [],
        experience: m.profile!.programming_experience,
        academicYear: m.profile!.academic_year,
      }));
    return rankMatches(
      {
        id: profile.id,
        name: profile.full_name_en,
        preferredLanguage: profile.preferred_language,
        availability: profile.availability ?? [],
        experience: profile.programming_experience,
        academicYear: profile.academic_year,
      },
      individuals,
      6,
    );
  }, [profile, data]);

  const teamSuggestions = useMemo(() => {
    if (!data || !profile) return [];
    return suggestTeams(
      {
        id: profile.id,
        name: profile.full_name_en,
        preferredLanguage: profile.preferred_language,
        availability: profile.availability ?? [],
        experience: profile.programming_experience,
      },
      data.teams
        .filter(() => !hasTeam)
        .map((t) => ({
          id: t.team.id,
          name: t.team.name,
          preferredLanguages: t.team.preferred_languages,
          availability: t.team.availability,
          missing: t.missing,
        })),
      6,
    );
  }, [data, profile, hasTeam]);

  const requestJoin = async (teamId: string) => {
    const { error: e } = await supabase.rpc("request_to_join", {
      p_team_id: teamId,
      p_message: requestMessage[teamId] || null,
    });
    if (e) return toast.error(errMsg(e));
    toast.success("Join request sent to the team leader");
    void qc.invalidateQueries({ queryKey: ["my-team"] });
    setRequestMessage((m) => ({ ...m, [teamId]: "" }));
  };

  if (isLoading) {
    return (
      <>
        <PageHeader title="Find Teammates" />
        <LoadingRows />
      </>
    );
  }
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const teams = (data?.teams ?? []).filter((t) =>
    t.team.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Find Teammates"
        description="Browse incomplete teams looking for members and students seeking teammates."
      />

      {!hasTeam && recommendations.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Suggested teammates
            </CardTitle>
            <CardDescription>
              Based on language, availability and experience overlap — a transparent, rules-based
              score.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {recommendations.map((r) => (
              <div key={r.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <Badge variant="info">{r.match.score}% match</Badge>
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {r.match.reasons.slice(0, 3).map((reason) => (
                    <li key={reason} className="text-xs text-muted-foreground">• {reason}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!hasTeam && teamSuggestions.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Teams that fit you
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {teamSuggestions.map(({ team, score, reasons }) => (
              <div key={team.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{team.name}</p>
                  <Badge variant={score > 60 ? "success" : "secondary"}>{score}% fit</Badge>
                </div>
                {reasons.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">• {reasons[0]}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="teams">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="teams">Incomplete teams ({teams.length})</TabsTrigger>
            <TabsTrigger value="individuals">
              Students seeking teammates ({data?.individuals.length ?? 0})
            </TabsTrigger>
          </TabsList>
          <Input
            className="w-full sm:w-64"
            placeholder="Filter teams by name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <TabsContent value="teams" className="space-y-3">
          {teams.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No incomplete teams right now"
              description="All registered teams are complete. Register individually so teams can find you."
              action={
                !hasTeam && (
                  <Button asChild variant="outline">
                    <Link to="/team">Register individually</Link>
                  </Button>
                )
              }
            />
          ) : (
            teams.map(({ team, members: teamMembers, missing }) => (
              <Card key={team.id}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {team.name}
                        <Badge variant={TEAM_STATUS_VARIANT[team.status]}>
                          {TEAM_STATUS_LABELS[team.status]}
                        </Badge>
                        <Badge variant="success">{missing} open slot{missing > 1 ? "s" : ""}</Badge>
                      </p>
                      {team.description && (
                        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{team.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {teamMembers.map((m) => (
                          <span key={m.id} className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">
                            <Avatar className="h-4 w-4">
                              {m.profile?.avatar_url ? <AvatarImage src={m.profile.avatar_url} /> : null}
                              <AvatarFallback className="text-[8px]">
                                {initials(m.profile?.full_name_en ?? "?")}
                              </AvatarFallback>
                            </Avatar>
                            {m.profile?.full_name_en}
                          </span>
                        ))}
                      </div>
                      {(team.preferred_languages.length > 0 || team.availability.length > 0) && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {team.preferred_languages.join(", ")}
                          {team.availability.length > 0 &&
                            ` · ${team.availability.slice(0, 3).join(", ").replace(/-/g, " ")}`}
                        </p>
                      )}
                    </div>
                    {!hasTeam && missing > 0 && (
                      <div className="w-full max-w-64 space-y-2">
                        <Input
                          placeholder="Optional message to the leader…"
                          value={requestMessage[team.id] ?? ""}
                          onChange={(e) => setRequestMessage((m) => ({ ...m, [team.id]: e.target.value }))}
                        />
                        <Button size="sm" className="w-full" onClick={() => void requestJoin(team.id)}>
                          <UserPlus /> Request to join
                        </Button>
                      </div>
                    )}
                    {hasTeam && (
                      <p className="max-w-56 text-xs text-muted-foreground">
                        You already belong to a team.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="individuals" className="space-y-3">
          {(data?.individuals.length ?? 0) === 0 ? (
            <EmptyState
              icon={Users}
              title="No individual registrations yet"
              description="Students who register individually will appear here."
            />
          ) : (
            data!.individuals.map(({ team, members: teamMembers }) => {
              const student = teamMembers.find((m) => m.status === "active")?.profile;
              return (
                <Card key={team.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <Avatar>
                      {student?.avatar_url ? <AvatarImage src={student.avatar_url} /> : null}
                      <AvatarFallback>{initials(student?.full_name_en ?? "?")}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{student?.full_name_en ?? "Unknown"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[student?.academic_year, student?.preferred_language, student?.programming_experience]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {!hasTeam && myTeam?.team != null && myTeam.team.leader_id === profile?.id && myTeam.team.status === "looking_for_members" && (
                      <ConfirmDialog
                        trigger={<Button size="sm" variant="outline"><UserPlus /> Invite to my team</Button>}
                        title={`Invite ${student?.full_name_en}?`}
                        description="They will receive a notification and can accept or decline."
                        actionLabel="Send invite"
                        onConfirm={() => {
                          const leaderTeam = myTeam?.team;
                          if (!leaderTeam) return;
                          void supabase
                            .rpc("invite_member", { p_team_id: leaderTeam.id, p_invitee_id: team.created_by })
                            .then(({ error: e }) => {
                              if (e) toast.error(errMsg(e));
                              else toast.success("Invitation sent");
                            });
                        }}
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
