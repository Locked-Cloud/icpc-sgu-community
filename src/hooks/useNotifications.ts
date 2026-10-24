import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { Notification } from "@/types";

export function useNotifications() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["notifications", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
    refetchInterval: 60_000,
  });
}

export function useUnreadCount() {
  const { data } = useNotifications();
  return data?.filter((n) => n.read_at == null).length ?? 0;
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, all }: { id?: number; all?: boolean }) => {
      const update: Record<string, unknown> = { read_at: new Date().toISOString() };
      let query = supabase.from("notifications").update(update);
      query = all ? query.is("read_at", null) : query.eq("id", id!);
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** Subscribes to realtime notification inserts for the given user. */
export function useNotificationRealtime(userId: string | undefined, onInsert?: () => void) {
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        () => onInsert?.(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, onInsert]);
}
