import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Plus, Trophy, Upload } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { parseCSV } from "@/lib/csv";
import { contestDisplayStatus, CONTEST_DISPLAY_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
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
import type { ContestProblem, VirtualContest } from "@/types";

interface Form {
  id?: string;
  title: string; description: string; starts_at: string; ends_at: string;
  registration_deadline: string; participation: "team" | "individual";
  scoring_mode: "icpc" | "points"; penalty_minutes: number; rules: string;
  external_url: string; status: string;
}

const EMPTY: Form = {
  title: "", description: "", starts_at: "", ends_at: "", registration_deadline: "",
  participation: "team", scoring_mode: "icpc", penalty_minutes: 20, rules: "",
  external_url: "", status: "draft",
};

export default function AdminContestsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [problemsFor, setProblemsFor] = useState<VirtualContest | null>(null);
  const [problem, setProblem] = useState({ code: "", title: "", url: "", points: "" });
  const [resultsFor, setResultsFor] = useState<VirtualContest | null>(null);
  const [resultForm, setResultForm] = useState<Record<string, { solved: boolean; attempts: string; time: string }>>({});
  const [resultParticipant, setResultParticipant] = useState("");
  const [csvText, setCsvText] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-contests"],
    queryFn: async () => {
      const [{ data: contests }, { data: problems }] = await Promise.all([
        supabase.from("virtual_contests").select("*").order("starts_at", { ascending: false }),
        supabase.from("contest_problems").select("*").order("sort_order"),
      ]);
      return {
        contests: (contests ?? []) as VirtualContest[],
        problems: (problems ?? []) as ContestProblem[],
      };
    },
  });

  const { data: registeredTeams } = useQuery({
    queryKey: ["admin-contest-regs", resultsFor?.id],
    enabled: !!resultsFor,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contest_registrations")
        .select("*")
        .eq("contest_id", resultsFor!.id);
      if (error) throw error;
      const regs = (data ?? []) as { id: string; team_id: string | null; student_id: string | null }[];
      const teamIds = regs.map((r) => r.team_id).filter(Boolean) as string[];
      const { data: teams } = teamIds.length
        ? await supabase.from("teams").select("id, name").in("id", teamIds)
        : { data: [] as { id: string; name: string }[] };
      const studentIds = regs.map((r) => r.student_id).filter(Boolean) as string[];
      const profiles = await fetchProfiles(studentIds);
      return regs.map((r) => ({
        ...r,
        label: r.team_id ? (teams as { id: string; name: string }[]).find((t) => t.id === r.team_id)?.name ?? "Team"
          : profiles[r.student_id ?? ""]?.full_name_en ?? "Individual",
      }));
    },
  });

  useEffect(() => {
    if (resultsFor?.id && data) {
      const probs = data.problems.filter((p) => p.contest_id === resultsFor.id);
      const init: typeof resultForm = {};
      for (const p of probs) init[p.code] = { solved: false, attempts: "1", time: "" };
      setResultForm(init);
      const regs = registeredTeams ?? [];
      if (regs.length > 0) {
        setResultParticipant(regs[0]!.team_id ?? regs[0]!.student_id ?? "");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsFor, data, registeredTeams]);

  // when the selected participant changes, load their existing result row (if any)
  useEffect(() => {
    if (!resultsFor || !resultParticipant) return;
    let cancelled = false;
    const load = async () => {
      const { data: result } = await supabase
        .from("contest_results")
        .select("id")
        .eq("contest_id", resultsFor.id)
        .or(`team_id.eq.${resultParticipant},student_id.eq.${resultParticipant}`)
        .maybeSingle();
      if (!result || cancelled) return;
      const { data: rows } = await supabase
        .from("contest_problem_results")
        .select("problem_code, solved, attempts, solve_time_minutes")
        .eq("result_id", result.id);
      if (cancelled || !rows || rows.length === 0) return;
      setResultForm((prev) => {
        const next = { ...prev };
        for (const r of rows as { problem_code: string; solved: boolean; attempts: number; solve_time_minutes: number | null }[]) {
          next[r.problem_code] = {
            solved: r.solved,
            attempts: String(r.attempts ?? 1),
            time: r.solve_time_minutes != null ? String(r.solve_time_minutes) : "",
          };
        }
        return next;
      });
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsFor, resultParticipant]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const payload = {
        title: form.title,
        description: form.description || null,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        registration_deadline: form.registration_deadline ? new Date(form.registration_deadline).toISOString() : null,
        participation: form.participation,
        scoring_mode: form.scoring_mode,
        penalty_minutes: Number(form.penalty_minutes),
        rules: form.rules || null,
        external_url: form.external_url || null,
        status: form.status,
      };
      const { error } = form.id
        ? await supabase.from("virtual_contests").update(payload).eq("id", form.id)
        : await supabase.from("virtual_contests").insert(payload);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Contest saved — announcing (draft→scheduled) notifies all students");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["admin-contests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ contestId, status }: { contestId: string; status: string }) => {
      const { error } = await supabase.from("virtual_contests").update({ status }).eq("id", contestId);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Status updated");
      void qc.invalidateQueries({ queryKey: ["admin-contests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addProblem = useMutation({
    mutationFn: async () => {
      if (!problemsFor) return;
      const count = (data?.problems.filter((p) => p.contest_id === problemsFor.id).length ?? 0) + 1;
      const { error } = await supabase.from("contest_problems").insert({
        contest_id: problemsFor.id,
        code: problem.code.toUpperCase(),
        title: problem.title || null,
        url: problem.url || null,
        points: problem.points ? Number(problem.points) : null,
        sort_order: count,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Problem added");
      setProblem({ code: "", title: "", url: "", points: "" });
      void qc.invalidateQueries({ queryKey: ["admin-contests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveResult = useMutation({
    mutationFn: async () => {
      if (!resultsFor) return;
      const probs = data!.problems.filter((p) => p.contest_id === resultsFor.id);
      const isTeam = registeredTeams?.find((r) => (r.team_id ?? r.student_id) === resultParticipant)?.team_id != null;
      const problems = probs.map((p) => {
        const r = resultForm[p.code] ?? { solved: false, attempts: "1", time: "" };
        return {
          code: p.code,
          solved: r.solved,
          attempts: Number(r.attempts || "0"),
          solve_time_minutes: r.solved && r.time ? Number(r.time) : null,
          points: p.points,
        };
      });
      const { error } = await supabase.rpc("admin_upsert_contest_result_row", {
        p_contest_id: resultsFor.id,
        p_team_id: isTeam ? resultParticipant : null,
        p_student_id: isTeam ? null : resultParticipant,
        p_problems: problems,
        p_source: "manual",
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Result saved");
      void qc.invalidateQueries({ queryKey: ["admin-contests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importCsv = useMutation({
    mutationFn: async () => {
      if (!resultsFor) return;
      const rows = parseCSV(csvText);
      if (rows.length === 0) throw new Error("No rows found");
      const regs = registeredTeams ?? [];
      const payload = rows.map((row) => {
        const label = (row.participant ?? row.team ?? "").trim();
        const reg = regs.find((r) => r.label === label);
        if (!reg) throw new Error(`Unknown participant "${label}" — they must be registered first`);
        const problems: { code: string; solved: boolean; attempts: number; solve_time_minutes: number | null; points: number | null }[] = [];
        for (const [key, value] of Object.entries(row)) {
          const m = key.trim().match(/^([A-Z])$/i);
          if (!m) continue;
          const code = m[1]!.toUpperCase();
          const solved = /^(1|true|yes|solved|✓)$/i.test(value.trim());
          const timeMatch = row[`${code}_time`] ?? "";
          const attemptsMatch = row[`${code}_tries`] ?? "1";
          problems.push({
            code,
            solved,
            attempts: Number(attemptsMatch || "1"),
            solve_time_minutes: solved && timeMatch ? Number(timeMatch) : null,
            points: null,
          });
        }
        return {
          team_id: reg.team_id,
          student_id: reg.student_id,
          problems,
          source: "csv",
        };
      });
      const { data: count, error } = await supabase.rpc("admin_import_contest_results", {
        p_contest_id: resultsFor.id,
        p_rows: payload,
      });
      if (error) throw new Error(errMsg(error));
      return count as number;
    },
    onSuccess: (count) => {
      toast.success(`${count} result row(s) imported`);
      setCsvText("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Virtual Contests" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title="Virtual Contests"
        description="Create contests, manage problem sets, and record results (manual or CSV)."
        actions={<Button onClick={() => setForm({ ...EMPTY })}><Plus /> New contest</Button>}
      />

      <div className="space-y-3">
        {(data?.contests ?? []).map((c) => {
          const display = contestDisplayStatus(c);
          const probs = data!.problems.filter((p) => p.contest_id === c.id);
          return (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{c.title}</p>
                  <Badge variant="secondary">{CONTEST_DISPLAY_LABELS[display]}</Badge>
                  <Badge variant="outline" className="uppercase">{c.scoring_mode}</Badge>
                  <Badge variant="outline">{c.participation}</Badge>
                  <span className="text-xs text-muted-foreground">{probs.length} problems</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(c.starts_at)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setProblemsFor(c)}>
                    <Plus /> Problems ({probs.length})
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setResultsFor(c)}>
                    <Trophy /> Results
                  </Button>
                  {c.status === "draft" && (
                    <Button size="sm" onClick={() => setStatus.mutate({ contestId: c.id, status: "scheduled" })}>
                      <Megaphone /> Announce
                    </Button>
                  )}
                  {new Date(c.ends_at) < new Date() && c.status === "scheduled" && (
                    <Button size="sm" onClick={() => setStatus.mutate({ contestId: c.id, status: "completed" })}>
                      Publish results
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Contest editor */}
      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{form?.id ? "Edit contest" : "New contest"}</DialogTitle></DialogHeader>
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
              <div className="space-y-1.5">
                <Label>Starts at *</Label>
                <Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Ends at *</Label>
                <Input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Registration deadline</Label>
                <Input type="datetime-local" value={form.registration_deadline} onChange={(e) => setForm({ ...form, registration_deadline: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Penalty (minutes)</Label>
                <Input type="number" value={form.penalty_minutes} onChange={(e) => setForm({ ...form, penalty_minutes: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Participation</Label>
                <Select value={form.participation} onValueChange={(v) => setForm({ ...form, participation: v as Form["participation"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">Team</SelectItem>
                    <SelectItem value="individual">Individual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Scoring</Label>
                <Select value={form.scoring_mode} onValueChange={(v) => setForm({ ...form, scoring_mode: v as Form["scoring_mode"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="icpc">ICPC</SelectItem>
                    <SelectItem value="points">Points</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="scheduled">Scheduled (announced)</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>External URL</Label>
                <Input value={form.external_url} onChange={(e) => setForm({ ...form, external_url: e.target.value })} placeholder="https://…" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Rules</Label>
                <Textarea value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} />
              </div>
              <DialogFooter className="sm:col-span-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending || !form.title || !form.starts_at || !form.ends_at}>Save</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Problems editor */}
      <Dialog open={!!problemsFor} onOpenChange={(v) => !v && setProblemsFor(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Problems — {problemsFor?.title}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {(data?.problems ?? []).filter((p) => p.contest_id === problemsFor?.id).map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <Badge variant="secondary" className="font-mono">{p.code}</Badge>
                <span className="min-w-0 flex-1 truncate">{p.title ?? "—"}</span>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    const { error } = await supabase.from("contest_problems").delete().eq("id", p.id);
                    if (error) toast.error(errMsg(error));
                    else void qc.invalidateQueries({ queryKey: ["admin-contests"] });
                  }}
                >×</button>
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Code (A)" maxLength={3} value={problem.code} onChange={(e) => setProblem({ ...problem, code: e.target.value })} />
              <Input placeholder="Title" value={problem.title} onChange={(e) => setProblem({ ...problem, title: e.target.value })} />
              <Input placeholder="Problem URL" value={problem.url} onChange={(e) => setProblem({ ...problem, url: e.target.value })} />
              <Input placeholder="Points (points mode)" type="number" value={problem.points} onChange={(e) => setProblem({ ...problem, points: e.target.value })} />
            </div>
            <Button size="sm" onClick={() => addProblem.mutate()} disabled={!problem.code.trim()}>Add problem</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Results editor */}
      <Dialog open={!!resultsFor} onOpenChange={(v) => !v && setResultsFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Results — {resultsFor?.title}</DialogTitle></DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label>Manual entry</Label>
              <Select value={resultParticipant} onValueChange={setResultParticipant}>
                <SelectTrigger><SelectValue placeholder="Select registered participant…" /></SelectTrigger>
                <SelectContent>
                  {(registeredTeams ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.team_id ?? r.student_id ?? ""}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(data?.problems ?? []).filter((p) => p.contest_id === resultsFor?.id).map((p) => {
                const r = resultForm[p.code] ?? { solved: false, attempts: "1", time: "" };
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary" className="w-8 justify-center font-mono">{p.code}</Badge>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={r.solved}
                        onChange={(e) => setResultForm({ ...resultForm, [p.code]: { ...r, solved: e.target.checked } })}
                      />
                      solved
                    </label>
                    <Input
                      className="h-8 w-20 text-xs" type="number" min="0" placeholder="tries"
                      value={r.attempts}
                      onChange={(e) => setResultForm({ ...resultForm, [p.code]: { ...r, attempts: e.target.value } })}
                    />
                    <Input
                      className="h-8 w-24 text-xs" type="number" min="0" placeholder="min"
                      value={r.time}
                      disabled={!r.solved}
                      onChange={(e) => setResultForm({ ...resultForm, [p.code]: { ...r, time: e.target.value } })}
                    />
                  </div>
                );
              })}
              <Button size="sm" onClick={() => saveResult.mutate()} disabled={!resultParticipant}>
                Save result row
              </Button>
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label className="flex items-center gap-1"><Upload className="h-3.5 w-3.5" /> CSV import</Label>
              <p className="text-[11px] text-muted-foreground">
                Columns: participant (registered team/student name), one column per problem code (A, B, C…) with
                solved flag, and optional A_time / A_tries columns.
              </p>
              <Textarea
                rows={6}
                className="font-mono text-xs"
                placeholder={"participant,A,B,C,A_time,B_time\nTeam Alpha,1,0,1,45,,120"}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={() => importCsv.mutate()} disabled={importCsv.isPending || !csvText.trim()}>
                Import CSV
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
