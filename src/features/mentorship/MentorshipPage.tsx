import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarCheck, GraduationCap, Video } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { formatDateTime, initials } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Mentor, MentorBooking, MentorSlot, ProfilePublic } from "@/types";

export default function MentorshipPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [bookingMentor, setBookingMentor] = useState<Mentor | null>(null);
  const [slots, setSlots] = useState<MentorSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<MentorSlot | null>(null);
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["mentorship", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: mentors, error: mErr } = await supabase
        .from("mentors")
        .select("*")
        .eq("active", true);
      if (mErr) throw mErr;

      const { data: bookings } = await supabase
        .from("mentor_bookings")
        .select("*")
        .eq("student_id", profile!.id)
        .in("status", ["pending", "confirmed", "completed"])
        .order("starts_at");

      const mentorProfiles = await fetchProfiles((mentors ?? []).map((m: Mentor) => m.profile_id));
      return {
        mentors: ((mentors ?? []) as Mentor[]).map((m) => ({
          ...m,
          profile: mentorProfiles[m.profile_id],
        })),
        bookings: (bookings ?? []) as MentorBooking[],
      };
    },
  });

  const openBooking = async (mentor: Mentor) => {
    setBookingMentor(mentor);
    setSelectedSlot(null);
    const { data, error } = await supabase.rpc("mentor_available_slots", {
      p_mentor_id: mentor.id,
      p_days: 14,
    });
    if (error) return toast.error(errMsg(error));
    setSlots((data ?? []) as MentorSlot[]);
  };

  const book = useMutation({
    mutationFn: async () => {
      if (!selectedSlot || !bookingMentor) throw new Error("Select a time slot first");
      const { error } = await supabase.rpc("book_mentor_slot", {
        p_mentor_id: bookingMentor.id,
        p_starts_at: selectedSlot.starts_at,
        p_topic: topic,
        p_description: description || null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Session requested — you will be notified once confirmed");
      setBookingMentor(null);
      setTopic("");
      setDescription("");
      void qc.invalidateQueries({ queryKey: ["mentorship"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc("student_cancel_booking", { p_booking_id: bookingId });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Booking cancelled");
      void qc.invalidateQueries({ queryKey: ["mentorship"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Mentorship" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const { mentors, bookings } = data ?? { mentors: [], bookings: [] };

  return (
    <>
      <PageHeader
        title="Mentorship & Office Hours"
        description="Book a help session with a mentor to work through topics or problems."
      />

      {bookings.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-4 w-4 text-primary" /> My sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{b.topic}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(b.starts_at)} (UTC)</p>
                  {b.meeting_url && (
                    <a href={b.meeting_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <Video className="h-3 w-3" /> Meeting link
                    </a>
                  )}
                </div>
                <Badge variant={b.status === "confirmed" ? "success" : b.status === "pending" ? "warning" : "secondary"}>
                  {b.status}
                </Badge>
                {["pending", "confirmed"].includes(b.status) && (
                  <Button variant="outline" size="sm" onClick={() => cancel.mutate(b.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {mentors.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No mentors available yet"
          description="Mentorship sessions will open once mentors publish their availability."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {mentors.map((m) => (
            <Card key={m.id}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <Avatar>
                  {m.profile?.avatar_url ? <AvatarImage src={m.profile.avatar_url} /> : null}
                  <AvatarFallback>{initials(m.profile?.full_name_en ?? "?")}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{(m.profile as ProfilePublic | undefined)?.full_name_en ?? "Mentor"}</CardTitle>
                  <CardDescription className="truncate">{m.headline ?? "Mentor"}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {m.bio && <p className="mb-3 line-clamp-3 text-sm text-muted-foreground">{m.bio}</p>}
                <div className="mb-3 flex flex-wrap gap-1">
                  {m.expertise.map((e) => <Badge key={e} variant="secondary">{e}</Badge>)}
                </div>
                <Button size="sm" className="w-full" onClick={() => void openBooking(m)}>
                  Book a {m.default_duration_minutes}-minute session
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!bookingMentor} onOpenChange={(v) => !v && setBookingMentor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Book with {(bookingMentor?.profile as ProfilePublic | undefined)?.full_name_en ?? "mentor"}</DialogTitle>
            <DialogDescription>
              Pick an available slot (times shown in UTC) and describe your question.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {slots.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No open slots in the next 14 days.</p>
            ) : (
              slots.map((s) => {
                const start = new Date(s.starts_at);
                const label = start.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
                const isSelected = selectedSlot?.starts_at === s.starts_at;
                return (
                  <button
                    key={s.starts_at}
                    onClick={() => setSelectedSlot(s)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      isSelected ? "border-primary bg-primary/10" : "hover:bg-accent"
                    }`}
                  >
                    {label} · {s.duration_minutes} min
                  </button>
                );
              })
            )}
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Topic / question *</Label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Stuck on binary search problems" />
            </div>
            <div className="space-y-1.5">
              <Label>Details (optional)</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Problem links, what you tried…" />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => book.mutate()}
              disabled={book.isPending || !selectedSlot || topic.trim().length < 3}
            >
              Request booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
