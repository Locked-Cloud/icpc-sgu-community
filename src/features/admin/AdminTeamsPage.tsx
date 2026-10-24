import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Check, Lock, Unlock, X } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { TEAM_STATUS_LABELS, TEAM_STATUS_VARIANT } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Team, TeamMember } from "@/types";

export default function AdminTeamsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-teams", search, status],
    queryFn: async () => {
      let query = supabase.from("teams").select("*").order("created_at", { ascending: false });
      if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query.limit(100);
      if (error) throw error;
      const teams = (data ?? []) as Team[];

      const { data: members } = await supabase
        .from("team_members")
        .select("*")
        .in("team_id", teams.map((t) => t.id))
        .in("status", ["active", "pending_confirmation"]);
      const memberRows = (members ?? []) as TeamMember[];
      const profiles = await fetchProfiles(memberRows.map((m) => m.student_id));

      return teams.map((t) => ({
        team: t,
        members: memberRows
          .filter((m) => m.team_id === t.id)
          .map((m) => ({ ...m, profile: profiles[m.student_id] })),
      }));
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin-teams"] });
  };

  const decide = useMutation({
    mutationFn: async ({ teamId, approve, reason }: { teamId: string; approve: boolean; reason?: string }) => {
      const { error } = await supabase.rpc("admin_team_decision", {
        p_team_id: teamId,
        p_approve: approve,
        p_reason: reason ?? null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => { toast.success("Decision recorded"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: async (teamId: string) => {
      const { error } = await supabase.rpc("archive_team", { p_team_id: teamId });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => { toast.success("Team archived"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const lock = useMutation({
    mutationFn: async ({ teamId, locked }: { teamId: string; locked: boolean }) => {
      const { error } = await supabase.rpc("set_team_membership_lock", { p_team_id: teamId, p_locked: locked });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => { invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async ({ teamId, studentId }: { teamId: string; studentId: string }) => {
      const { error } = await supabase.rpc("remove_team_member", { p_team_id: teamId, p_student_id: studentId });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => { toast.success("Member removed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Teams" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader title="Teams" description="Review, approve and manage team registrations." />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="w-full sm:w-72" placeholder="Search by team name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(TEAM_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {(data ?? []).map(({ team, members }) => (
          <Card key={team.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{team.name}</p>
                <Badge variant={TEAM_STATUS_VARIANT[team.status]}>{TEAM_STATUS_LABELS[team.status]}</Badge>
                <Badge variant="outline">{team.registration_type}</Badge>
                {team.locked && <Badge variant="destructive">locked</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">created {formatDate(team.created_at)}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {members.map((m) => (
                  <span key={m.id} className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">
                    {m.profile?.full_name_en ?? "?"}
                    {team.leader_id === m.student_id && <Badge variant="info" className="h-4 px-1.5 text-[10px]">lead</Badge>}
                    {m.status === "pending_confirmation" && <span className="text-warning">(pending)</span>}
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove member"
                      onClick={() => removeMember.mutate({ teamId: team.id, studentId: m.student_id })}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <span className="text-xs text-muted-foreground">{team.capacity - members.length} slot(s) free</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {team.status === "pending_admin_review" && (
                  <>
                    <Button size="sm" onClick={() => decide.mutate({ teamId: team.id, approve: true })}><Check /> Approve</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const reason = window.prompt("Rejection reason (optional):") ?? undefined;
                        decide.mutate({ teamId: team.id, approve: false, reason });
                      }}
                    >
                      <X /> Reject
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => lock.mutate({ teamId: team.id, locked: !team.locked })}>
                  {team.locked ? <Unlock /> : <Lock />} {team.locked ? "Unlock membership" : "Lock membership"}
                </Button>
                {!["archived"].includes(team.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => { if (window.confirm("Archive this team?")) archive.mutate(team.id); }}
                  >
                    <Archive /> Archive
                  </Button>
                )}
              </div>
              {team.rejection_reason && <p className="mt-2 text-xs text-destructive">Rejection: {team.rejection_reason}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
