import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Pencil, Plus, Users } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { formatDateTime, formatDate } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows } from "@/components/shared/PageComponents";
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
import type { Assignment, AssignmentSubmission } from "@/types";

interface Form {
  id?: string;
  title: string; description: string; instructions: string; topics: string;
  difficulty: string; starts_at: string; due_at: string; max_score: string;
  week_id: string; sheet_id: string; problem_url: string; submission_requirements: string;
  mode: "individual" | "team"; reminder_target: "all" | "leader"; status: string;
}

const EMPTY: Form = {
  title: "", description: "", instructions: "", topics: "", difficulty: "mixed",
  starts_at: "", due_at: "", max_score: "", week_id: "", sheet_id: "", problem_url: "",
  submission_requirements: "", mode: "individual", reminder_target: "all", status: "draft",
};

export default function AdminAssignmentsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [review, setReview] = useState<Assignment | null>(null);
  const [reviewData, setReviewData] = useState<Record<string, { status: string; score: string; feedback: string }>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-assignments"],
    queryFn: async () => {
      const [{ data: assignments }, { data: weeks }, { data: sheets }] = await Promise.all([
        supabase.from("assignments").select("*").order("created_at", { ascending: false }),
        supabase.from("training_weeks").select("id, week_number, title").neq("status", "archived").order("week_number"),
        supabase.from("problem_sheets").select("id, title").neq("status", "archived"),
      ]);
      return {
        assignments: (assignments ?? []) as Assignment[],
        weeks: (weeks ?? []) as { id: string; week_number: number; title: string }[],
        sheets: (sheets ?? []) as { id: string; title: string }[],
      };
    },
  });

  const { data: submissions, refetch: refetchSubs } = useQuery({
    queryKey: ["admin-submissions", review?.id],
    enabled: !!review,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assignment_submissions")
        .select("*")
        .eq("assignment_id", review!.id)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as AssignmentSubmission[];
      const profiles = await fetchProfiles(rows.map((s) => s.student_id));
      return rows.map((s) => ({ ...s, student: profiles[s.student_id] }));
    },
  });

  useEffect(() => {
    if (submissions) {
      const next: typeof reviewData = {};
      for (const s of submissions) {
        next[s.id] = { status: s.status, score: s.score?.toString() ?? "", feedback: s.feedback ?? "" };
      }
      setReviewData(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const payload = {
        title: form.title,
        description: form.description || null,
        instructions: form.instructions || null,
        topics: form.topics.split(",").map((s) => s.trim()).filter(Boolean),
        difficulty: form.difficulty,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        max_score: form.max_score ? Number(form.max_score) : null,
        week_id: form.week_id || null,
        sheet_id: form.sheet_id || null,
        problem_url: form.problem_url || null,
        submission_requirements: form.submission_requirements || null,
        mode: form.mode,
        reminder_target: form.reminder_target,
        status: form.status,
      };
      const { error } = form.id
        ? await supabase.from("assignments").update(payload).eq("id", form.id)
        : await supabase.from("assignments").insert(payload);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Assignment saved — reminders were (re)scheduled automatically");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["admin-assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitReview = useMutation({
    mutationFn: async (submissionId: string) => {
      const r = reviewData[submissionId];
      const { error } = await supabase.rpc("review_submission", {
        p_submission_id: submissionId,
        p_status: r!.status,
        p_score: r!.score ? Number(r!.score) : null,
        p_feedback: r!.feedback || null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Review saved — student notified");
      void refetchSubs();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Assignments" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title="Assignments"
        description="Create assignments — publishing schedules reminder notifications automatically."
        actions={<Button onClick={() => setForm({ ...EMPTY })}><Plus /> New assignment</Button>}
      />

      <div className="space-y-3">
        {(data?.assignments ?? []).map((a) => (
          <Card key={a.id}>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {a.title}
                  <Badge variant={a.status === "published" ? "success" : "secondary"}>{a.status}</Badge>
                  <Badge variant="outline">{a.mode === "team" ? "team" : "individual"}</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.due_at ? `Due ${formatDateTime(a.due_at)}` : "No deadline"}
                  {a.topics.length > 0 && ` · ${a.topics.join(", ")}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setReview(a)}>
                  <Users /> Review
                </Button>
                <Button size="sm" variant="ghost" onClick={() => {
                  const f: Form = {
                    ...EMPTY, id: a.id, title: a.title, description: a.description ?? "",
                    instructions: a.instructions ?? "", topics: a.topics.join(", "),
                    difficulty: a.difficulty ?? "mixed",
                    starts_at: a.starts_at ? a.starts_at.slice(0, 16) : "",
                    due_at: a.due_at ? a.due_at.slice(0, 16) : "",
                    max_score: a.max_score?.toString() ?? "",
                    week_id: a.week_id ?? "", sheet_id: a.sheet_id ?? "",
                    problem_url: a.problem_url ?? "",
                    submission_requirements: a.submission_requirements ?? "",
                    mode: a.mode, reminder_target: a.reminder_target, status: a.status,
                  };
                  setForm(f);
                }}>
                  <Pencil /> Edit
                </Button>
                {a.status !== "published" && (
                  <Button size="sm" onClick={async () => {
                    const { error } = await supabase.from("assignments").update({ status: "published" }).eq("id", a.id);
                    if (error) toast.error(errMsg(error));
                    else { toast.success("Published"); void qc.invalidateQueries({ queryKey: ["admin-assignments"] }); }
                  }}>
                    <Megaphone /> Publish
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Editor */}
      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{form?.id ? "Edit assignment" : "New assignment"}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Title *</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Instructions</Label>
                <Textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Starts at</Label>
                <Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Deadline</Label>
                <Input type="datetime-local" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Max score</Label>
                <Input type="number" value={form.max_score} onChange={(e) => setForm({ ...form, max_score: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Difficulty</Label>
                <Select value={form.difficulty} onValueChange={(v) => setForm({ ...form, difficulty: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["easy", "medium", "hard", "mixed"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select value={form.mode} onValueChange={(v) => setForm({ ...form, mode: v as Form["mode"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="team">Team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Team reminders go to</Label>
                <Select value={form.reminder_target} onValueChange={(v) => setForm({ ...form, reminder_target: v as Form["reminder_target"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All members</SelectItem>
                    <SelectItem value="leader">Leader only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Training week</Label>
                <Select value={form.week_id || "none"} onValueChange={(v) => setForm({ ...form, week_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(data?.weeks ?? []).map((w) => <SelectItem key={w.id} value={w.id}>Week {w.week_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Problem sheet</Label>
                <Select value={form.sheet_id || "none"} onValueChange={(v) => setForm({ ...form, sheet_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(data?.sheets ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Problem URL</Label>
                <Input value={form.problem_url} onChange={(e) => setForm({ ...form, problem_url: e.target.value })} placeholder="https://…" />
              </div>
              <div className="space-y-1.5">
                <Label>Topics (comma separated)</Label>
                <Input value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Submission requirements</Label>
                <Input value={form.submission_requirements} onChange={(e) => setForm({ ...form, submission_requirements: e.target.value })} placeholder="e.g. Submit a link to your Codeforces submissions" />
              </div>
              <DialogFooter className="sm:col-span-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending || form.title.trim().length < 3}>Save</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Review dialog */}
      <Dialog open={!!review} onOpenChange={(v) => !v && setReview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Submissions — {review?.title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {(submissions ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No submissions yet.</p>
            ) : (
              (submissions ?? []).map((s) => {
                const r = reviewData[s.id] ?? { status: s.status, score: "", feedback: "" };
                return (
                  <div key={s.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{s.student?.full_name_en ?? "?"}</p>
                      <Badge variant="secondary">{s.status}</Badge>
                      <span className="text-xs text-muted-foreground">submitted {formatDate(s.submitted_at)}</span>
                      {s.content_url && (
                        <a href={s.content_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">open link</a>
                      )}
                    </div>
                    {s.notes && <p className="mt-1 text-xs italic text-muted-foreground">{s.notes}</p>}
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <Select value={r.status} onValueChange={(v) => setReviewData({ ...reviewData, [s.id]: { ...r, status: v } })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="under_review">Under review</SelectItem>
                          <SelectItem value="accepted">Accepted</SelectItem>
                          <SelectItem value="needs_improvement">Needs improvement</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-8 text-xs" placeholder="Score" type="number"
                        value={r.score}
                        onChange={(e) => setReviewData({ ...reviewData, [s.id]: { ...r, score: e.target.value } })}
                      />
                      <Button size="sm" className="h-8" onClick={() => submitReview.mutate(s.id)}>Save review</Button>
                    </div>
                    <Input
                      className="mt-2 text-xs" placeholder="Feedback to the student…"
                      value={r.feedback}
                      onChange={(e) => setReviewData({ ...reviewData, [s.id]: { ...r, feedback: e.target.value } })}
                    />
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
