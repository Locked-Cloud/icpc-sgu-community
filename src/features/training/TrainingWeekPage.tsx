import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Circle, ExternalLink, FileText, Play } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { RESOURCE_KIND_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { TrainingResource, TrainingWeek } from "@/types";

export default function TrainingWeekPage() {
  const { weekId } = useParams<{ weekId: string }>();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["training-week", weekId, profile?.id],
    enabled: !!weekId && !!profile,
    queryFn: async () => {
      const { data: week, error: wErr } = await supabase
        .from("training_weeks")
        .select("*")
        .eq("id", weekId!)
        .maybeSingle();
      if (wErr) throw wErr;
      if (!week) throw new Error("Week not found or not published yet.");

      const { data: resources } = await supabase
        .from("training_resources")
        .select("*")
        .eq("week_id", weekId!)
        .eq("visible", true)
        .order("sort_order");

      const { data: completions } = await supabase
        .from("material_completions")
        .select("resource_id")
        .eq("user_id", profile!.id);
      const done = new Set(((completions ?? []) as { resource_id: string }[]).map((c) => c.resource_id));

      return {
        week: week as TrainingWeek,
        resources: ((resources ?? []) as TrainingResource[]).map((r) => ({ ...r, completed: done.has(r.id) })),
      };
    },
  });

  const toggleComplete = async (resource: TrainingResource & { completed?: boolean }) => {
    if (resource.completed) {
      await supabase
        .from("material_completions")
        .delete()
        .eq("user_id", profile!.id)
        .eq("resource_id", resource.id);
    } else {
      const { error } = await supabase
        .from("material_completions")
        .insert({ user_id: profile!.id, resource_id: resource.id });
      if (error) return toast.error(errMsg(error));
    }
    void qc.invalidateQueries({ queryKey: ["training-week", weekId] });
    void qc.invalidateQueries({ queryKey: ["training-weeks"] });
  };

  if (isLoading) return (
    <>
      <PageHeader title="Training week" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const { week, resources } = data!;
  const completedCount = resources.filter((r) => r.completed).length;

  const signedUrl = async (path: string) => {
    const { data } = await supabase.storage.from("training-resources").createSignedUrl(path, 3600);
    if (data) window.open(data.signedUrl, "_blank");
  };

  return (
    <>
      <PageHeader
        title={`Week ${week.week_number} — ${week.title}`}
        description={week.description ?? undefined}
        actions={
          <Button variant="outline" asChild>
            <Link to="/training"><ArrowLeft /> All weeks</Link>
          </Button>
        }
      />

      {(week.start_date || week.end_date) && (
        <p className="mb-4 text-sm text-muted-foreground">
          {formatDate(week.start_date)} → {formatDate(week.end_date)}
        </p>
      )}

      {week.objectives.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Learning objectives</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {week.objectives.map((o) => <li key={o}>{o}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">Materials</CardTitle>
          <span className="text-xs text-muted-foreground">{completedCount}/{resources.length} completed</span>
        </CardHeader>
        <CardContent>
          <Progress value={resources.length ? (completedCount / resources.length) * 100 : 0} className="mb-4" />
          {resources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No materials attached to this week yet.</p>
          ) : (
            <div className="space-y-2">
              {resources.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <button
                    onClick={() => void toggleComplete(r)}
                    className="shrink-0"
                    aria-label={r.completed ? "Mark as not completed" : "Mark as completed"}
                  >
                    {r.completed ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground/50" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${r.completed ? "text-muted-foreground line-through" : ""}`}>
                      {r.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {RESOURCE_KIND_LABELS[r.kind] ?? r.kind}
                      {r.description ? ` · ${r.description}` : ""}
                    </p>
                  </div>
                  <Badge variant="secondary">{RESOURCE_KIND_LABELS[r.kind] ?? r.kind}</Badge>
                  {r.url ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {["video", "youtube"].includes(r.kind) ? <Play /> : <ExternalLink />} Open
                      </a>
                    </Button>
                  ) : r.storage_path ? (
                    <Button variant="outline" size="sm" onClick={() => void signedUrl(r.storage_path!)}>
                      <FileText /> Open
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {week.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{week.notes}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
