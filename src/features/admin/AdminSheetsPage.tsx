import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Plus, Upload } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { parseProblemUrl } from "@/lib/cf";
import { formatDate } from "@/lib/utils";
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
import { parseCSV } from "@/lib/csv";
import type { Problem, ProblemSheet, ProblemSheetItem } from "@/types";

export default function AdminSheetsPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [importSheet, setImportSheet] = useState<ProblemSheet | null>(null);
  const [importText, setImportText] = useState("");
  const [newSheet, setNewSheet] = useState({
    title: "", description: "", difficulty: "mixed", status: "draft",
    week_id: "", deadline: "", topics: "",
  });
  const [problemUrl, setProblemUrl] = useState<Record<string, string>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-sheets"],
    queryFn: async () => {
      const [{ data: sheets }, { data: weeks }, { data: topics }] = await Promise.all([
        supabase.from("problem_sheets").select("*").order("created_at", { ascending: false }),
        supabase.from("training_weeks").select("id, week_number, title").neq("status", "archived").order("week_number"),
        supabase.from("topics").select("*").eq("active", true).order("sort_order"),
      ]);
      const sheetRows = (sheets ?? []) as ProblemSheet[];
      let items: (ProblemSheetItem & { problem?: Problem })[] = [];
      if (sheetRows.length > 0) {
        const { data: itemRows } = await supabase
          .from("problem_sheet_items")
          .select("*, problem:problems(*)")
          .in("sheet_id", sheetRows.map((s) => s.id))
          .order("sort_order");
        items = (itemRows ?? []) as unknown as (ProblemSheetItem & { problem?: Problem })[];
      }
      return {
        sheets: sheetRows.map((s) => ({ ...s, items: items.filter((i) => i.sheet_id === s.id) })),
        weeks: (weeks ?? []) as { id: string; week_number: number; title: string }[],
        topics: (topics ?? []) as { id: string; slug: string; name: string }[],
      };
    },
  });

  const createSheet = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("problem_sheets").insert({
        title: newSheet.title,
        description: newSheet.description || null,
        difficulty: newSheet.difficulty,
        status: newSheet.status,
        week_id: newSheet.week_id || null,
        deadline: newSheet.deadline ? new Date(newSheet.deadline).toISOString() : null,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Sheet created");
      setCreateOpen(false);
      setNewSheet({ title: "", description: "", difficulty: "mixed", status: "draft", week_id: "", deadline: "", topics: "" });
      void qc.invalidateQueries({ queryKey: ["admin-sheets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ sheetId, status }: { sheetId: string; status: string }) => {
      const { error } = await supabase.from("problem_sheets").update({ status }).eq("id", sheetId);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Status updated — publishing notifies students");
      void qc.invalidateQueries({ queryKey: ["admin-sheets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addProblem = useMutation({
    mutationFn: async ({ sheet, url }: { sheet: ProblemSheet; url: string }) => {
      const parsed = parseProblemUrl(url);
      if (!parsed) throw new Error("Enter a valid problem URL");
      const title = `Problem ${parsed.externalId}`;

      const { data: existing } = await supabase
        .from("problems")
        .select("id")
        .eq("source", parsed.source)
        .eq("external_id", parsed.externalId)
        .maybeSingle();

      let problemId = existing?.id;
      if (!problemId) {
        const { data: created, error } = await supabase
          .from("problems")
          .insert({ source: parsed.source, external_id: parsed.externalId, title, url })
          .select("id")
          .single();
        if (error) throw new Error(errMsg(error));
        problemId = created!.id;
      }

      const count = (data?.sheets.find((s) => s.id === sheet.id)?.items.length ?? 0) + 1;
      const { error } = await supabase.from("problem_sheet_items").insert({
        sheet_id: sheet.id,
        problem_id: problemId,
        sort_order: count,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Problem added");
      setProblemUrl({});
      void qc.invalidateQueries({ queryKey: ["admin-sheets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from("problem_sheet_items").delete().eq("id", itemId);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-sheets"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const importProblems = useMutation({
    mutationFn: async () => {
      if (!importSheet) return;
      const rows = parseCSV(importText);
      const urls = rows.map((r) => r.url ?? r.URL ?? r["0"] ?? "").filter(Boolean);
      if (urls.length === 0) throw new Error("No problem URLs found — expected a column named url");
      for (const url of urls) {
        await addProblem.mutateAsync({ sheet: importSheet, url });
      }
    },
    onSuccess: () => {
      toast.success("Import finished");
      setImportSheet(null);
      setImportText("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = useMemo(() => {
    const url = Object.values(problemUrl)[0] ?? "";
    return url ? parseProblemUrl(url) : null;
  }, [problemUrl]);

  if (isLoading) return (
    <>
      <PageHeader title="Problem Sheets" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title="Problem Sheets"
        description="Build problem sets — paste Codeforces/AtCoder/CSES links and they are auto-identified."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus /> New sheet</Button>}
      />

      <div className="space-y-4">
        {(data?.sheets ?? []).map((sheet) => (
          <Card key={sheet.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{sheet.title}</p>
                <Badge variant={sheet.status === "published" ? "success" : "secondary"}>{sheet.status}</Badge>
                <Badge variant="outline">{sheet.difficulty}</Badge>
                <span className="text-xs text-muted-foreground">{sheet.items.length} problems</span>
                {sheet.deadline && <span className="text-xs text-muted-foreground">deadline {formatDate(sheet.deadline)}</span>}
              </div>

              {sheet.items.length > 0 && (
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {sheet.items.map((item, i) => (
                    <div key={item.id} className="flex items-center gap-2 text-xs">
                      <span className="w-5 text-muted-foreground">{i + 1}</span>
                      <a href={item.problem?.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">
                        {item.problem?.title ?? item.problem_id}
                      </a>
                      {item.problem?.rating && <Badge variant="outline">{item.problem.rating}</Badge>}
                      <button className="text-muted-foreground hover:text-destructive" onClick={() => removeItem.mutate(item.id)}>×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  className="w-full sm:w-96"
                  placeholder="Paste problem URL (codeforces.com / atcoder.jp / cses.fi)…"
                  value={problemUrl[sheet.id] ?? ""}
                  onChange={(e) => setProblemUrl({ ...problemUrl, [sheet.id]: e.target.value })}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!preview || (preview && problemUrl[sheet.id]?.trim() === "")}
                  onClick={() => addProblem.mutate({ sheet, url: problemUrl[sheet.id] ?? "" })}
                >
                  <Plus /> Add problem
                </Button>
                {sheet.status !== "published" && (
                  <Button size="sm" onClick={() => setStatus.mutate({ sheetId: sheet.id, status: "published" })}>
                    <Megaphone /> Publish
                  </Button>
                )}
                {sheet.status === "published" && (
                  <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ sheetId: sheet.id, status: "draft" })}>
                    Unpublish
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setImportSheet(sheet)}>
                  <Upload /> Bulk import
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New problem sheet</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={newSheet.title} onChange={(e) => setNewSheet({ ...newSheet, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={newSheet.description} onChange={(e) => setNewSheet({ ...newSheet, description: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Difficulty</Label>
                <Select value={newSheet.difficulty} onValueChange={(v) => setNewSheet({ ...newSheet, difficulty: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["easy", "medium", "hard", "mixed"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Training week</Label>
                <Select value={newSheet.week_id || "none"} onValueChange={(v) => setNewSheet({ ...newSheet, week_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(data?.weeks ?? []).map((w) => <SelectItem key={w.id} value={w.id}>Week {w.week_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Deadline (optional)</Label>
                <Input type="datetime-local" value={newSheet.deadline} onChange={(e) => setNewSheet({ ...newSheet, deadline: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Initial status</Label>
                <Select value={newSheet.status} onValueChange={(v) => setNewSheet({ ...newSheet, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createSheet.mutate()} disabled={createSheet.isPending || newSheet.title.trim().length < 3}>
                Create sheet
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!importSheet} onOpenChange={(v) => !v && setImportSheet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk import — {importSheet?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>CSV with a “url” column of problem links (one per row)</Label>
            <Textarea
              rows={8}
              className="font-mono text-xs"
              placeholder={"url\nhttps://codeforces.com/problemset/problem/4/A\nhttps://codeforces.com/problemset/problem/71/A"}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <DialogFooter>
              <Button onClick={() => importProblems.mutate()} disabled={importProblems.isPending}>
                Import
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
