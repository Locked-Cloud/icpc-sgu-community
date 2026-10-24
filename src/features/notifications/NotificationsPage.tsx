import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { useMarkRead, useNotifications, useNotificationRealtime } from "@/hooks/useNotifications";
import { useAuth } from "@/hooks/useAuth";
import { NOTIFICATION_KIND_LABELS } from "@/lib/constants";
import { cn, timeAgo } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader, EmptyState, LoadingRows } from "@/components/shared/PageComponents";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotificationsPage() {
  const { profile } = useAuth();
  const { data, isLoading } = useNotifications();
  const markRead = useMarkRead();
  const qc = useQueryClient();
  const navigate = useNavigate();

  useNotificationRealtime(profile?.id, () => {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  });

  if (isLoading) return (
    <>
      <PageHeader title="Notifications" />
      <LoadingRows />
    </>
  );

  const notifications = data ?? [];
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread > 0 ? `${unread} unread` : "All caught up"}
        actions={
          unread > 0 ? (
            <Button variant="outline" onClick={() => markRead.mutate({ all: true })}>
              <CheckCheck /> Mark all read
            </Button>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications" description="Team invites, deadlines, contests and announcements will show up here." />
      ) : (
        <div className="max-w-3xl space-y-2">
          {notifications.map((n) => (
            <Card
              key={n.id}
              className={cn("cursor-pointer transition-colors hover:border-primary/40", !n.read_at && "border-primary/40 bg-primary/5")}
              onClick={() => {
                if (!n.read_at) markRead.mutate({ id: n.id });
                if (n.link) navigate(n.link);
              }}
            >
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className={cn("text-sm", !n.read_at && "font-semibold")}>{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {NOTIFICATION_KIND_LABELS[n.kind] ?? n.kind} · {timeAgo(n.created_at)}
                  </p>
                </div>
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
