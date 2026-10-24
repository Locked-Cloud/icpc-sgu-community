import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Send } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { submissionSchema, type SubmissionValues } from "@/lib/validation";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Assignment, AssignmentSubmission } from "@/types";

export default function AssignmentDetailPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["assignment", assignmentId, profile?.id],
    enabled: !!assignmentId && !!profile,
    queryFn: async () => {
      const { data: assignment, error: aErr } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", assignmentId!)
        .maybeSingle();
      if (aErr) throw aErr;
      if (!assignment) throw new Error("Assignment not found.");

      const { data: myTeam } = await supabase
        .from("team_members")
        .select("team_id")
        .eq("student_id", profile!.id)
        .eq("status", "active")
        .maybeSingle();

      const { data: submissions } = await supabase
        .from("assignment_submissions")
        .select("*")
        .eq("assignment_id", assignmentId!)
        .or(`student_id.eq.${profile!.id}${myTeam?.team_id ? `,team_id.eq.${myTeam.team_id}` : ""}`)
        .order("submitted_at", { ascending: false });

      return {
        assignment: assignment as Assignment,
        submission: ((submissions ?? []) as AssignmentSubmission[])[0] ?? null,
      };
    },
  });

  const form = useForm<SubmissionValues>({
    resolver: zodResolver(submissionSchema),
    defaultValues: { content_url: "", notes: "" },
  });

  useEffect(() => {
    if (data?.submission) {
      form.reset({
        content_url: data.submission.content_url ?? "",
        notes: data.submission.notes ?? "",
      });
    }
  }, [data?.submission, form]);

  const submit = useMutation({
    mutationFn: async (values: SubmissionValues) => {
      const { error } = await supabase.rpc("submit_assignment", {
        p_assignment_id: assignmentId,
        p_content_url: values.content_url || null,
        p_notes: values.notes || null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Submission saved");
      void qc.invalidateQueries({ queryKey: ["assignment", assignmentId] });
      void qc.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Assignment" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const { assignment: a, submission } = data!;
  const overdue = a.due_at && new Date(a.due_at) < new Date();

  return (
    <>
      <PageHeader
        title={a.title}
        description={a.description ?? undefined}
        actions={
          <Button variant="outline" asChild>
            <Link to="/assignments"><ArrowLeft /> All assignments</Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge variant="secondary">{a.mode === "team" ? "Team submission" : "Individual"}</Badge>
        {a.due_at && (
          <Badge variant={overdue ? "destructive" : "info"}>Due {formatDateTime(a.due_at)}</Badge>
        )}
        {a.max_score && <Badge variant="outline">Max score: {a.max_score}</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {a.instructions && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Instructions</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.instructions}</p>
              </CardContent>
            </Card>
          )}
          {a.problem_url && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Problem</CardTitle></CardHeader>
              <CardContent>
                <a href={a.problem_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  Open problem <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </CardContent>
            </Card>
          )}
          {a.attachments.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Attachments</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {a.attachments.map((att) => (
                  <a key={att.url} href={att.url} target="_blank" rel="noreferrer" className="block text-sm text-primary hover:underline">
                    {att.name}
                  </a>
                ))}
              </CardContent>
            </Card>
          )}
          {a.topics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {a.topics.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {submission && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Your submission</CardTitle>
                <CardDescription>
                  Submitted {formatDateTime(submission.submitted_at)} · Status:{" "}
                  <Badge variant={submission.status === "accepted" ? "success" : submission.status === "needs_improvement" ? "warning" : "secondary"}>
                    {submission.status.replace("_", " ")}
                  </Badge>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {submission.content_url && (
                  <a href={submission.content_url} target="_blank" rel="noreferrer" className="block truncate text-primary hover:underline">
                    {submission.content_url}
                  </a>
                )}
                {submission.score != null && <p>Score: <span className="font-semibold">{submission.score}</span></p>}
                {submission.feedback && (
                  <div className="rounded-md bg-muted p-3">
                    <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Feedback</p>
                    <p className="whitespace-pre-wrap">{submission.feedback}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{submission ? "Update submission" : "Submit solution"}</CardTitle>
              <CardDescription>
                {a.submission_requirements ?? "Submit a link to your solution, repository, or Codeforces submissions."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} className="space-y-4" noValidate>
                  <FormField
                    control={form.control}
                    name="content_url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Solution link</FormLabel>
                        <FormControl>
                          <Input placeholder="https://…" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes (optional)</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Anything the reviewers should know…" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={submit.isPending}>
                    <Send /> {submission ? "Update submission" : "Submit"}
                  </Button>
                  {overdue && <p className="text-xs text-warning">The deadline has passed — your submission will be marked late.</p>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
