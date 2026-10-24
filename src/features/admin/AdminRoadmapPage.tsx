import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, ConfirmDialog } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { RoadmapMilestone, RoadmapMilestoneProgress } from "@/types";

interface MilestoneForm {
  id?: string;
  title: string;
  description: string;
  objectives: string;
  topic_slugs: string;
  week_id: string;
  sheet_id: string;
  assignment_id: string;
  completion_threshold: number;
  hard_prerequisite: boolean;
  sort_order: number;
  target_date: string;
  status: "draft" | "published" | "archived";
  prerequisites: string[];
}

const EMPTY: MilestoneForm = {
  title: "", description: "", objectives: "", topic_slugs: "", week_id: "", sheet_id: "",
  assignment_id: "", completion_threshold: 0.8, hard_prerequisite: false, sort_order: 1,
  target_date: "", status: "draft", prerequisites: [],
};

interface RoadmapMilestoneRow extends RoadmapMilestone {
  prerequisites: { prerequisite_id: string }[];
}

export default function AdminRoadmapPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<MilestoneForm | null>(null);
  const [progressUser, setProgressUser] = useState<string>("");

  // students for the progress/override picker
  const { data: students } = useQuery({
    queryKey: ["admin-roadmap-students"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles_public")
        .select("id, full_name_en")
        .order("full_name_en")
        .limit(300);
      if (error) throw error;
      return (data ?? []) as { id: string; name?: string; full_name_en: string }[];
    },
  });

  const studentProgress = useQuery({
    queryKey: ["admin-roadmap-progress", progressUser],
    enabled: !!progressUser,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("roadmap_progress_for", { p_user_id: progressUser });
      if (error) throw error;
      return (data ?? []) as RoadmapMilestoneProgress[];
    },
  });

  const override = useMutation({
    mutationFn: async ({ userId, milestoneId, reason }: { userId: string; milestoneId: string; reason: string | null }) => {
      const complete = reason !== null;
      const { error } = await supabase.rpc("admin_set_milestone_override", {
        p_user_id: userId,
        p_milestone_id: milestoneId,
        p_complete: complete,
        p_reason: complete ? (reason || "admin override") : null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Override saved (audited)");
      void qc.invalidateQueries({ queryKey: ["admin-roadmap-progress", progressUser] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-roadmap"],
    queryFn: async () => {
      const [{ data: milestones }, { data: weeks }, { data: sheets }, { data: assignments }] = await Promise.all([
        supabase.from("roadmap_milestones").select("*, prerequisites:roadmap_prerequisites!milestone_id(prerequisite_id)").order("sort_order"),
        supabase.from("training_weeks").select("id, week_number, title").neq("status", "archived").order("week_number"),
        supabase.from("problem_sheets").select("id, title").neq("status", "archived"),
        supabase.from("assignments").select("id, title").neq("status", "archived"),
      ]);
      if (milestones === null) throw new Error("failed");
      return {
        milestones: (milestones ?? []) as unknown as RoadmapMilestoneRow[],
        weeks: (weeks ?? []) as { id: string; week_number: number; title: string }[],
        sheets: (sheets ?? []) as { id: string; title: string }[],
        assignments: (assignments ?? []) as { id: string; title: string }[],
      };
    },
  });

  useEffect(() => {
    if (form?.id && data) {
      const m = data.milestones.find((x) => x.id === form.id);
      if (m) {
        setForm({
          id: m.id, title: m.title, description: m.description ?? "",
          objectives: m.objectives.join("\n"), topic_slugs: m.topic_slugs.join(", "),
          week_id: m.week_id ?? "", sheet_id: m.sheet_id ?? "", assignment_id: m.assignment_id ?? "",
          completion_threshold: Number(m.completion_threshold), hard_prerequisite: m.hard_prerequisite,
          sort_order: m.sort_order, target_date: m.target_date ?? "", status: m.status as MilestoneForm["status"],
          prerequisites: m.prerequisites.map((p) => p.prerequisite_id),
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const payload = {
        title: form.title,
        description: form.description || null,
        objectives: form.objectives.split("\n").map((s) => s.trim()).filter(Boolean),
        topic_slugs: form.topic_slugs.split(",").map((s) => s.trim()).filter(Boolean),
        week_id: form.week_id || null,
        sheet_id: form.sheet_id || null,
        assignment_id: form.assignment_id || null,
        completion_threshold: form.completion_threshold,
        hard_prerequisite: form.hard_prerequisite,
        sort_order: form.sort_order,
        target_date: form.target_date || null,
        status: form.status,
      };
      let milestoneId = form.id;
      const { error } = milestoneId
        ? await supabase.from("roadmap_milestones").update(payload).eq("id", milestoneId)
        : await (async () => {
            const { data, error } = await supabase.from("roadmap_milestones").insert(payload).select("id").single();
            milestoneId = data?.id;
            return { error };
          })();
      if (error) throw new Error(errMsg(error));

      // sync prerequisites (DB rejects cycles with a clear error)
      const { error: delErr } = await supabase
        .from("roadmap_prerequisites")
        .delete()
        .eq("milestone_id", milestoneId!);
      if (delErr) throw new Error(errMsg(delErr));
      if (form.prerequisites.length > 0) {
        const { error: insErr } = await supabase
          .from("roadmap_prerequisites")
          .insert(form.prerequisites.map((pid) => ({ milestone_id: milestoneId, prerequisite_id: pid })));
        if (insErr) throw new Error(errMsg(insErr));
      }
    },
    onSuccess: () => {
      toast.success("Milestone saved");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["admin-roadmap"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("roadmap_milestones").delete().eq("id", id);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Milestone deleted");
      void qc.invalidateQueries({ queryKey: ["admin-roadmap"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const move = useMutation({
    mutationFn: async ({ id, dir }: { id: string; dir: -1 | 1 }) => {
      const rows = data?.milestones ?? [];
      const idx = rows.findIndex((m) => m.id === id);
      const target = rows[idx + dir];
      if (!target) return;
      await supabase.from("roadmap_milestones").update({ sort_order: target.sort_order }).eq("id", id);
      await supabase.from("roadmap_milestones").update({ sort_order: rows[idx]!.sort_order }).eq("id", target.id);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-roadmap"] }),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Roadmap Management" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const { milestones, weeks, sheets, assignments } = data ?? { milestones: [], weeks: [], sheets: [], assignments: [] };

  return (
    <>
      <PageHeader
        title="Roadmap Management"
        description="Milestones link weeks, sheets and assignments. Completion is computed from real student records."
        actions={<Button onClick={() => setForm({ ...EMPTY, sort_order: milestones.length + 1 })}><Plus /> New milestone</Button>}
      />

      <div className="space-y-3">
        {milestones.map((m, i) => (
          <Card key={m.id}>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="flex flex-col gap-0.5">
                <Button variant="ghost" size="icon" className="h-5 w-5" disabled={i === 0} onClick={() => move.mutate({ id: m.id, dir: -1 })}>
                  <ArrowUpDown className="h-3 w-3 rotate-180" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5" disabled={i === milestones.length - 1} onClick={() => move.mutate({ id: m.id, dir: 1 })}>
                  <ArrowUpDown className="h-3 w-3" />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {m.title}
                  <Badge variant={m.status === "published" ? "success" : "secondary"}>{m.status}</Badge>
                  {m.hard_prerequisite && <Badge variant="warning">hard prereqs</Badge>}
                  {m.target_date && <span className="text-xs text-muted-foreground">target {formatDate(m.target_date)}</span>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  threshold {Math.round(Number(m.completion_threshold) * 100)}%
                  {m.week_id && ` · week ${(weeks.find((w) => w.id === m.week_id)?.week_number) ?? ""}`}
                  {m.sheet_id && ` · sheet “${sheets.find((s) => s.id === m.sheet_id)?.title ?? ""}”`}
                  {m.assignment_id && ` · assignment “${assignments.find((a) => a.id === m.assignment_id)?.title ?? ""}”`}
                  {m.prerequisites.length > 0 && ` · ${m.prerequisites.length} prerequisite(s)`}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setForm({ ...EMPTY, id: m.id, title: m.title })}><Pencil /></Button>
              <ConfirmDialog
                trigger={<Button size="sm" variant="ghost" className="text-destructive"><Trash2 /></Button>}
                title="Delete milestone?"
                actionLabel="Delete"
                destructive
                onConfirm={() => remove.mutate(m.id)}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-student progress + audited override */}
      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Student progress &amp; overrides</CardTitle>
          <CardDescription>
            Pick a student to see computed milestone status. Overrides are recorded in the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={progressUser || "none"} onValueChange={setProgressUser}>
            <SelectTrigger className="w-full sm:w-80"><SelectValue placeholder="Select student…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {students?.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.full_name_en}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {progressUser && (
            <div className="space-y-1.5">
              {studentProgress.isError && (
                <p className="text-sm text-destructive">Could not load progress: {errMsg(studentProgress.error)}</p>
              )}
              {(studentProgress.data ?? []).map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  <Badge variant={
                    row.status === "completed" ? "success" :
                    row.status === "locked" ? "muted" :
                    row.status === "in_progress" ? "warning" : "secondary"
                  }>
                    {row.status.replace("_", " ")}
                  </Badge>
                  {row.status !== "completed" ? (
                    <Button
                      size="sm" variant="outline" className="h-7"
                      disabled={override.isPending}
                      onClick={() => {
                        const reason = window.prompt("Override reason (recorded in the audit log):");
                        if (reason === null) return;
                        override.mutate({ userId: progressUser, milestoneId: row.id, reason });
                      }}
                    >
                      Force complete
                    </Button>
                  ) : (
                    <Button
                      size="sm" variant="ghost" className="h-7"
                      disabled={override.isPending}
                      onClick={() => {
                        if (!window.confirm("Remove any admin override for this milestone?")) return;
                        override.mutate({ userId: progressUser, milestoneId: row.id, reason: null });
                      }}
                    >
                      Clear override
                    </Button>
                  )}
                </div>
              ))}
              {(studentProgress.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No published milestones yet.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{form?.id ? "Edit milestone" : "New milestone"}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Title *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Linked training week</Label>
                <Select value={form.week_id || "none"} onValueChange={(v) => setForm({ ...form, week_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {weeks.map((w) => <SelectItem key={w.id} value={w.id}>Week {w.week_number}: {w.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Linked problem sheet</Label>
                <Select value={form.sheet_id || "none"} onValueChange={(v) => setForm({ ...form, sheet_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {sheets.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Linked assignment</Label>
                <Select value={form.assignment_id || "none"} onValueChange={(v) => setForm({ ...form, assignment_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {assignments.map((a) => <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Completion threshold</Label>
                <Input type="number" step="0.05" min="0.05" max="1" value={form.completion_threshold} onChange={(e) => setForm({ ...form, completion_threshold: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Target date</Label>
                <Input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as MilestoneForm["status"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Prerequisites</Label>
                <div className="space-y-1.5 rounded-md border p-3">
                  {milestones.filter((m) => m.id !== form.id).map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.prerequisites.includes(m.id)}
                        onCheckedChange={(v) =>
                          setForm({
                            ...form,
                            prerequisites: v ? [...form.prerequisites, m.id] : form.prerequisites.filter((p) => p !== m.id),
                          })
                        }
                      />
                      {m.title}
                    </label>
                  ))}
                  {milestones.length <= 1 && <p className="text-xs text-muted-foreground">No other milestones yet.</p>}
                </div>
                {form.hard_prerequisite ? (
                  <p className="text-[11px] text-muted-foreground">Unmet prerequisites LOCK this milestone for students.</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Unmet prerequisites are shown as recommendations only.</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox
                    id="hard-prereq"
                    checked={form.hard_prerequisite}
                    onCheckedChange={(v) => setForm({ ...form, hard_prerequisite: v === true })}
                  />
                  <Label htmlFor="hard-prereq" className="text-sm font-normal">Hard prerequisites (lock until met)</Label>
                </div>
              </div>
              <DialogFooter className="sm:col-span-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending || form.title.trim().length < 3}>Save milestone</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
