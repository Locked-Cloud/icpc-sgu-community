import { useQuery } from "@tanstack/react-query";
import { Brain } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { TOPIC_COLORS } from "@/lib/constants";
import { PageHeader, ErrorState, LoadingRows, StatCard } from "@/components/shared/PageComponents";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface TopicAnalytics {
  topics: { slug: string; name: string; problems: number; completions: number; students_completed: number }[];
  sheets: { id: string; title: string; problems: number; avg_completion: number | null }[];
}

export default function AdminSkillsPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-skills"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_topic_analytics");
      if (error) throw error;
      return data as TopicAnalytics;
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Skill Analytics" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;
  if (!data) return <ErrorState message="No data." />;

  const topics = data.topics.filter((t) => t.problems > 0);
  const weak = [...topics].filter((t) => t.problems >= 3).sort((a, b) =>
    (a.completions / Math.max(a.problems, 1)) - (b.completions / Math.max(b.problems, 1)),
  ).slice(0, 5);

  return (
    <>
      <PageHeader
        title="Skill Analytics"
        description="Cohort-level topic progress from real completion records. Individual weakness data stays private."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Topics with problems" value={topics.length} icon={Brain} />
        <StatCard label="Total tracked problems" value={topics.reduce((s, t) => s + t.problems, 0)} />
        <StatCard label="Published sheets" value={data.sheets.length} />
      </div>

      {weak.length > 0 && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Topics recommended for future sessions</CardTitle>
            <CardDescription>Lowest cohort completion where problems are assigned.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {weak.map((t) => (
              <span key={t.slug} className="rounded-full bg-muted px-3 py-1 text-xs">
                {t.name} · {t.completions}/{t.problems}
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Topic completion</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {topics.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No problems tracked yet.</p>
            ) : (
              topics.map((t, i) => (
                <div key={t.slug}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2 truncate">
                      <span className="h-2 w-2 rounded-full" style={{ background: TOPIC_COLORS[i % TOPIC_COLORS.length] }} />
                      {t.name}
                    </span>
                    <span className="text-muted-foreground">
                      {t.completions} completions · {t.students_completed} students
                    </span>
                  </div>
                  <Progress value={Math.min((t.completions / Math.max(t.problems, 1)) * 100, 100)} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Sheet completion rates</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sheet</TableHead>
                  <TableHead>Problems</TableHead>
                  <TableHead>Avg completion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sheets.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="max-w-56 truncate">{s.title}</TableCell>
                    <TableCell>{s.problems}</TableCell>
                    <TableCell>{s.avg_completion != null ? `${Math.round(s.avg_completion * 100)}%` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
