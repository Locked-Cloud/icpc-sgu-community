import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Brain, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { TOPIC_COLORS } from "@/lib/constants";
import { PageHeader, ErrorState, LoadingRows, EmptyState, StatCard } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ProblemSheet, Topic } from "@/types";

interface TopicProgress {
  topic: Topic;
  assigned: number;      // problems in published sheets for this topic
  completed: number;     // completions by me (any source)
  verified: number;      // codeforces-verified completions
  ratio: number;
}

export default function SkillMapPage() {
  const { profile } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["skill-map", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const publishedSheetIds = (
        (await supabase.from("problem_sheets").select("id").eq("status", "published")).data ?? []
      ).map((s: { id: string }) => s.id);

      const [topicsRes, sheetItemsRes, completionsRes, sheetsRes] = await Promise.all([
        supabase.from("topics").select("*").eq("active", true).order("sort_order"),
        publishedSheetIds.length > 0
          ? supabase
              .from("problem_sheet_items")
              .select("problem_id, sheet_id, problem:problems(id, topics:problem_topics(topic_id))")
              .in("sheet_id", publishedSheetIds)
          : ({ data: [], error: null } as { data: never[]; error: null }),
        supabase.from("problem_completions").select("*").eq("user_id", profile!.id),
        supabase.from("problem_sheets").select("id, title, status").eq("status", "published"),
      ]);

      const topics = (topicsRes.data ?? []) as Topic[];
      const items = (sheetItemsRes.data ?? []) as unknown as {
        problem_id: string;
        problem?: { id: string; topics?: { topic_id: string }[] } | null;
      }[];
      const completions = (completionsRes.data ?? []) as {
        problem_id: string;
        source: string;
      }[];
      const sheets = (sheetsRes.data ?? []) as ProblemSheet[];

      const completionByProblem = new Map(completions.map((c) => [c.problem_id, c]));

      const progress: TopicProgress[] = topics.map((topic) => {
        const topicProblems = items.filter((i) =>
          (i.problem?.topics ?? []).some((t) => t.topic_id === topic.id),
        );
        const uniqueProblems = new Set(topicProblems.map((i) => i.problem_id));
        const completed = [...uniqueProblems].filter((p) => completionByProblem.has(p));
        const verified = completed.filter((p) => completionByProblem.get(p)!.source === "codeforces");
        return {
          topic,
          assigned: uniqueProblems.size,
          completed: completed.length,
          verified: verified.length,
          ratio: uniqueProblems.size > 0 ? completed.length / uniqueProblems.size : 0,
        };
      });

      return { progress, sheets };
    },
  });

  const weakTopics = useMemo(() => {
    if (!data) return [];
    return data.progress
      .filter((t) => t.assigned >= 3 && t.ratio < 0.5)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 4);
  }, [data]);

  const totalAssigned = data?.progress.reduce((s, t) => s + t.assigned, 0) ?? 0;
  const totalCompleted = data?.progress.reduce((s, t) => s + t.completed, 0) ?? 0;

  if (isLoading) return (
    <>
      <PageHeader title="Skill Map" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title="Skill Map"
        description="Your progress across training topics, built from real completion records. Completion percentage reflects assigned practice finished — it does not prove mastery."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Topics covered" value={data!.progress.filter((t) => t.assigned > 0).length} icon={Brain} />
        <StatCard label="Assigned problems" value={totalAssigned} icon={TrendingUp} />
        <StatCard label="Completed" value={totalCompleted} hint={totalAssigned > 0 ? `${Math.round((totalCompleted / totalAssigned) * 100)}% of assigned` : undefined} />
      </div>

      {weakTopics.length > 0 && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recommended for additional practice</CardTitle>
            <CardDescription>
              Topics where you have assigned problems but less than half completed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {weakTopics.map((t) => (
              <Badge key={t.topic.id} variant="info" className="text-xs">
                {t.topic.name} — {t.completed}/{t.assigned}
              </Badge>
            ))}
            <Button asChild size="sm" variant="outline">
              <Link to="/sheets">Practice now</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {data!.progress.every((t) => t.assigned === 0) ? (
        <EmptyState
          icon={Brain}
          title="No training data yet"
          description="Once problem sheets are published and you start solving, your topic progress will appear here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data!.progress.map((t, i) => (
            <Card key={t.topic.id}>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: TOPIC_COLORS[i % TOPIC_COLORS.length] }}
                    />
                    {t.topic.name}
                  </p>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t.completed}/{t.assigned}
                  </span>
                </div>
                <Progress value={Math.round(t.ratio * 100)} />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t.verified > 0 && `${t.verified} Codeforces-verified · `}
                  {t.assigned === 0 ? "no assigned problems yet" : `${Math.round(t.ratio * 100)}% complete`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
