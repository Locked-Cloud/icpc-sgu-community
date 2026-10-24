import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { TEAM_STATUS_LABELS } from "@/lib/constants";
import { cn, formatTime, timeAgo, initials } from "@/lib/utils";
import { PageHeader, ErrorState, LoadingRows, EmptyState } from "@/components/shared/PageComponents";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Message, Team, TeamConversation } from "@/types";

export default function AdminChatsPage() {
  const [teamId, setTeamId] = useState("");
  const [search, setSearch] = useState("");

  const { data: teams, isLoading: teamsLoading, error: teamsError } = useQuery({
    queryKey: ["admin-chats-teams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .neq("status", "archived")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Team[];
    },
  });

  const { data: chat, isLoading: chatLoading, error: chatError } = useQuery({
    queryKey: ["admin-chat", teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const { data: conv, error } = await supabase
        .from("team_conversations")
        .select("*")
        .eq("team_id", teamId)
        .maybeSingle();
      if (error) throw error;
      if (!conv) return null;

      const { data: messages } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", (conv as TeamConversation).id)
        .order("created_at", { ascending: true })
        .limit(300);
      const rows = (messages ?? []) as Message[];
      const profiles = await fetchProfiles(rows.map((m) => m.sender_id).filter(Boolean) as string[]);
      return { conv: conv as TeamConversation, messages: rows.map((m) => ({ ...m, sender: m.sender_id ? profiles[m.sender_id] : null })) };
    },
  });

  const visible = useMemo(() => {
    if (!chat) return [];
    if (!search.trim()) return chat.messages;
    return chat.messages.filter((m) => m.body.toLowerCase().includes(search.trim().toLowerCase()));
  }, [chat, search]);

  if (teamsLoading) return (
    <>
      <PageHeader title="Team Chats" />
      <LoadingRows />
    </>
  );
  if (teamsError) return <ErrorState message={errMsg(teamsError)} />;

  return (
    <>
      <PageHeader
        title="Team Chats"
        description="Administrators can access and moderate every team conversation."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger className="w-full sm:w-80"><SelectValue placeholder="Select a team…" /></SelectTrigger>
          <SelectContent>
            {(teams ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} ({TEAM_STATUS_LABELS[t.status]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {teamId && (
          <Input className="w-full sm:w-64" placeholder="Search in conversation…" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
      </div>

      {!teamId ? (
        <EmptyState icon={MessageSquare} title="Select a team" description="Pick a team above to read its private conversation." />
      ) : chatLoading ? (
        <LoadingRows />
      ) : chatError ? (
        <ErrorState message={errMsg(chatError)} />
      ) : !chat || visible.length === 0 ? (
        <EmptyState title="No messages" description="This team has not exchanged any messages yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="h-[65vh]">
              <div className="space-y-2 p-4">
                {visible.map((m) =>
                  m.kind === "system" ? (
                    <p key={m.id} className="text-center text-xs text-muted-foreground">— {m.body} · {timeAgo(m.created_at)} —</p>
                  ) : (
                    <div key={m.id} className={cn("flex gap-2", m.deleted_at && "opacity-50")}>
                      <Avatar className="h-6 w-6">
                        {m.sender?.avatar_url ? <AvatarImage src={m.sender.avatar_url} /> : null}
                        <AvatarFallback className="text-[9px]">{initials(m.sender?.full_name_en ?? "?")}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground">
                          {m.sender?.full_name_en ?? "?"} · {formatTime(m.created_at)} · {timeAgo(m.created_at)}
                          {m.pinned && <Badge variant="info" className="ml-1 h-4 px-1 text-[9px]">pinned</Badge>}
                        </p>
                        <p className={cn("rounded-lg bg-muted px-3 py-1.5 text-sm", m.deleted_at && "italic")}>
                          {m.deleted_at ? "message removed" : m.body}
                        </p>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </>
  );
}
