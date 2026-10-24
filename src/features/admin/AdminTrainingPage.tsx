import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
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
import { resourceSchema } from "@/lib/validation";
import type { TrainingResource, TrainingWeek } from "@/types";

interface WeekForm {
  id?: string;
  week_number: number;
  title: string;
  description: string;
  objectives: string;
  topics: string;
  start_date: string;
  end_date: string;
  status: "draft" | "scheduled" | "published" | "archived";
  publish_at: string;
  notes: string;
}

const EMPTY_WEEK: WeekForm = {
  week_number: 1, title: "", description: "", objectives: "", topics: "",
  start_date: "", end_date: "", status: "draft", publish_at: "", notes: "",
};

export default function AdminTrainingPage() {
  const qc = useQueryClient();
  const [weekForm, setWeekForm] = useState<WeekForm | null>(null);
  const [resourceWeek, setResourceWeek] = useState<TrainingWeek | null>(null);
  const [resource, setResource] = useState({ title: "", kind: "link", url: "", description: "" });
  const [file, setFile] = useState<File | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-training"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_weeks")
        .select("*, resources:training_resources(*)")
        .order("week_number");
      if (error) throw error;
      return (data ?? []) as unknown as (TrainingWeek & { resources: TrainingResource[] })[];
    },
  });

  const saveWeek = useMutation({
    mutationFn: async () => {
      if (!weekForm) return;
      const payload = {
        week_number: Number(weekForm.week_number),
        title: weekForm.title,
        description: weekForm.description || null,
        objectives: weekForm.objectives.split("\n").map((s) => s.trim()).filter(Boolean),
        topics: weekForm.topics.split(",").map((s) => s.trim()).filter(Boolean),
        start_date: weekForm.start_date || null,
        end_date: weekForm.end_date || null,
        status: weekForm.status,
        publish_at: weekForm.publish_at ? new Date(weekForm.publish_at).toISOString() : null,
        notes: weekForm.notes || null,
      };
      const { error } = weekForm.id
        ? await supabase.from("training_weeks").update(payload).eq("id", weekForm.id)
        : await supabase.from("training_weeks").insert(payload);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Week saved");
      setWeekForm(null);
      void qc.invalidateQueries({ queryKey: ["admin-training"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: async ({ weekId, status }: { weekId: string; status: string }) => {
      const { error } = await supabase
        .from("training_weeks")
        .update({ status, publish_at: status === "published" ? new Date().toISOString() : null })
        .eq("id", weekId);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Status updated — students were notified on publish");
      void qc.invalidateQueries({ queryKey: ["admin-training"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteWeek = useMutation({
    mutationFn: async (weekId: string) => {
      const { error } = await supabase.from("training_weeks").delete().eq("id", weekId);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Week deleted");
      void qc.invalidateQueries({ queryKey: ["admin-training"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addResource = useMutation({
    mutationFn: async () => {
      if (!resourceWeek) return;
      const check = resourceSchema.safeParse(resource);
      if (!check.success) throw new Error(check.error.issues[0]?.message ?? "Invalid resource");
      let storagePath: string | null = null;
      let url: string | null = resource.url || null;

      if (file) {
        const path = `${resourceWeek.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("training-resources")
          .upload(path, file);
        if (upErr) throw new Error(errMsg(upErr));
        storagePath = path;
        url = null;
      }
      if (!url && !storagePath) throw new Error("Provide a link or a file");

      const { error } = await supabase.from("training_resources").insert({
        week_id: resourceWeek.id,
        title: resource.title,
        kind: resource.kind,
        url,
        storage_path: storagePath,
        description: resource.description || null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Resource added");
      setResourceWeek(null);
      setResource({ title: "", kind: "link", url: "", description: "" });
      setFile(null);
      void qc.invalidateQueries({ queryKey: ["admin-training"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteResource = useMutation({
    mutationFn: async (r: TrainingResource) => {
      const { error } = await supabase.from("training_resources").delete().eq("id", r.id);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-training"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (weekForm && weekForm.id) {
      const w = data?.find((x) => x.id === weekForm.id);
      if (w) {
        setWeekForm({
          ...weekForm,
          title: w.title,
          description: w.description ?? "",
          objectives: w.objectives.join("\n"),
          topics: w.topics.join(", "),
          start_date: w.start_date ?? "",
          end_date: w.end_date ?? "",
          status: w.status,
          publish_at: w.publish_at ? w.publish_at.slice(0, 16) : "",
          notes: w.notes ?? "",
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (isLoading) return (
    <>
      <PageHeader title="Training Weeks" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title="Training Weeks"
        description="Create, schedule and publish weekly training materials."
        actions={<Button onClick={() => setWeekForm({ ...EMPTY_WEEK })}><Plus /> New week</Button>}
      />

      <div className="space-y-3">
        {(data ?? []).map((w) => (
          <Card key={w.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">Week {w.week_number} — {w.title}</p>
                <Badge variant={w.status === "published" ? "success" : w.status === "scheduled" ? "warning" : "secondary"}>
                  {w.status}
                </Badge>
                {w.start_date && <span className="text-xs text-muted-foreground">{formatDate(w.start_date)} → {formatDate(w.end_date)}</span>}
                <span className="text-xs text-muted-foreground">{w.resources?.length ?? 0} resources</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {w.status !== "published" && (
                  <Button size="sm" variant="outline" onClick={() => publish.mutate({ weekId: w.id, status: "published" })}>
                    <Megaphone /> Publish now
                  </Button>
                )}
                {w.status === "published" && (
                  <Button size="sm" variant="ghost" onClick={() => publish.mutate({ weekId: w.id, status: "draft" })}>
                    Unpublish
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setWeekForm({ ...EMPTY_WEEK, id: w.id, week_number: w.week_number, title: w.title })}>
                  <Pencil /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setResourceWeek(w); setFile(null); }}>
                  <Upload /> Add resource
                </Button>
                <ConfirmDialog
                  trigger={<Button size="sm" variant="ghost" className="text-destructive"><Trash2 /></Button>}
                  title="Delete this week?"
                  description="All attached resources and completion records will be removed."
                  actionLabel="Delete"
                  destructive
                  onConfirm={() => deleteWeek.mutate(w.id)}
                />
              </div>
              {w.resources && w.resources.length > 0 && (
                <div className="mt-2 space-y-1">
                  {w.resources.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline">{r.kind}</Badge>
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      {!r.visible && <Badge variant="muted">hidden</Badge>}
                      <button className="text-muted-foreground hover:text-destructive" onClick={() => deleteResource.mutate(r)}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Week editor */}
      <Dialog open={!!weekForm} onOpenChange={(v) => !v && setWeekForm(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{weekForm?.id ? "Edit week" : "New training week"}</DialogTitle></DialogHeader>
          {weekForm && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Week number *</Label>
                <Input type="number" min={1} value={weekForm.week_number} onChange={(e) => setWeekForm({ ...weekForm, week_number: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={weekForm.status} onValueChange={(v) => setWeekForm({ ...weekForm, status: v as WeekForm["status"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Title *</Label>
                <Input value={weekForm.title} onChange={(e) => setWeekForm({ ...weekForm, title: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Description</Label>
                <Textarea value={weekForm.description} onChange={(e) => setWeekForm({ ...weekForm, description: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Objectives (one per line)</Label>
                <Textarea rows={3} value={weekForm.objectives} onChange={(e) => setWeekForm({ ...weekForm, objectives: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Topics (comma separated)</Label>
                <Input value={weekForm.topics} onChange={(e) => setWeekForm({ ...weekForm, topics: e.target.value })} placeholder="implementation, sorting" />
              </div>
              <div className="space-y-1.5">
                <Label>Publish at (optional)</Label>
                <Input type="datetime-local" value={weekForm.publish_at} onChange={(e) => setWeekForm({ ...weekForm, publish_at: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" value={weekForm.start_date} onChange={(e) => setWeekForm({ ...weekForm, start_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" value={weekForm.end_date} onChange={(e) => setWeekForm({ ...weekForm, end_date: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea value={weekForm.notes} onChange={(e) => setWeekForm({ ...weekForm, notes: e.target.value })} />
              </div>
              <DialogFooter className="sm:col-span-2">
                <Button onClick={() => saveWeek.mutate()} disabled={saveWeek.isPending || weekForm.title.trim().length < 3}>
                  Save week
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resource dialog */}
      <Dialog open={!!resourceWeek} onOpenChange={(v) => !v && setResourceWeek(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add resource to “{resourceWeek?.title}”</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={resource.title} onChange={(e) => setResource({ ...resource, title: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={resource.kind} onValueChange={(v) => setResource({ ...resource, kind: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["pdf", "slides", "document", "video", "youtube", "link", "problem", "code", "practice_sheet"].map((k) => (
                      <SelectItem key={k} value={k}>{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Or upload a file</Label>
                <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Link URL {file ? "(ignored when file selected)" : ""}</Label>
              <Input value={resource.url} onChange={(e) => setResource({ ...resource, url: e.target.value })} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={resource.description} onChange={(e) => setResource({ ...resource, description: e.target.value })} />
            </div>
            <DialogFooter>
              <Button onClick={() => addResource.mutate()} disabled={addResource.isPending || resource.title.trim().length < 2}>
                Add resource
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
