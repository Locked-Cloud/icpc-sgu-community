import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Pencil, Plus } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, ConfirmDialog } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Announcement, Team } from "@/types";

interface Form {
  id?: string;
  title: string; body: string; priority: "normal" | "important" | "critical";
  audience: "all" | "teams" | "students"; audience_ids: string[];
  expires_at: string; status: "draft" | "published";
}

const EMPTY: Form = { title: "", body: "", priority: "normal", audience: "all", audience_ids: [], expires_at: "", status: "draft" };

export default function AdminAnnouncementsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: async () => {
      const [{ data: announcements }, { data: teams }] = await Promise.all([
        supabase.from("announcements").select("*").order("created_at", { ascending: false }),
        supabase.from("teams").select("id, name").neq("status", "archived").order("name"),
      ]);
      return {
        announcements: (announcements ?? []) as Announcement[],
        teams: (teams ?? []) as Pick<Team, "id" | "name">[],
      };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const payload = {
        title: form.title,
        body: form.body,
        priority: form.priority,
        audience: form.audience,
        audience_ids: form.audience === "teams" ? form.audience_ids : [],
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        status: form.status,
        published_at: form.status === "published" ? new Date().toISOString() : null,
      };
      const { error } = form.id
        ? await supabase.from("announcements").update(payload).eq("id", form.id)
        : await supabase.from("announcements").insert({ ...payload, created_by: (await supabase.auth.getUser()).data.user?.id });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Announcement saved — publishing notifies the target audience");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("announcements").delete().eq("id", id);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-announcements"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Announcements" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Publish announcements to all students or specific teams."
        actions={<Button onClick={() => setForm({ ...EMPTY })}><Plus /> New announcement</Button>}
      />

      <div className="space-y-3">
        {(data?.announcements ?? []).map((a) => (
          <Card key={a.id}>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {a.title}
                  <Badge variant={a.status === "published" ? "success" : "secondary"}>{a.status}</Badge>
                  <Badge variant={a.priority === "critical" ? "destructive" : a.priority === "important" ? "warning" : "outline"}>{a.priority}</Badge>
                  <Badge variant="outline">audience: {a.audience}</Badge>
                </p>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{a.body}</p>
                {a.published_at && <p className="text-[11px] text-muted-foreground">published {formatDateTime(a.published_at)}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setForm({
                id: a.id, title: a.title, body: a.body, priority: a.priority, audience: a.audience,
                audience_ids: a.audience_ids, expires_at: a.expires_at ? a.expires_at.slice(0, 16) : "",
                status: a.status,
              })}>
                <Pencil /> Edit
              </Button>
              <ConfirmDialog
                trigger={<Button size="sm" variant="ghost" className="text-destructive">×</Button>}
                title="Delete announcement?"
                actionLabel="Delete"
                destructive
                onConfirm={() => remove.mutate(a.id)}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form?.id ? "Edit announcement" : "New announcement"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Title *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Body *</Label>
                <Textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as Form["priority"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="important">Important</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Audience</Label>
                  <Select value={form.audience} onValueChange={(v) => setForm({ ...form, audience: v as Form["audience"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All students</SelectItem>
                      <SelectItem value="students">Students</SelectItem>
                      <SelectItem value="teams">Selected teams</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Form["status"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.audience === "teams" && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-3">
                  {(data?.teams ?? []).map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.audience_ids.includes(t.id)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            audience_ids: e.target.checked ? [...form.audience_ids, t.id] : form.audience_ids.filter((x) => x !== t.id),
                          })
                        }
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Expires at (optional)</Label>
                <Input type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
              </div>
              <DialogFooter>
                <Button onClick={() => save.mutate()} disabled={save.isPending || form.title.length < 3 || form.body.length < 3}>
                  <Megaphone /> Save
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
