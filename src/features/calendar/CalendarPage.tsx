import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { cn, formatTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Assignment, MentorBooking, TrainingSession, VirtualContest } from "@/types";

interface CalendarEvent {
  date: string; // YYYY-MM-DD
  time: string;
  title: string;
  kind: "session" | "deadline" | "contest" | "mentorship";
  location?: string;
  url?: string;
}

export default function CalendarPage() {
  const { profile } = useAuth();
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, error } = useQuery({
    queryKey: ["calendar", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const [sessions, assignments, contests, bookings] = await Promise.all([
        supabase.from("training_sessions").select("*").gt("starts_at", new Date(Date.now() - 60 * 864e5).toISOString()),
        supabase.from("assignments").select("*").eq("status", "published").not("due_at", "is", null),
        supabase.from("virtual_contests").select("*").neq("status", "draft"),
        supabase.from("mentor_bookings").select("*").eq("student_id", profile!.id).in("status", ["pending", "confirmed"]),
      ]);

      const events: CalendarEvent[] = [];
      for (const s of (sessions.data ?? []) as TrainingSession[]) {
        events.push({
          date: s.starts_at.slice(0, 10),
          time: formatTime(s.starts_at),
          title: s.title,
          kind: "session",
          location: s.location ?? s.meeting_url ?? undefined,
        });
      }
      for (const a of (assignments.data ?? []) as Assignment[]) {
        events.push({
          date: a.due_at!.slice(0, 10),
          time: formatTime(a.due_at!),
          title: `Due: ${a.title}`,
          kind: "deadline",
        });
      }
      for (const c of (contests.data ?? []) as VirtualContest[]) {
        events.push({ date: c.starts_at.slice(0, 10), time: formatTime(c.starts_at), title: c.title, kind: "contest" });
      }
      for (const b of (bookings.data ?? []) as MentorBooking[]) {
        events.push({ date: b.starts_at.slice(0, 10), time: formatTime(b.starts_at), title: `Mentorship: ${b.topic}`, kind: "mentorship" });
      }
      return events;
    },
  });

  const grid = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const year = base.getFullYear();
    const month = base.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return { cells, label: base.toLocaleString("en-GB", { month: "long", year: "numeric" }) };
  }, [monthOffset]);

  if (isLoading) return (
    <>
      <PageHeader title="Calendar" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} />;

  const events = data ?? [];
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }
  const dayEvents = byDate.get(selected) ?? [];

  const kindColor: Record<CalendarEvent["kind"], string> = {
    session: "bg-primary",
    deadline: "bg-destructive",
    contest: "bg-violet-500",
    mentorship: "bg-success",
  };

  return (
    <>
      <PageHeader title="Calendar" description="Sessions, deadlines, contests and your mentorship bookings in one place (UTC times)." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-medium">{grid.label}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthOffset(monthOffset - 1)}>
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthOffset(monthOffset + 1)}>
                  <ChevronRight />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <div key={d} className="py-1">{d}</div>)}
              {grid.cells.map((date, i) => {
                if (!date) return <div key={`empty-${i}`} />;
                const dayEvents = byDate.get(date) ?? [];
                const isToday = date === new Date().toISOString().slice(0, 10);
                return (
                  <button
                    key={date}
                    onClick={() => setSelected(date)}
                    className={cn(
                      "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md text-sm transition-colors hover:bg-accent",
                      selected === date && "bg-primary/15 ring-1 ring-primary",
                      isToday && "font-bold text-primary",
                    )}
                  >
                    {Number(date.slice(-2))}
                    <span className="flex gap-0.5">
                      {dayEvents.slice(0, 3).map((e, j) => (
                        <span key={j} className={cn("h-1.5 w-1.5 rounded-full", kindColor[e.kind])} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="mb-3 font-medium">
              <CalendarDays className="mr-1 inline h-4 w-4 text-primary" />
              {new Date(selected + "T12:00:00Z").toLocaleDateString("en-GB", {
                weekday: "long", day: "numeric", month: "long",
              })}
            </p>
            {dayEvents.length === 0 ? (
              <EmptyState title="Nothing scheduled" description="No events on this day." />
            ) : (
              <div className="space-y-2">
                {dayEvents.map((e, i) => (
                  <div key={i} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{e.title}</p>
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", kindColor[e.kind])} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {e.time}
                      {e.location && ` · ${e.location}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
