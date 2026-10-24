import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CalendarDays, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrainingWeek } from "@/types";

export function useTrainingWeeks() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["training-weeks", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_weeks")
        .select("*, resources:training_resources(*)")
        .neq("status", "archived")
        .order("week_number");
      if (error) throw error;

      const weeks = (data ?? []) as unknown as (TrainingWeek & { resources?: { id: string; visible: boolean }[] })[];
      const visibleWeeks = weeks.filter((w) => w.status === "published");

      const { data: completions } = await supabase
        .from("material_completions")
        .select("resource_id");
      const done = new Set(((completions ?? []) as { resource_id: string }[]).map((c) => c.resource_id));

      return visibleWeeks.map((w) => {
        const res = (w.resources ?? []).filter((r) => r.visible);
        return {
          ...w,
          resources: w.resources,
          completedCount: res.filter((r) => done.has(r.id)).length,
          totalCount: res.length,
          isCurrent:
            w.start_date && w.end_date &&
            new Date(w.start_date) <= new Date() && new Date() <= new Date(w.end_date),
        };
      });
    },
  });
}

export default function TrainingListPage() {
  const { data, isLoading, error, refetch } = useTrainingWeeks();

  if (isLoading) return (
    <>
      <PageHeader title="Training" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <>
        <PageHeader title="Training" />
        <EmptyState
          icon={BookOpen}
          title="No published training weeks yet"
          description="Materials appear here as soon as the administrators publish them."
        />
      </>
    );
  }

  const current = data.find((w) => w.isCurrent);

  return (
    <>
      <PageHeader
        title="Training"
        description="Weekly materials, resources and practice — follow the timeline week by week."
      />

      {current && (
        <Card className="mb-6 border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-primary" /> Current week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link to={`/training/${current.id}`} className="flex items-center justify-between gap-2 hover:underline">
              <span className="font-medium">Week {current.week_number} — {current.title}</span>
              <Badge variant="info">Open</Badge>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="relative space-y-4 border-l pl-6">
        {data.map((w) => (
          <div key={w.id} className="relative">
            <span className="absolute -left-[31px] top-5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary bg-background">
              {w.completedCount === w.totalCount && w.totalCount > 0 && (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              )}
            </span>
            <Link to={`/training/${w.id}`} className="block">
              <Card className="transition-colors hover:border-primary/50">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">Week {w.week_number} — {w.title}</CardTitle>
                    {w.isCurrent && <Badge variant="info">Current</Badge>}
                    {w.completedCount === w.totalCount && w.totalCount > 0 && (
                      <Badge variant="success">Completed</Badge>
                    )}
                  </div>
                  <CardDescription className="line-clamp-2">{w.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {w.start_date && <span>{formatDate(w.start_date)} → {formatDate(w.end_date)}</span>}
                  <span>{w.totalCount} resource{w.totalCount !== 1 ? "s" : ""}</span>
                  <span>{w.completedCount}/{w.totalCount} completed</span>
                </CardContent>
              </Card>
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
