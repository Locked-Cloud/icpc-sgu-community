import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { AuditLog } from "@/types";

export default function AdminAuditPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE = 30;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-audit", search, page],
    queryFn: async () => {
      let query = supabase.from("audit_logs").select("*", { count: "exact" }).order("id", { ascending: false });
      if (search.trim()) query = query.ilike("action", `%${search.trim()}%`);
      const { data, error, count } = await query.range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as AuditLog[];
      const profiles = await fetchProfiles(rows.map((r) => r.actor_id).filter(Boolean) as string[]);
      return {
        rows: rows.map((r) => ({ ...r, actor: r.actor_id ? profiles[r.actor_id] : null })),
        total: count ?? 0,
      };
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Audit Logs" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(Math.ceil(total / PAGE), 1);

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Sensitive actions are recorded here and cannot be modified through the app."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Filter by action (e.g. team.)" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={History} title="No matching audit entries" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden sm:table-cell">Entity</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="outline" className="font-mono text-[11px]">{r.action}</Badge></TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{r.entity_type}{r.entity_id ? ` · ${r.entity_id.slice(0, 8)}…` : ""}</TableCell>
                    <TableCell className="text-xs">{r.actor?.full_name_en ?? "system"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} / {totalPages} · {total} entries</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}
