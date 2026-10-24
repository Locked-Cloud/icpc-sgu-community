import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, errMsg } from "@/lib/supabase";
import { toast } from "sonner";
import type { ProfilePublic, Team, TeamInvitation, TeamJoinRequest, TeamMember } from "@/types";

/** Fetches public profiles for a list of ids and returns an id → profile map. */
export async function fetchProfiles(ids: string[]): Promise<Record<string, ProfilePublic>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return {};
  const { data, error } = await supabase.from("profiles_public").select("*").in("id", unique);
  if (error) throw error;
  const map: Record<string, ProfilePublic> = {};
  for (const p of (data ?? []) as ProfilePublic[]) map[p.id] = p;
  return map;
}

export interface MyTeamData {
  team: Team | null;
  members: (TeamMember & { profile?: ProfilePublic })[];
  myInvitations: TeamInvitation[];
  joinRequests: TeamJoinRequest[];
}

export function useMyTeam() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["my-team"],
    queryFn: async (): Promise<MyTeamData> => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
      const [{ data: memberRows }, { data: invitations }] = await Promise.all([
        supabase
          .from("team_members")
          .select("*")
          .eq("student_id", userId)
          .in("status", ["active", "pending_confirmation"])
          .order("created_at"),
        supabase
          .from("team_invitations")
          .select("*, team:teams(id, name, status)")
          .eq("invitee_id", userId)
          .eq("status", "pending"),
      ]);

      const rows = (memberRows ?? []) as TeamMember[];
      const teamIds = rows.map((m) => m.team_id);

      let team: Team | null = null;
      let members: (TeamMember & { profile?: ProfilePublic })[] = [];
      let joinRequests: TeamJoinRequest[] = [];

      if (teamIds.length > 0) {
        const { data: teams } = await supabase.from("teams").select("*").in("id", teamIds);
        team = ((teams ?? []) as Team[])[0] ?? null;
        if (team) {
          const [{ data: memberRows2 }, { data: requests }] = await Promise.all([
            supabase
              .from("team_members")
              .select("*")
              .eq("team_id", team.id)
              .in("status", ["active", "pending_confirmation"])
              .order("created_at"),
            supabase
              .from("team_join_requests")
              .select("*")
              .eq("team_id", team.id)
              .eq("status", "pending"),
          ]);
          const mRows = (memberRows2 ?? []) as TeamMember[];
          const reqRows = (requests ?? []) as TeamJoinRequest[];
          const profiles = await fetchProfiles([
            ...mRows.map((r) => r.student_id),
            ...reqRows.map((r) => r.student_id),
          ]);
          members = mRows.map((m) => ({ ...m, profile: profiles[m.student_id] }));
          joinRequests = reqRows.map((r) => ({ ...r, student: profiles[r.student_id] }));
        }
      }

      return {
        team,
        members,
        myInvitations: ((invitations ?? []) as unknown as TeamInvitation[]).filter(
          (i) => i.status === "pending",
        ),
        joinRequests,
      };
    },
  });

  return { data, isLoading, error, refetch };
}

export function useTeamMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["my-team"] });
    void qc.invalidateQueries({ queryKey: ["find-teammates"] });
    void qc.invalidateQueries({ queryKey: ["team"] });
  };

  const wrap = <TArgs,>(fn: (args: TArgs) => unknown) =>
    useMutation({
      mutationFn: async (args: TArgs) => {
        const { error } = (await fn(args)) as { error: { message: string } | null };
        if (error) throw new Error(errMsg(error));
      },
      onSuccess: () => {
        invalidate();
        toast.success("Done");
      },
      onError: (e: Error) => toast.error(e.message),
    });

  return {
    createTeam: wrap((v: {
      p_name: string;
      p_registration_type: string;
      p_member_ids?: string[];
      p_leader_id?: string;
      p_description?: string;
      p_preferred_languages?: string[];
      p_experience_preference?: string;
      p_availability?: string[];
    }) => supabase.rpc("create_team", v)),

    confirmMembership: wrap((v: { p_team_id: string }) =>
      supabase.rpc("confirm_team_membership", v)),

    inviteMember: wrap((v: { p_team_id: string; p_invitee_id: string; p_message?: string }) =>
      supabase.rpc("invite_member", v)),

    respondInvitation: wrap((v: { p_invitation_id: string; p_accept: boolean }) =>
      supabase.rpc("respond_to_invitation", v)),

    requestJoin: wrap((v: { p_team_id: string; p_message?: string }) =>
      supabase.rpc("request_to_join", v)),

    respondJoinRequest: wrap((v: { p_request_id: string; p_accept: boolean }) =>
      supabase.rpc("respond_to_join_request", v)),

    leaveTeam: wrap(() => supabase.rpc("leave_team")),

    removeMember: wrap((v: { p_team_id: string; p_student_id: string }) =>
      supabase.rpc("remove_team_member", v)),

    setLeader: wrap((v: { p_team_id: string; p_new_leader_id: string }) =>
      supabase.rpc("set_team_leader", v)),
  };
}

export interface BrowseTeam {
  team: Team;
  members: (TeamMember & { profile?: ProfilePublic })[];
  missing: number;
}

export function useFindTeammates() {
  return useQuery({
    queryKey: ["find-teammates"],
    queryFn: async (): Promise<{ teams: BrowseTeam[]; individuals: BrowseTeam[] }> => {
      const { data: teams, error } = await supabase
        .from("teams")
        .select("*")
        .eq("status", "looking_for_members")
        .neq("locked", true)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const rows = (teams ?? []) as Team[];
      if (rows.length === 0) return { teams: [], individuals: [] };

      const { data: members } = await supabase
        .from("team_members")
        .select("*")
        .in("team_id", rows.map((t) => t.id))
        .in("status", ["active", "pending_confirmation"]);
      const memberRows = (members ?? []) as TeamMember[];
      const profiles = await fetchProfiles(memberRows.map((m) => m.student_id));

      const all = rows.map((team) => {
        const teamMembers = memberRows
          .filter((m) => m.team_id === team.id)
          .map((m) => ({ ...m, profile: profiles[m.student_id] }));
        return {
          team,
          members: teamMembers,
          missing: Math.max(team.capacity - teamMembers.length, 0),
        };
      });

      return {
        teams: all.filter((t) => t.team.registration_type !== "individual"),
        individuals: all.filter((t) => t.team.registration_type === "individual"),
      };
    },
  });
}

/** Searchable list of active students (for inviting members). */
export function useStudentSearch(term: string) {
  return useQuery({
    queryKey: ["student-search", term],
    enabled: term.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles_public")
        .select("*")
        .ilike("full_name_en", `%${term.trim()}%`)
        .limit(8);
      if (error) throw error;
      return (data ?? []) as ProfilePublic[];
    },
    staleTime: 60_000,
  });
}
