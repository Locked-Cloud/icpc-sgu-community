import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BadgeCheck, ExternalLink, Hand, MousePointerClick } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { Problem, ProblemCompletion, ProblemSheet, ProblemSheetItem } from "@/types";

export default function SheetDetailPage() {
  const { sheetId } = useParams<{ sheetId: string }>();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sheet", sheetId, profile?.id],
    enabled: !!sheetId && !!profile,
    queryFn: async () => {
      const { data: sheet, error: sErr } = await supabase
        .from("problem_sheets")
        .select("*")
        .eq("id", sheetId!)
        .maybeSingle();
      if (sErr) throw sErr;
      if (!sheet) throw new Error("Sheet not found or not published.");

      const { data: items } = await supabase
        .from("problem_sheet_items")
        .select("*, problem:problems(*)")
        .eq("sheet_id", sheetId!)
        .order("sort_order");

      const problemIds = ((items ?? []) as ProblemSheetItem[]).map((i) => i.problem_id);
      const { data: completions } = problemIds.length
        ? await supabase
            .from("problem_completions")
            .select("*")
            .eq("user_id", profile!.id)
            .in("problem_id", problemIds)
        : { data: [] as ProblemCompletion[] };

      const byProblem = new Map(
        ((completions ?? []) as ProblemCompletion[]).map((c) => [c.problem_id, c]),
      );

      return {
        sheet: sheet as ProblemSheet,
        rows: ((items ?? []) as (ProblemSheetItem & { problem?: Problem })[]).map((i) => ({
          ...i,
          completion: byProblem.get(i.problem_id) ?? null,
        })),
      };
    },
  });

  const toggle = async (problemId: string, completed: boolean) => {
    const { error } = await supabase.rpc("toggle_problem_completion", {
      p_problem_id: problemId,
      p_completed: !completed,
    });
    if (error) return toast.error(errMsg(error));
    void qc.invalidateQueries({ queryKey: ["sheet", sheetId] });
    void qc.invalidateQueries({ queryKey: ["sheets"] });
    void qc.invalidateQueries({ queryKey: ["skill-map"] });
  };

  if (isLoading) return (
    <>
      <PageHeader title="Problem sheet" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const { sheet, rows } = data!;
  const solved = rows.filter((r) => r.completion).length;
  const verified = rows.filter((r) => r.completion?.source === "codeforces").length;

  return (
    <>
      <PageHeader
        title={sheet.title}
        description={sheet.description ?? undefined}
        actions={
          <Button variant="outline" asChild>
            <Link to="/sheets"><ArrowLeft /> All sheets</Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary" className="capitalize">{sheet.difficulty}</Badge>
        <span>{solved}/{rows.length} solved</span>
        {verified > 0 && <span className="inline-flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5 text-success" />{verified} verified from Codeforces</span>}
        {sheet.deadline && <span>· Deadline {formatDate(sheet.deadline)}</span>}
      </div>
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: rows.length ? `${(solved / rows.length) * 100}%` : "0%" }} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Problem</TableHead>
                <TableHead className="w-20">Rating</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-24">Link</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const c = r.completion;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="max-w-72 truncate font-medium">
                      {r.problem?.title ?? r.problem_id}
                    </TableCell>
                    <TableCell>{r.problem?.rating ?? "—"}</TableCell>
                    <TableCell>
                      {c ? (
                        <Badge variant={c.source === "codeforces" ? "success" : "secondary"} className="gap-1">
                          {c.source === "codeforces" ? <BadgeCheck className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
                          {c.source === "codeforces" ? "Verified" : "Manual"}
                        </Badge>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void toggle(r.problem_id, false)}>
                          <MousePointerClick className="h-3 w-3" /> Mark solved
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.problem?.url && (
                        <a href={r.problem.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          Solve <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        Manual marks are self-reported. “Verified” means an accepted submission for that exact
        problem was found on your linked Codeforces account. Codeforces-verified problems cannot be
        unmarked manually.
      </p>
    </>
  );
}
