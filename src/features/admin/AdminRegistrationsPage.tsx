import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCheck, ScrollText, X } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { Profile } from "@/types";

export default function AdminRegistrationsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-registrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("status", "pending_approval")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  const decide = useMutation({
    mutationFn: async ({ userId, approve }: { userId: string; approve: boolean }) => {
      const { error } = await supabase.rpc("admin_set_profile_status", {
        p_user_id: userId,
        p_status: approve ? "active" : "deactivated",
        p_note: approve ? null : "Registration rejected",
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-registrations"] });
      void qc.invalidateQueries({ queryKey: ["admin-students"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkApprove = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc("admin_bulk_approve", { p_user_ids: ids });
      if (error) throw new Error(errMsg(error));
      return data as number;
    },
    onSuccess: (count) => {
      toast.success(`${count} registration(s) approved`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["admin-registrations"] });
      void qc.invalidateQueries({ queryKey: ["admin-students"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Registrations" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const pending = data ?? [];

  return (
    <>
      <PageHeader
        title="Registrations"
        description="New accounts waiting for approval."
        actions={
          selected.size > 0 ? (
            <Button onClick={() => bulkApprove.mutate([...selected])}>
              <CheckCheck /> Approve {selected.size} selected
            </Button>
          ) : undefined
        }
      />

      {pending.length === 0 ? (
        <EmptyState icon={ScrollText} title="No pending registrations" description="All caught up — new sign-ups awaiting approval will appear here." />
      ) : (
        <div className="space-y-3">
          {pending.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) next.add(p.id);
                    else next.delete(p.id);
                    setSelected(next);
                  }}
                  aria-label={`Select ${p.full_name_en}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.full_name_en}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[p.personal_email, p.university_id, p.academic_year, p.programming_experience]
                      .filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Badge variant="warning">Applied {formatDate(p.created_at)}</Badge>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide.mutate({ userId: p.id, approve: true })}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => decide.mutate({ userId: p.id, approve: false })}>
                    <X /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
