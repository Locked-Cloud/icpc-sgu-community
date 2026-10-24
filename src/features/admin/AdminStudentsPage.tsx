import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ShieldCheck, UserX } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { ACCOUNT_STATUS_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { toCSV, downloadCSV } from "@/lib/csv";
import { PageHeader, ErrorState, LoadingRows, ConfirmDialog } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { Profile } from "@/types";

export default function AdminStudentsPage() {
  const { profile: me } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(0);
  const PAGE = 20;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-students", search, status, page],
    queryFn: async () => {
      let query = supabase.from("profiles").select("*", { count: "exact" }).eq("role", "student");
      if (search.trim()) query = query.or(`full_name_en.ilike.%${search.trim()}%,university_id.ilike.%${search.trim()}%`);
      if (status !== "all") query = query.eq("status", status);
      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as Profile[], total: count ?? 0 };
    },
  });

  const setStatusMut = useMutation({
    mutationFn: async ({ userId, newStatus, note }: { userId: string; newStatus: string; note?: string }) => {
      const { error } = await supabase.rpc("admin_set_profile_status", {
        p_user_id: userId,
        p_status: newStatus,
        p_note: note ?? null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Status updated");
      void qc.invalidateQueries({ queryKey: ["admin-students"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await supabase.rpc("admin_set_role", { p_user_id: userId, p_role: role });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Role updated");
      void qc.invalidateQueries({ queryKey: ["admin-students"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = () => {
    if (!data) return;
    const csv = toCSV(
      data.rows.map((s) => ({
        name: s.full_name_en,
        university_id: s.university_id ?? "",
        academic_year: s.academic_year ?? "",
        email: s.personal_email ?? "",
        phone: s.phone ?? "",
        status: s.status,
        codeforces: s.codeforces_handle ?? "",
        created_at: s.created_at,
      })),
    );
    downloadCSV("students.csv", csv);
  };

  const totalPages = useMemo(() => Math.ceil((data?.total ?? 0) / PAGE), [data?.total]);

  if (isLoading) return (
    <>
      <PageHeader title="Students" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title="Students"
        description={`${data?.total ?? 0} registered students`}
        actions={<Button variant="outline" onClick={exportCsv}><Download /> Export page (CSV)</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="w-full sm:w-72"
          placeholder="Search by name or university ID…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(ACCOUNT_STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">University ID</TableHead>
                <TableHead className="hidden lg:table-cell">Year</TableHead>
                <TableHead className="hidden sm:table-cell">CF handle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Joined</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-44 truncate font-medium">{s.full_name_en}</TableCell>
                  <TableCell className="hidden md:table-cell">{s.university_id ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{s.academic_year ?? "—"}</TableCell>
                  <TableCell className="hidden sm:table-cell">{s.codeforces_handle ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={
                      s.status === "active" ? "success" :
                      s.status === "pending_approval" ? "warning" :
                      s.status === "suspended" ? "destructive" : "muted"
                    }>
                      {ACCOUNT_STATUS_LABELS[s.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{formatDate(s.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {s.status !== "active" && s.status !== "suspended" && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setStatusMut.mutate({ userId: s.id, newStatus: "active" })}>
                          Approve
                        </Button>
                      )}
                      {s.status === "active" && (
                        <ConfirmDialog
                          trigger={<Button size="sm" variant="ghost" className="h-7 text-destructive"><UserX /> Suspend</Button>}
                          title={`Suspend ${s.full_name_en}?`}
                          description="They will be blocked from signing in until reactivated."
                          actionLabel="Suspend"
                          destructive
                          onConfirm={() => setStatusMut.mutate({ userId: s.id, newStatus: "suspended" })}
                        />
                      )}
                      {s.status === "suspended" && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setStatusMut.mutate({ userId: s.id, newStatus: "active" })}>
                          Reactivate
                        </Button>
                      )}
                      {s.id !== me?.id && (
                        <ConfirmDialog
                          trigger={<Button size="sm" variant="ghost" className="h-7"><ShieldCheck /> Admin</Button>}
                          title={`Grant administrator access to ${s.full_name_en}?`}
                          description="They will gain full administrative permissions. This action is recorded in the audit log."
                          actionLabel="Promote"
                          onConfirm={() => setRole.mutate({ userId: s.id, role: "admin" })}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}
