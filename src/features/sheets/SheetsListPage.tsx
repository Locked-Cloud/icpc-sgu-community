import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileStack } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SheetsListPage() {
  const { profile } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sheets", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: sheets, error } = await supabase
        .from("problem_sheets")
        .select("*")
        .eq("status", "published")
        .order("created_at", { ascending: false });
      if (error) throw error;

      if (!sheets || sheets.length === 0) return [];

      const { data: items } = await supabase
        .from("problem_sheet_items")
        .select("sheet_id, problem_id")
        .in("sheet_id", sheets.map((s) => s.id));
      const { data: completions } = await supabase
        .from("problem_completions")
        .select("problem_id, source")
        .eq("user_id", profile!.id);
      const done = new Set(((completions ?? []) as { problem_id: string }[]).map((c) => c.problem_id));

      return sheets.map((sheet) => {
        const problems = (items ?? []).filter((i) => i.sheet_id === sheet.id);
        const completed = problems.filter((p) => done.has(p.problem_id)).length;
        return {
          sheet,
          total: problems.length,
          completed,
        };
      });
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Problem Sheets" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <>
        <PageHeader title="Problem Sheets" />
        <EmptyState icon={FileStack} title="No sheets published yet" description="Problem sheets appear here once published." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Problem Sheets"
        description="Track your progress through curated problem sets. Solved problems sync automatically from Codeforces."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {data.map(({ sheet, total, completed }) => (
          <Link key={sheet.id} to={`/sheets/${sheet.id}`} className="block">
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{sheet.title}</CardTitle>
                  <Badge variant="secondary" className="capitalize">{sheet.difficulty}</Badge>
                </div>
                {sheet.description && <CardDescription className="line-clamp-2">{sheet.description}</CardDescription>}
              </CardHeader>
              <CardContent>
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{completed}/{total} solved</span>
                  {sheet.deadline && <span>Deadline: {formatDate(sheet.deadline)}</span>}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: total > 0 ? `${(completed / total) * 100}%` : "0%" }}
                  />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
