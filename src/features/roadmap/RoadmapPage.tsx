import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Lock, Map as MapIcon, CheckCircle2, Circle, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { RoadmapMilestoneProgress } from "@/types";

export default function RoadmapPage() {
  const { profile } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["roadmap", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("roadmap_progress_for");
      if (error) throw error;
      return (data ?? []) as RoadmapMilestoneProgress[];
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Training Roadmap" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const milestones = (data ?? []).filter((m) => !m.is_draft);
  if (milestones.length === 0) {
    return (
      <>
        <PageHeader title="Training Roadmap" />
        <EmptyState
          icon={MapIcon}
          title="The roadmap is being prepared"
          description="Milestones will appear here once the administrators publish the training roadmap."
        />
      </>
    );
  }

  const completed = milestones.filter((m) => m.status === "completed").length;
  const next = milestones.find((m) => m.status !== "completed" && m.status !== "locked");

  return (
    <>
      <PageHeader
        title="Training Roadmap"
        description={`${completed} of ${milestones.length} milestones completed. Progress is computed from your real records — materials, problems and submissions.`}
      />

      {next && (
        <Card className="mb-6 border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Next up</p>
              <p className="font-medium">{next.title}</p>
              <p className="text-xs text-muted-foreground">
                {next.target_date && `Target: ${formatDate(next.target_date)} · `}
                status: {next.status.replace("_", " ")}
              </p>
            </div>
            <div className="flex gap-2">
              {next.week_id && <Button size="sm" variant="outline" asChild><Link to={`/training/${next.week_id}`}>Open week</Link></Button>}
              {next.sheet_id && <Button size="sm" variant="outline" asChild><Link to={`/sheets/${next.sheet_id}`}>Open sheet</Link></Button>}
              {next.assignment_id && <Button size="sm" variant="outline" asChild><Link to={`/assignments/${next.assignment_id}`}>Open assignment</Link></Button>}
            </div>
          </CardContent>
        </Card>
      )}

      <Progress value={Math.round((completed / milestones.length) * 100)} className="mb-6" />

      <div className="relative space-y-4 border-l pl-6">
        {milestones.map((m) => {
          const icon =
            m.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-success" /> :
            m.status === "locked" ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> :
            m.status === "in_progress" ? <Clock className="h-4 w-4 text-warning" /> :
            <Circle className="h-4 w-4 text-muted-foreground/50" />;
          return (
            <div key={m.id} className="relative">
              <span className="absolute -left-[31px] top-4 flex h-4 w-4 items-center justify-center rounded-full border-2 border-border bg-background">
                {icon}
              </span>
              <Card className={cn(m.status === "locked" && "opacity-60")}>
                <CardContent className="p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="font-medium">{m.title}</p>
                    <Badge
                      variant={
                        m.status === "completed" ? "success" :
                        m.status === "locked" ? "muted" :
                        m.status === "in_progress" ? "warning" : "secondary"
                      }
                    >
                      {m.status.replace("_", " ")}
                    </Badge>
                    {m.overdue && <Badge variant="destructive">Overdue</Badge>}
                  </div>
                  {m.description && <p className="text-sm text-muted-foreground">{m.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {m.target_date && <span>Target: {formatDate(m.target_date)}</span>}
                    {m.progress.week_ratio != null && (
                      <span>Week materials: {Math.round(m.progress.week_ratio * 100)}%</span>
                    )}
                    {m.progress.sheet_ratio != null && (
                      <span>Sheet problems: {Math.round(m.progress.sheet_ratio * 100)}%</span>
                    )}
                    {m.assignment_id && (
                      <span>Assignment: {m.progress.assignment_done ? "submitted ✓" : "not submitted"}</span>
                    )}
                    {!m.prereqs_met && (
                      <span className="text-warning">
                        {m.hard_prerequisite ? "Locked — complete prerequisites first" : "Prerequisites recommended"}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    {m.week_id && <Button size="sm" variant="ghost" asChild><Link to={`/training/${m.week_id}`}>Week</Link></Button>}
                    {m.sheet_id && <Button size="sm" variant="ghost" asChild><Link to={`/sheets/${m.sheet_id}`}>Sheet</Link></Button>}
                    {m.assignment_id && <Button size="sm" variant="ghost" asChild><Link to={`/assignments/${m.assignment_id}`}>Assignment</Link></Button>}
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </>
  );
}
