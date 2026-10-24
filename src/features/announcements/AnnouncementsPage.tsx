import { useQuery } from "@tanstack/react-query";
import { Megaphone, Pin } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Announcement } from "@/types";

export default function AnnouncementsPage() {
  const { profile } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["announcements", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });

  if (isLoading) return (
    <>
      <PageHeader title="Announcements" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <>
        <PageHeader title="Announcements" />
        <EmptyState icon={Megaphone} title="No announcements yet" description="Community announcements will appear here." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Announcements" />
      <div className="max-w-3xl space-y-4">
        {data.map((a) => (
          <Card key={a.id} className={a.priority === "critical" ? "border-destructive/40" : a.priority === "important" ? "border-warning/40" : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {a.priority !== "normal" && <Pin className="h-4 w-4 text-warning" />}
                {a.title}
                <Badge variant={a.priority === "critical" ? "destructive" : a.priority === "important" ? "warning" : "secondary"}>
                  {a.priority}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{a.published_at ? formatDateTime(a.published_at) : ""}</p>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
