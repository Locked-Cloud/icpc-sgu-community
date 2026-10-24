import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { BadgeCheck, ExternalLink, Link2, RefreshCw, ShieldQuestion, Unlink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { CF_RANK_COLORS, cfProfileUrlSafe } from "@/lib/cf-constants";
import { ratingBands } from "@/lib/cf";
import { formatDate, formatDateTime } from "@/lib/utils";
import { PageHeader, EmptyState, ErrorState, StatCard } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/PageComponents";
import type { CFAccount, CFSnapshot, CFSolved, CFRatingEntry } from "@/types";

export function useCodeforcesData(userId?: string) {
  return useQuery({
    queryKey: ["codeforces", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: account } = await supabase
        .from("codeforces_accounts")
        .select("*")
        .eq("user_id", userId!)
        .maybeSingle();
      if (!account) return null;

      const [snap, history, solved] = await Promise.all([
        supabase.from("codeforces_snapshots").select("*").eq("account_id", account.id).maybeSingle(),
        supabase
          .from("codeforces_rating_history")
          .select("*")
          .eq("account_id", account.id)
          .order("rating_update_at", { ascending: true }),
        supabase.from("codeforces_solved").select("*").eq("account_id", account.id),
      ]);

      return {
        account: account as CFAccount,
        snapshot: snap.data as CFSnapshot | null,
        history: (history.data ?? []) as CFRatingEntry[],
        solved: (solved.data ?? []) as CFSolved[],
      };
    },
  });
}

export default function CodeforcesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useCodeforcesData(profile?.id);
  const [handle, setHandle] = useState("");

  const link = async () => {
    const h = handle.trim();
    if (!h) return;
    const { error: e } = await supabase.rpc("link_codeforces_handle", { p_handle: h });
    if (e) return toast.error(errMsg(e));
    toast.success("Handle linked — data will sync from Codeforces within a few minutes.");
    setHandle("");
    void qc.invalidateQueries({ queryKey: ["codeforces"] });
  };

  const sync = async () => {
    const { error: e } = await supabase.rpc("sync_codeforces");
    if (e) return toast.error(errMsg(e));
    toast.success("Sync requested — results arrive within ~5 minutes.");
    void qc.invalidateQueries({ queryKey: ["codeforces"] });
  };

  const verify = async () => {
    const { data: code, error: e } = await supabase.rpc("start_handle_verification");
    if (e) return toast.error(errMsg(e));
    toast.info(`Set your Codeforces profile's "Last name" to ${code}, then press Sync now.`, {
      duration: 10000,
    });
  };

  const unlink = async () => {
    const { error: e } = await supabase.rpc("unlink_codeforces_handle");
    if (e) return toast.error(errMsg(e));
    toast.success("Handle unlinked");
    void qc.invalidateQueries({ queryKey: ["codeforces"] });
  };

  if (isLoading) return (
    <>
      <PageHeader title="Codeforces" />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  if (!data) {
    return (
      <>
        <PageHeader
          title="Codeforces"
          description="Link your handle to track ratings, contest history and solved problems automatically."
        />
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Link your handle</CardTitle>
            <CardDescription>
              Data is fetched from the official Codeforces API and cached server-side.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="Your Codeforces handle"
              onKeyDown={(e) => e.key === "Enter" && void link()}
            />
            <Button onClick={() => void link()} disabled={!handle.trim()}>
              <Link2 /> Link
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  const { account, snapshot, history, solved } = data;
  const chartData = history.map((h) => ({
    date: formatDate(h.rating_update_at),
    rating: h.new_rating ?? 0,
    name: h.contest_name,
  }));
  const bands = ratingBands(solved);

  return (
    <>
      <PageHeader
        title={`Codeforces — ${account.handle}`}
        description={
          snapshot
            ? `Last synchronized ${formatDateTime(account.last_synced_at ?? snapshot.fetched_at)} (server-cached data).`
            : "First synchronization in progress — data arrives within a few minutes."
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void sync()}>
              <RefreshCw /> Sync now
            </Button>
            {!account.verified && (
              <Button variant="outline" onClick={() => void verify()}>
                <ShieldQuestion /> Verify ownership
              </Button>
            )}
            <ConfirmDialog
              trigger={<Button variant="outline"><Unlink /> Unlink</Button>}
              title="Unlink your Codeforces handle?"
              description="Your statistics history will be removed from the platform."
              actionLabel="Unlink"
              destructive
              onConfirm={() => void unlink()}
            />
          </>
        }
      />

      {account.sync_status === "failed" && (
        <Card className="mb-6 border-destructive/40">
          <CardContent className="p-4 text-sm">
            Last sync failed: {account.last_error ?? "unknown error"}. This can happen if the handle
            does not exist or the Codeforces API is unavailable. Check the spelling and try again.
          </CardContent>
        </Card>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge variant={account.verified ? "success" : "muted"} className="gap-1">
          <BadgeCheck className="h-3 w-3" />
          {account.verified ? "Verified handle" : "Not verified (claimed, not proven)"}
        </Badge>
        <Badge variant="secondary">Sync: {account.sync_status}</Badge>
        <a
          href={cfProfileUrlSafe(account.handle)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Open on Codeforces <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Current rating" value={snapshot?.rating ?? "—"}
          hint={snapshot?.rank ? <span className={CF_RANK_COLORS[snapshot.rank.toLowerCase()] ?? ""}>{snapshot.rank}</span> : undefined} />
        <StatCard label="Max rating" value={snapshot?.max_rating ?? "—"} hint={snapshot?.max_rank ?? undefined} />
        <StatCard label="Contests" value={snapshot?.contests_count ?? history.length} />
        <StatCard label="Unique solved" value={solved.length} hint="deduplicated accepted problems" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rating history</CardTitle>
            <CardDescription>{history.length} rated contests</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length < 2 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Not enough rated contests yet for a chart.
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis domain={["dataMin - 100", "dataMax + 100"]} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <ReTooltip
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
                      labelStyle={{ color: "var(--popover-foreground)" }}
                    />
                    <Line type="monotone" dataKey="rating" stroke="var(--primary)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Solved by rating</CardTitle>
            <CardDescription>Based on cached accepted submissions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {bands.map((b) => {
              const max = Math.max(...bands.map((x) => x.count), 1);
              return (
                <div key={b.band} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-muted-foreground">{b.band}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-primary" style={{ width: `${(b.count / max) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right tabular-nums">{b.count}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Contest history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <EmptyState title="No rated contests yet" description="Participate in rated Codeforces contests to build your history." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contest</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Rank</TableHead>
                  <TableHead>Δ</TableHead>
                  <TableHead>New</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...history].reverse().slice(0, 20).map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="max-w-64 truncate">{h.contest_name}</TableCell>
                    <TableCell>{formatDate(h.rating_update_at)}</TableCell>
                    <TableCell>{h.rank ?? "—"}</TableCell>
                    <TableCell className={(h.new_rating ?? 0) - (h.old_rating ?? 0) >= 0 ? "text-success" : "text-destructive"}>
                      {(h.new_rating ?? 0) - (h.old_rating ?? 0) >= 0 ? "+" : ""}
                      {(h.new_rating ?? 0) - (h.old_rating ?? 0)}
                    </TableCell>
                    <TableCell className="font-medium">{h.new_rating}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
