import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { timeAgo } from "@/lib/utils";
import { PageHeader, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { SupportReply, SupportRequest } from "@/types";

export default function AdminSupportPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("open");
  const [replies, setReplies] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-support", filter],
    queryFn: async () => {
      let query = supabase.from("support_requests").select("*, replies:support_replies(*)").order("created_at", { ascending: false });
      if (filter === "open") query = query.in("status", ["open", "in_progress"]);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as unknown as (SupportRequest & { replies: SupportReply[] })[];
      const profiles = await fetchProfiles(rows.flatMap((r) => [r.student_id, ...r.replies.map((x) => x.author_id)]));
      return rows.map((r) => ({
        ...r,
        student: profiles[r.student_id],
        replies: r.replies
          .map((x) => ({ ...x, author: profiles[x.author_id] }))
          .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      }));
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("support_requests").update({ status, assigned_to: (await supabase.auth.getUser()).data.user?.id }).eq("id", id);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Status updated");
      void qc.invalidateQueries({ queryKey: ["admin-support"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reply = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const { error } = await supabase.from("support_requests").update({ status: "in_progress" }).eq("id", id);
      if (error) throw new Error(errMsg(error));
      const { error: rErr } = await supabase.from("support_replies").insert({
        request_id: id,
        author_id: (await supabase.auth.getUser()).data.user?.id,
        body,
        internal: false,
      });
      if (rErr) throw new Error(errMsg(rErr));
    },
    onSuccess: () => {
      toast.success("Reply sent — student notified");
      void qc.invalidateQueries({ queryKey: ["admin-support"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Support" />
      <LoadingRows />
    </>
  );

  const requests = data ?? [];

  return (
    <>
      <PageHeader
        title="Support Requests"
        description="Private student requests. Replies are visible to the student."
        actions={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open & in progress</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {requests.length === 0 ? (
        <EmptyState title="No support requests" description="Private requests from students appear here." />
      ) : (
        <div className="max-w-3xl space-y-4">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{r.subject}</p>
                  <Badge variant={r.status === "resolved" ? "success" : r.status === "in_progress" ? "warning" : "secondary"}>
                    {r.status.replace("_", " ")}
                  </Badge>
                  <Badge variant="outline">{r.category}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {r.student?.full_name_en ?? "?"} · {timeAgo(r.created_at)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.description}</p>
                {r.replies.filter((x) => !x.internal).length > 0 && (
                  <div className="space-y-2 border-t pt-2">
                    {r.replies.filter((x) => !x.internal).map((x) => (
                      <div key={x.id} className="rounded-md bg-muted/50 p-2 text-sm">
                        <p className="text-[11px] text-muted-foreground">{x.author?.full_name_en ?? "?"} · {timeAgo(x.created_at)}</p>
                        <p className="whitespace-pre-wrap">{x.body}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Input
                    className="min-w-48 flex-1"
                    placeholder="Write a reply…"
                    value={replies[r.id] ?? ""}
                    onChange={(e) => setReplies({ ...replies, [r.id]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    disabled={!(replies[r.id] ?? "").trim()}
                    onClick={() => reply.mutate({ id: r.id, body: replies[r.id]!.trim() })}
                  >
                    <Send /> Reply
                  </Button>
                  <Select onValueChange={(v) => updateStatus.mutate({ id: r.id, status: v })}>
                    <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Set status…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
