import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { AttendanceStatus, ProfilePublic } from "@/types";

const STATUSES: AttendanceStatus[] = ["present", "absent", "late", "excused"];

export default function AdminAttendancePage() {
  const qc = useQueryClient();
  const [sessionOpen, setSessionOpen] = useState(false);
  const [session, setSession] = useState({ title: "", description: "", starts_at: "", ends_at: "", location: "", meeting_url: "", week_id: "" });
  const [recording, setRecording] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-attendance"],
    queryFn: async () => {
      const [{ data: sessions }, { data: weeks }] = await Promise.all([
        supabase.from("training_sessions").select("*").order("starts_at", { ascending: false }).limit(50),
        supabase.from("training_weeks").select("id, week_number, title").neq("status", "archived").order("week_number"),
      ]);
      return {
        sessions: (sessions ?? []) as { id: string; title: string; starts_at: string; [k: string]: unknown }[],
        weeks: (weeks ?? []) as { id: string; week_number: number }[],
      };
    },
  });

  const { data: recordData } = useQuery({
    queryKey: ["admin-attendance-record", recording],
    enabled: !!recording,
    queryFn: async () => {
      const [{ data: students }, { data: records }] = await Promise.all([
        supabase.from("profiles_public").select("*").order("full_name_en"),
        supabase.from("attendance_records").select("*").eq("session_id", recording!),
      ]);
      const profiles = (students ?? []) as ProfilePublic[];
      // limit to students only (profiles_public excludes admins)
      const byStudent = new Map(((records ?? []) as { student_id: string; status: AttendanceStatus }[]).map((r) => [r.student_id, r]));
      return { students: profiles, existing: byStudent };
    },
  });

  useEffect(() => {
    if (recordData && recording) {
      const init: typeof marks = {};
      for (const s of recordData.students) {
        const existing = recordData.existing.get(s.id);
        init[s.id] = existing?.status ?? "present";
      }
      setMarks(init);
    }
  }, [recordData, recording]);

  const createSession = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("training_sessions").insert({
        title: session.title,
        description: session.description || null,
        starts_at: new Date(session.starts_at).toISOString(),
        ends_at: session.ends_at ? new Date(session.ends_at).toISOString() : null,
        location: session.location || null,
        meeting_url: session.meeting_url || null,
        week_id: session.week_id || null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Session created");
      setSessionOpen(false);
      setSession({ title: "", description: "", starts_at: "", ends_at: "", location: "", meeting_url: "", week_id: "" });
      void qc.invalidateQueries({ queryKey: ["admin-attendance"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAttendance = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(marks).map(([studentId, status]) => ({ student_id: studentId, status }));
      const { error } = await supabase.rpc("admin_set_attendance", {
        p_session_id: recording!,
        p_entries: entries,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Attendance saved (audited)");
      setRecording(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Attendance" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Create training sessions and record attendance."
        actions={<Button onClick={() => setSessionOpen(true)}><Plus /> New session</Button>}
      />

      {(data?.sessions ?? []).length === 0 ? (
        <EmptyState title="No sessions yet" description="Create a training session to start recording attendance." />
      ) : (
        <div className="space-y-3">
          {(data?.sessions ?? []).map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(s.starts_at as string)}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setRecording(s.id)}>Record attendance</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={async () => {
                    if (!window.confirm("Delete this session and its attendance records?")) return;
                    const { error } = await supabase.from("training_sessions").delete().eq("id", s.id);
                    if (error) toast.error(errMsg(error));
                    else void qc.invalidateQueries({ queryKey: ["admin-attendance"] });
                  }}
                >
                  Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* New session dialog */}
      <Dialog open={sessionOpen} onOpenChange={setSessionOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New training session</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={session.title} onChange={(e) => setSession({ ...session, title: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Starts at *</Label>
                <Input type="datetime-local" value={session.starts_at} onChange={(e) => setSession({ ...session, starts_at: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Ends at</Label>
                <Input type="datetime-local" value={session.ends_at} onChange={(e) => setSession({ ...session, ends_at: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input value={session.location} onChange={(e) => setSession({ ...session, location: e.target.value })} placeholder="Hall 3 / Lab 2" />
              </div>
              <div className="space-y-1.5">
                <Label>Meeting URL</Label>
                <Input value={session.meeting_url} onChange={(e) => setSession({ ...session, meeting_url: e.target.value })} placeholder="https://…" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Training week</Label>
              <Select value={session.week_id || "none"} onValueChange={(v) => setSession({ ...session, week_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {(data?.weeks ?? []).map((w) => <SelectItem key={w.id} value={w.id}>Week {w.week_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={session.description} onChange={(e) => setSession({ ...session, description: e.target.value })} />
            </div>
            <DialogFooter>
              <Button onClick={() => createSession.mutate()} disabled={!session.title || !session.starts_at}>Create</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Attendance recorder */}
      <Dialog open={!!recording} onOpenChange={(v) => !v && setRecording(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Record attendance</DialogTitle></DialogHeader>
          <div className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
            {(recordData?.students ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{s.full_name_en}</span>
                <Select
                  value={marks[s.id] ?? "present"}
                  onValueChange={(v) => setMarks({ ...marks, [s.id]: v as AttendanceStatus })}
                >
                  <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => saveAttendance.mutate()} disabled={saveAttendance.isPending}>
              <Save /> Save attendance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
