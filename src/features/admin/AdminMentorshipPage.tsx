import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, Check, Plus, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { DAY_NAMES } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Mentor, MentorAvailabilityRule, MentorBooking, ProfilePublic } from "@/types";

export default function AdminMentorshipPage() {
  const { profile: me } = useAuth();
  const qc = useQueryClient();
  const [mentorForRule, setMentorForRule] = useState<Mentor | null>(null);
  const [rule, setRule] = useState({
    day_of_week: "6", start_time: "16:00", end_time: "20:00", duration_minutes: "30",
    buffer_minutes: "10", max_per_day: "4", min_notice_hours: "12",
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-mentorship"],
    queryFn: async () => {
      const [{ data: mentors }, { data: bookings }] = await Promise.all([
        supabase.from("mentors").select("*"),
        supabase.from("mentor_bookings").select("*").in("status", ["pending", "confirmed", "completed"]).order("starts_at", { ascending: false }).limit(100),
      ]);
      const mentorRows = (mentors ?? []) as Mentor[];
      const bookingRows = (bookings ?? []) as MentorBooking[];
      const profiles = await fetchProfiles([
        ...mentorRows.map((m) => m.profile_id),
        ...bookingRows.map((b) => b.student_id),
      ]);
      return {
        mentors: mentorRows.map((m) => ({ ...m, profile: profiles[m.profile_id] })),
        bookings: bookingRows.map((b) => ({ ...b, student: profiles[b.student_id], mentor: mentorRows.find((m) => m.id === b.mentor_id) })),
      };
    },
  });

  const { data: rules } = useQuery({
    queryKey: ["mentor-rules", mentorForRule?.id],
    enabled: !!mentorForRule,
    queryFn: async () => {
      const { data } = await supabase
        .from("mentor_availability_rules")
        .select("*")
        .eq("mentor_id", mentorForRule!.id);
      return (data ?? []) as MentorAvailabilityRule[];
    },
  });

  const createSelf = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("mentors").insert({
        profile_id: me!.id,
        headline: `${me!.full_name_en} — Level 1 mentor`,
        default_duration_minutes: 30,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("You are now listed as a mentor");
      void qc.invalidateQueries({ queryKey: ["admin-mentorship"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addRule = useMutation({
    mutationFn: async () => {
      if (!mentorForRule) return;
      const { error } = await supabase.from("mentor_availability_rules").insert({
        mentor_id: mentorForRule.id,
        day_of_week: Number(rule.day_of_week),
        start_time: rule.start_time,
        end_time: rule.end_time,
        duration_minutes: Number(rule.duration_minutes),
        buffer_minutes: Number(rule.buffer_minutes),
        max_per_day: Number(rule.max_per_day),
        min_notice_hours: Number(rule.min_notice_hours),
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Availability rule added");
      void qc.invalidateQueries({ queryKey: ["mentor-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const respond = useMutation({
    mutationFn: async ({ bookingId, action, meetingUrl }: { bookingId: string; action: string; meetingUrl?: string }) => {
      const { error } = await supabase.rpc("respond_to_booking", {
        p_booking_id: bookingId,
        p_action: action,
        p_meeting_url: meetingUrl ?? null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Booking updated — student notified");
      void qc.invalidateQueries({ queryKey: ["admin-mentorship"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const complete = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("respond_to_booking", {
        p_booking_id: bookingId,
        p_action: "complete",
        p_notes: null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Session completed");
      void qc.invalidateQueries({ queryKey: ["admin-mentorship"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Mentorship Management" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const { mentors, bookings } = data ?? { mentors: [], bookings: [] };
  const pending = bookings.filter((b) => b.status === "pending");
  const upcoming = bookings.filter((b) => b.status === "confirmed");

  return (
    <>
      <PageHeader
        title="Mentorship Management"
        description="Mentor profiles, availability rules and session bookings."
        actions={
          !mentors.some((m) => m.profile_id === me?.id) && (
            <Button onClick={() => createSelf.mutate()}><Plus /> Become a mentor</Button>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Mentors</p><p className="text-xl font-semibold">{mentors.length}</p></CardContent></Card>
        <Card className={pending.length > 0 ? "border-warning/40" : undefined}>
          <CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Pending requests</p><p className="text-xl font-semibold">{pending.length}</p></CardContent>
        </Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Confirmed upcoming</p><p className="text-xl font-semibold">{upcoming.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Completed</p><p className="text-xl font-semibold">{bookings.filter((b) => b.status === "completed").length}</p></CardContent></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mentors</CardTitle>
            <CardDescription>Administrators act as mentors in the initial release.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {mentors.length === 0 ? (
              <EmptyState title="No mentors yet" description="Click “Become a mentor” to offer sessions." />
            ) : (
              mentors.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{(m.profile as ProfilePublic | undefined)?.full_name_en ?? "Mentor"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.headline ?? "—"} · {m.default_duration_minutes} min sessions
                    </p>
                  </div>
                  <Badge variant={m.active ? "success" : "muted"}>{m.active ? "active" : "inactive"}</Badge>
                  <Button size="sm" variant="outline" onClick={() => setMentorForRule(m)}>
                    <CalendarPlus /> Availability
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Bookings</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {bookings.length === 0 ? (
              <EmptyState title="No bookings yet" />
            ) : (
              bookings.slice(0, 15).map((b) => (
                <div key={b.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{b.topic}</p>
                    <Badge variant={b.status === "confirmed" ? "success" : b.status === "pending" ? "warning" : "secondary"}>
                      {b.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {(b.student as ProfilePublic | undefined)?.full_name_en ?? "?"} · {formatDateTime(b.starts_at)} (UTC)
                  </p>
                  {b.description && <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">{b.description}</p>}
                  {b.status === "pending" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const url = window.prompt("Meeting URL (optional):") ?? undefined;
                          respond.mutate({ bookingId: b.id, action: "confirm", meetingUrl: url });
                        }}
                      >
                        <Check /> Confirm
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => respond.mutate({ bookingId: b.id, action: "reject" })}>
                        <X /> Reject
                      </Button>
                    </div>
                  )}
                  {b.status === "confirmed" && new Date(b.starts_at) < new Date() && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => complete.mutate(b.id)}>Mark completed</Button>
                      <Button size="sm" variant="ghost" onClick={() => respond.mutate({ bookingId: b.id, action: "no_show" })}>No-show</Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Availability rules — {(mentorForRule?.profile as ProfilePublic | undefined)?.full_name_en ?? "select a mentor"}</CardTitle>
          <CardDescription>Slots are generated from these weekly rules (times in UTC).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {mentorForRule && (
            <>
              {(rules ?? []).map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <span className="w-24">{DAY_NAMES[r.day_of_week]}</span>
                  <span className="flex-1">{r.start_time}–{r.end_time} · {r.duration_minutes}min · buffer {r.buffer_minutes}min · max {r.max_per_day}/day</span>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      const { error } = await supabase.from("mentor_availability_rules").delete().eq("id", r.id);
                      if (error) toast.error(errMsg(error));
                      else void qc.invalidateQueries({ queryKey: ["mentor-rules"] });
                    }}
                  >×</button>
                </div>
              ))}
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Day</Label>
                  <Select value={rule.day_of_week} onValueChange={(v) => setRule({ ...rule, day_of_week: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAY_NAMES.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Start</Label>
                  <Input type="time" className="h-8 text-xs" value={rule.start_time} onChange={(e) => setRule({ ...rule, start_time: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">End</Label>
                  <Input type="time" className="h-8 text-xs" value={rule.end_time} onChange={(e) => setRule({ ...rule, end_time: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Duration (min)</Label>
                  <Input type="number" className="h-8 text-xs" value={rule.duration_minutes} onChange={(e) => setRule({ ...rule, duration_minutes: e.target.value })} />
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => addRule.mutate()}>
                <Plus /> Add rule
              </Button>
            </>
          )}
          {!mentorForRule && <p className="text-sm text-muted-foreground">Select a mentor above to manage availability.</p>}
        </CardContent>
      </Card>
    </>
  );
}
