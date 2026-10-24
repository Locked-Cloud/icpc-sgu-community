import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState, StatCard } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { AttendanceRecord, TrainingSession } from "@/types";

export default function AttendancePage() {
  const { profile } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["attendance", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const [{ data: records }, { data: sessions }] = await Promise.all([
        supabase.from("attendance_records").select("*").eq("student_id", profile!.id),
        supabase.from("training_sessions").select("*").order("starts_at", { ascending: false }),
      ]);
      const recs = (records ?? []) as AttendanceRecord[];
      const sess = (sessions ?? []) as TrainingSession[];
      const bySession = new Map(recs.map((r) => [r.session_id, r]));
      return { records: recs, sessions: sess.map((s) => ({ session: s, record: bySession.get(s.id) ?? null })) };
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Attendance" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const records = data?.records ?? [];
  const past = (data?.sessions ?? []).filter((s) => new Date(s.session.starts_at) < new Date());
  const upcoming = (data?.sessions ?? []).filter((s) => new Date(s.session.starts_at) >= new Date());
  const counts = {
    present: records.filter((r) => r.status === "present").length,
    late: records.filter((r) => r.status === "late").length,
    absent: records.filter((r) => r.status === "absent").length,
    excused: records.filter((r) => r.status === "excused").length,
  };
  const total = records.length;
  const rate = total > 0 ? Math.round(((counts.present + counts.late) / total) * 100) : null;

  return (
    <>
      <PageHeader title="Attendance" description="Your attendance record across training sessions." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Attendance rate" value={rate != null ? `${rate}%` : "—"} icon={ClipboardCheck} />
        <StatCard label="Present" value={counts.present} />
        <StatCard label="Late" value={counts.late} />
        <StatCard label="Absent" value={counts.absent} />
        <StatCard label="Excused" value={counts.excused} />
      </div>

      {upcoming.length > 0 && (
        <Card className="mb-6">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium">Upcoming sessions</p>
            {upcoming.slice(0, 5).map(({ session }) => (
              <div key={session.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{session.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(session.starts_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {past.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No sessions yet" description="Attendance records appear after training sessions take place." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {past.map(({ session, record }) => (
                  <TableRow key={session.id}>
                    <TableCell className="max-w-64 truncate">{session.title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(session.starts_at)}</TableCell>
                    <TableCell>
                      {record ? (
                        <Badge variant={
                          record.status === "present" ? "success" :
                          record.status === "late" ? "warning" :
                          record.status === "excused" ? "info" : "destructive"
                        }>
                          {record.status}
                        </Badge>
                      ) : (
                        <Badge variant="muted">Not recorded</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-56 truncate text-xs text-muted-foreground sm:table-cell">{record?.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
