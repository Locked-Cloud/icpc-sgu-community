import { useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, UserPlus, Users, UserX, Crown, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { useMyTeam, useTeamMutations, useStudentSearch } from "@/features/teams/api";
import { MEMBER_STATUS_LABELS, TEAM_STATUS_LABELS, TEAM_STATUS_VARIANT } from "@/lib/constants";
import { initials } from "@/lib/utils";
import { PageHeader, EmptyState, ErrorState, LoadingRows, ConfirmDialog } from "@/components/shared/PageComponents";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import TeamRegistrationWizard from "@/features/teams/TeamRegistrationWizard";
import type { ProfilePublic } from "@/types";

export default function MyTeamPage() {
  const { profile } = useAuth();
  const { data, isLoading, error, refetch } = useMyTeam();
  const mut = useTeamMutations();
  const qc = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const { data: inviteResults } = useStudentSearch(inviteSearch);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["my-team"] });
    void qc.invalidateQueries({ queryKey: ["find-teammates"] });
  };

  if (isLoading) {
    return (
      <>
        <PageHeader title="My Team" />
        <LoadingRows />
      </>
    );
  }
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const { team, members, myInvitations, joinRequests } = data ?? {
    team: null,
    members: [],
    myInvitations: [],
    joinRequests: [],
  };

  const myMembership = members.find((m) => m.student_id === profile?.id);
  const isLeader = team?.leader_id === profile?.id;
  const activeCount = members.filter((m) => m.status === "active").length;
  const missing = team ? Math.max(team.capacity - members.length, 0) : 0;
  const canManage = isLeader;

  const respondInvite = async (invitationId: string, accept: boolean) => {
    const { error: e } = await supabase.rpc("respond_to_invitation", {
      p_invitation_id: invitationId,
      p_accept: accept,
    });
    if (e) return toast.error(errMsg(e));
    toast.success(accept ? "You joined the team!" : "Invitation declined");
    invalidate();
  };

  const invite = async (studentId: string) => {
    const { error: e } = await supabase.rpc("invite_member", {
      p_team_id: team!.id,
      p_invitee_id: studentId,
    });
    if (e) return toast.error(errMsg(e));
    toast.success("Invitation sent");
    setInviteSearch("");
    invalidate();
  };

  // ── No team yet ────────────────────────────────────────────────────────────
  if (!team) {
    return (
      <>
        <PageHeader
          title="My Team"
          description="Register a team, or browse teams looking for members."
          actions={
            <Button onClick={() => setWizardOpen(true)}>
              <UserPlus /> Register a team
            </Button>
          }
        />

        {myInvitations.length > 0 && (
          <div className="mb-6 space-y-3">
            {myInvitations.map((inv) => (
              <Card key={inv.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium">Invitation to join “{inv.team?.name ?? "a team"}”</p>
                    {inv.message && <p className="text-xs text-muted-foreground">{inv.message}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void respondInvite(inv.id, true)}>Accept</Button>
                    <Button size="sm" variant="outline" onClick={() => void respondInvite(inv.id, false)}>Decline</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <EmptyState
          icon={Users}
          title={myInvitations.length > 0 ? "Or register your own team" : "You are not part of a team yet"}
          description="Official teams have exactly 3 members. Register a complete team, start an incomplete one, or register individually and find teammates."
          action={
            <div className="flex gap-2">
              <Button onClick={() => setWizardOpen(true)}>
                <UserPlus /> Register a team
              </Button>
              <Button variant="outline" asChild>
                <Link to="/find-teammates">Find teammates</Link>
              </Button>
            </div>
          }
        />
        <TeamRegistrationWizard open={wizardOpen} onOpenChange={setWizardOpen} />
      </>
    );
  }

  // ── Has a team ─────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title={team.name}
        description={team.description ?? undefined}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/team/chat">
                <MessageSquare /> Team chat
              </Link>
            </Button>
            <ConfirmDialog
              trigger={<Button variant="outline"><LogOut /> Leave team</Button>}
              title="Leave this team?"
              description={
                isLeader
                  ? "You are the leader — the earliest remaining member will become the new leader. If nobody remains, the team is cancelled."
                  : "You will lose access to the team chat. You can join or create another team afterwards."
              }
              actionLabel="Leave team"
              destructive
              onConfirm={() => mut.leaveTeam.mutate({})}
            />
          </>
        }
      />

      {myMembership?.status === "pending_confirmation" && (
        <Card className="mb-6 border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">
              You were added to this team as a proposed member. Confirm your participation to continue.
            </p>
            <Button onClick={() => mut.confirmMembership.mutate({ p_team_id: team.id })}>
              Confirm participation
            </Button>
          </CardContent>
        </Card>
      )}

      {team.status === "pending_admin_review" && (
        <Card className="mb-6 border-warning/40 bg-warning/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            All members confirmed. The team is waiting for administrator approval.
          </CardContent>
        </Card>
      )}
      {team.status === "rejected" && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            This registration was rejected. {team.rejection_reason && `Reason: ${team.rejection_reason}`}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Members</CardTitle>
                <CardDescription>
                  {activeCount} active · {missing > 0 ? `${missing} slot${missing > 1 ? "s" : ""} open` : "team is full"}
                </CardDescription>
              </div>
              <Badge variant={TEAM_STATUS_VARIANT[team.status]}>{TEAM_STATUS_LABELS[team.status]}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <Avatar>
                    {m.profile?.avatar_url ? <AvatarImage src={m.profile.avatar_url} /> : null}
                    <AvatarFallback>{initials(m.profile?.full_name_en ?? "?")}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {m.profile?.full_name_en ?? "Unknown"}
                      {team.leader_id === m.student_id && (
                        <Badge variant="info" className="gap-1"><Crown className="h-3 w-3" /> Leader</Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.profile?.academic_year ?? ""} · {m.profile?.preferred_language ?? ""}
                      {m.status === "pending_confirmation" && ` · ${MEMBER_STATUS_LABELS[m.status]}`}
                    </p>
                  </div>
                  {canManage && m.student_id !== profile?.id && m.status === "active" && (
                    <div className="flex gap-1">
                      {team.leader_id !== m.student_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => mut.setLeader.mutate({ p_team_id: team.id, p_new_leader_id: m.student_id })}
                        >
                          <Crown /> Make leader
                        </Button>
                      )}
                      <ConfirmDialog
                        trigger={<Button size="sm" variant="ghost" className="text-destructive"><UserX /></Button>}
                        title={`Remove ${m.profile?.full_name_en}?`}
                        description="They will immediately lose access to the team chat."
                        actionLabel="Remove"
                        destructive
                        onConfirm={() => mut.removeMember.mutate({ p_team_id: team.id, p_student_id: m.student_id })}
                      />
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {canManage && joinRequests.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Join requests</CardTitle>
                <CardDescription>Students asking to join your team</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {joinRequests.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <Avatar>
                      {r.student?.avatar_url ? <AvatarImage src={r.student.avatar_url} /> : null}
                      <AvatarFallback>{initials(r.student?.full_name_en ?? "?")}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.student?.full_name_en ?? "Unknown"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.student?.academic_year ?? ""} · {r.student?.preferred_language ?? ""}
                      </p>
                      {r.message && <p className="mt-1 text-xs italic text-muted-foreground">“{r.message}”</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={missing === 0}
                        onClick={() => mut.respondJoinRequest.mutate({ p_request_id: r.id, p_accept: true })}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => mut.respondJoinRequest.mutate({ p_request_id: r.id, p_accept: false })}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {missing > 0 && canManage && (
            <Card>
              <CardHeader>
                <CardTitle>Invite a member</CardTitle>
                <CardDescription>
                  {missing} open slot{missing > 1 ? "s" : ""} — search for registered students.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  placeholder="Search by name…"
                />
                {inviteResults
                  ?.filter((r: ProfilePublic) => !members.some((m) => m.student_id === r.id))
                  .map((r: ProfilePublic) => (
                    <button
                      key={r.id}
                      className="flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm hover:bg-accent"
                      onClick={() => void invite(r.id)}
                    >
                      <Avatar className="h-6 w-6">
                        {r.avatar_url ? <AvatarImage src={r.avatar_url} /> : null}
                        <AvatarFallback className="text-[10px]">{initials(r.full_name_en)}</AvatarFallback>
                      </Avatar>
                      <span className="flex-1 truncate">{r.full_name_en}</span>
                      <span className="text-xs text-primary">Invite</span>
                    </button>
                  ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Team preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Preferred languages</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {team.preferred_languages.length > 0 ? (
                    team.preferred_languages.map((l) => <Badge key={l} variant="secondary">{l}</Badge>)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Availability</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {team.availability.length > 0 ? (
                    team.availability.map((a) => <Badge key={a} variant="secondary">{a.replace("-", " ")}</Badge>)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <TeamRegistrationWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </>
  );
}
