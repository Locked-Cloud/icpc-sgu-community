import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Code2, RefreshCw } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, StatCard, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CFAccount, CFSnapshot } from "@/types";

export default function AdminCodeforcesPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-codeforces"],
    queryFn: async () => {
      const { data: accounts, error } = await supabase
        .from("codeforces_accounts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const accs = (accounts ?? []) as CFAccount[];
      if (accs.length === 0) return { accounts: [], snapshots: [] as (CFSnapshot & { account: CFAccount })[] };

      const { data: snapshots } = await supabase
        .from("codeforces_snapshots")
        .select("*")
        .in("account_id", accs.map((a) => a.id));
      const snaps = (snapshots ?? []) as CFSnapshot[];
      const byAccount = new Map(accs.map((a) => [a.id, a]));
      const withAccounts = snaps.map((s) => ({ ...s, account: byAccount.get(s.account_id)! }));

      const { data: solved } = await supabase.from("codeforces_solved").select("account_id");
      const solvedCounts = new Map<string, number>();
      for (const s of (solved ?? []) as { account_id: string }[]) {
        solvedCounts.set(s.account_id, (solvedCounts.get(s.account_id) ?? 0) + 1);
      }
      return { accounts: accs, snapshots: withAccounts.map((s) => ({ ...s, solvedCount: solvedCounts.get(s.account_id) ?? 0 })) };
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Codeforces Analytics" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const accounts = data?.accounts ?? [];
  const snaps = (data?.snapshots ?? []) as ((CFSnapshot & { account: CFAccount; solvedCount?: number })[]);
  const linked = accounts.length;
  const verified = accounts.filter((a) => a.verified).length;
  const failed = accounts.filter((a) => a.sync_status === "failed");
  const ratings = snaps.map((s) => s.rating).filter((r): r is number => r != null);
  const avg = ratings.length > 0 ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null;

  return (
    <>
      <PageHeader
        title="Codeforces Analytics"
        description="Aggregate, permission-appropriate statistics from cached Codeforces data."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Linked handles" value={linked} icon={Code2} />
        <StatCard label="Verified" value={verified} hint={`${linked - verified} unverified (claimed only)`} />
        <StatCard label="Average rating" value={avg ?? "—"} />
        <StatCard label="Sync failures" value={failed.length} icon={failed.length > 0 ? AlertTriangle : RefreshCw} className={failed.length > 0 ? "border-warning/40" : undefined} />
      </div>

      {failed.length > 0 && (
        <Card className="mb-6 border-warning/40">
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-medium">Recent sync failures</p>
            {failed.slice(0, 5).map((a) => (
              <p key={a.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{a.handle}</span> — {a.last_error ?? "unknown error"} ({formatDateTime(a.updated_at)})
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {linked === 0 ? (
        <EmptyState icon={Code2} title="No linked accounts yet" description="Students can link their Codeforces handles from their profile." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Handle</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Max</TableHead>
                  <TableHead>Contests</TableHead>
                  <TableHead>Solved</TableHead>
                  <TableHead className="hidden md:table-cell">Last sync</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => {
                  const snap = snaps.find((s) => s.account_id === a.id);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.handle}</TableCell>
                      <TableCell>{a.verified ? <Badge variant="success">yes</Badge> : <Badge variant="muted">no</Badge>}</TableCell>
                      <TableCell>{snap?.rating ?? "—"}</TableCell>
                      <TableCell>{snap?.max_rating ?? "—"}</TableCell>
                      <TableCell>{snap?.contests_count ?? 0}</TableCell>
                      <TableCell>{snap?.solvedCount ?? 0}</TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{a.last_synced_at ? formatDateTime(a.last_synced_at) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={a.sync_status === "ok" ? "success" : a.sync_status === "failed" ? "destructive" : "warning"}>
                          {a.sync_status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
