import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, CornerUpLeft, MessageSquare, Pin, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { useMyTeam, fetchProfiles } from "@/features/teams/api";
import { cn, formatTime, initials, timeAgo } from "@/lib/utils";
import { PageHeader, EmptyState, ErrorState } from "@/components/shared/PageComponents";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Message, TeamConversation } from "@/types";

const PAGE_SIZE = 50;

export default function TeamChatPage() {
  const { profile, isAdmin } = useAuth();
  const { data: teamData, isLoading: teamLoading, error: teamError } = useMyTeam();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string | null>(null);

  const team = teamData?.team ?? null;
  const isMember = teamData?.members.some(
    (m) => m.student_id === profile?.id && m.status === "active",
  );

  const { data: chat, isLoading, error, refetch } = useQuery({
    queryKey: ["team-chat", team?.id],
    enabled: !!team && (isMember || isAdmin),
    queryFn: async () => {
      const { data: conv, error: convErr } = await supabase
        .from("team_conversations")
        .select("*")
        .eq("team_id", team!.id)
        .maybeSingle();
      if (convErr) throw convErr;
      if (!conv) throw new Error("Team conversation not found");

      const { data: messages, error: msgErr } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (msgErr) throw msgErr;

      const rows = ((messages ?? []) as Message[]).reverse();
      const profiles = await fetchProfiles(rows.map((m) => m.sender_id).filter(Boolean) as string[]);
      return {
        conversation: conv as TeamConversation,
        messages: rows.map((m) => ({
          ...m,
          sender: m.sender_id ? profiles[m.sender_id] : null,
        })),
        hasMore: rows.length === PAGE_SIZE,
      };
    },
  });

  const conversationId = chat?.conversation.id ?? null;
  conversationIdRef.current = conversationId;

  // Realtime inserts
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["team-chat", team?.id] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, qc, team?.id]);

  // Mark read when viewing
  const markRead = useCallback(async () => {
    if (!conversationId) return;
    await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
  }, [conversationId]);

  useEffect(() => {
    void markRead();
  }, [markRead, chat?.messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || !conversationId) return;
    setSending(true);
    const { error: e } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: profile?.id,
      body,
      kind: "user",
      reply_to_id: replyTo?.id ?? null,
    });
    setSending(false);
    if (e) {
      toast.error(errMsg(e));
      return;
    }
    setText("");
    setReplyTo(null);
  };

  const loadOlder = async () => {
    if (!conversationId || !chat || chat.messages.length === 0) return;
    const oldest = chat.messages[0]!;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (data && data.length > 0) {
      qc.setQueryData(["team-chat", team?.id], (old: typeof chat) => {
        if (!old) return old;
        const rows = (data as Message[]).reverse();
        return { ...old, messages: [...rows, ...old.messages], hasMore: data.length === PAGE_SIZE };
      });
    }
  };

  const pinToggle = async (m: Message) => {
    const { error: e } = await supabase.rpc("toggle_pin_message", { p_message_id: m.id });
    if (e) return toast.error(errMsg(e));
    void qc.invalidateQueries({ queryKey: ["team-chat", team?.id] });
  };

  const moderate = async (m: Message) => {
    const { error: e } = await supabase.rpc("admin_delete_message", { p_message_id: m.id });
    if (e) return toast.error(errMsg(e));
    toast.success("Message removed");
    void qc.invalidateQueries({ queryKey: ["team-chat", team?.id] });
  };

  if (teamLoading) return (
    <>
      <PageHeader title="Team Chat" />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </>
  );
  if (teamError) return <ErrorState message={errMsg(teamError)} onRetry={() => void refetch()} />;
  if (!team) {
    return (
      <>
        <PageHeader title="Team Chat" />
        <EmptyState
          icon={MessageSquare}
          title="Chat is available to teams"
          description="Join or register a team to get access to its private conversation."
          action={<Button asChild><Link to="/team">Go to My Team</Link></Button>}
        />
      </>
    );
  }
  if (!isMember && !isAdmin) {
    return (
      <>
        <PageHeader title="Team Chat" />
        <EmptyState
          icon={MessageSquare}
          title="Confirm your membership first"
          description="Chat access is granted to active team members."
          action={<Button asChild><Link to="/team">Go to My Team</Link></Button>}
        />
      </>
    );
  }
  if (isLoading) return (
    <>
      <PageHeader title="Team Chat" />
      <p className="text-sm text-muted-foreground">Loading conversation…</p>
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;

  const visible = searchOpen && search.trim()
    ? chat!.messages.filter((m) => m.body.toLowerCase().includes(search.trim().toLowerCase()))
    : chat!.messages;
  const pinned = chat!.messages.filter((m) => m.pinned && !m.deleted_at);

  return (
    <>
      <PageHeader
        title={`Team Chat — ${team.name}`}
        description="Private to your team. Administrators can moderate this conversation."
        actions={
          <Button variant="outline" size="sm" onClick={() => { setSearchOpen(!searchOpen); setSearch(""); }}>
            <Search /> {searchOpen ? "Hide search" : "Search"}
          </Button>
        }
      />

      {pinned.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {pinned.map((m) => (
            <div key={m.id} className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 truncate">{m.body}</p>
            </div>
          ))}
        </div>
      )}

      {searchOpen && (
        <Input
          className="mb-3"
          placeholder="Search messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      )}

      <Card className="flex h-[65vh] flex-col overflow-hidden">
        {chat!.hasMore && !searchOpen && (
          <Button variant="ghost" size="sm" className="m-2 mx-auto h-7 text-xs" onClick={() => void loadOlder()}>
            <ArrowUp /> Load older messages
          </Button>
        )}
        <ScrollArea className="flex-1 px-4">
          <div className="space-y-3 py-4">
            {visible.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {searchOpen ? "No matching messages." : "No messages yet — say hello to your team!"}
              </p>
            )}
            {visible.map((m) => {
              if (m.kind === "system") {
                return (
                  <p key={m.id} className="text-center text-xs text-muted-foreground">
                    — {m.body} · {timeAgo(m.created_at)} —
                  </p>
                );
              }
              const isOwn = m.sender_id === profile?.id;
              const isLeader = team.leader_id === m.sender_id;
              const replyTarget = m.reply_to_id
                ? chat!.messages.find((x) => x.id === m.reply_to_id)
                : null;
              return (
                <div key={m.id} className={cn("flex gap-2", isOwn && "flex-row-reverse")}>
                  <Avatar className="h-7 w-7 shrink-0">
                    {m.sender?.avatar_url ? <AvatarImage src={m.sender.avatar_url} /> : null}
                    <AvatarFallback className="text-[10px]">
                      {initials(m.sender?.full_name_en ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                  <div className={cn("max-w-[75%] space-y-0.5", isOwn && "items-end text-right")}>
                    <p className="text-[11px] text-muted-foreground">
                      {isOwn ? "You" : m.sender?.full_name_en ?? "Unknown"}
                      {isLeader && " · leader"} · {formatTime(m.created_at)}
                      {m.edited_at && " · edited"}
                    </p>
                    <div
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-sm",
                        isOwn ? "bg-primary text-primary-foreground" : "bg-muted",
                        m.deleted_at && "italic opacity-60",
                      )}
                    >
                      {replyTarget && (
                        <p className={cn("mb-1 truncate border-l-2 pl-2 text-xs", isOwn ? "border-primary-foreground/40 opacity-80" : "border-primary/40 text-muted-foreground")}>
                          ↩ {replyTarget.body}
                        </p>
                      )}
                      {m.deleted_at ? <span className="text-xs">message removed</span> : m.body}
                    </div>
                    <div className={cn("flex gap-1 text-[10px] text-muted-foreground", isOwn && "justify-end")}>
                      <button className="hover:text-foreground" onClick={() => setReplyTo(m)}>
                        <CornerUpLeft className="inline h-3 w-3" /> reply
                      </button>
                      {m.pinned && <span className="text-primary">pinned</span>}
                    </div>
                  </div>
                  {!isOwn && (
                    <div className="flex flex-col gap-1 self-center">
                      {(team.leader_id === profile?.id || isAdmin) && !m.deleted_at && (
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          onClick={() => void pinToggle(m)}
                          title={m.pinned ? "Unpin" : "Pin"}
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                      )}
                      {isAdmin && !m.deleted_at && (
                        <button
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void moderate(m)}
                          title="Remove (moderation)"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {replyTo && (
          <div className="flex items-center gap-2 border-t bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
            Replying to “{replyTo.body.slice(0, 60)}”
            <button className="ml-auto hover:text-foreground" onClick={() => setReplyTo(null)}>×</button>
          </div>
        )}
        <div className="flex gap-2 border-t p-3">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Write a message…"
            maxLength={2000}
          />
          <Button size="icon" onClick={() => void send()} disabled={sending || !text.trim()}>
            <Send />
          </Button>
        </div>
      </Card>
    </>
  );
}
