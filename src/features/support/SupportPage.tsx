import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { LifeBuoy, MessageSquarePlus, Send } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { fetchProfiles } from "@/features/teams/api";
import { supportRequestSchema } from "@/lib/validation";
import { timeAgo } from "@/lib/utils";
import { PageHeader, EmptyState, LoadingRows } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SupportReply, SupportRequest } from "@/types";

export default function SupportPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["support", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_requests")
        .select("*, replies:support_replies(*)")
        .eq("student_id", profile!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as (SupportRequest & { replies: SupportReply[] })[];
      const profiles = await fetchProfiles(rows.flatMap((r) => r.replies.map((x) => x.author_id)));
      return rows.map((r) => ({
        ...r,
        replies: r.replies
          .map((x) => ({ ...x, author: profiles[x.author_id] }))
          .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      }));
    },
  });

  const form = useForm({
    resolver: zodResolver(supportRequestSchema),
    defaultValues: { subject: "", category: "other" as const, description: "" },
  });

  const create = useMutation({
    mutationFn: async (values: { subject: string; category: string; description: string }) => {
      const { error } = await supabase.from("support_requests").insert({
        student_id: profile!.id,
        subject: values.subject,
        category: values.category,
        description: values.description,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Support request submitted");
      setOpen(false);
      form.reset();
      void qc.invalidateQueries({ queryKey: ["support"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reply = useMutation({
    mutationFn: async () => {
      if (!replyTo || !replyText.trim()) throw new Error("Write a reply first");
      const { error } = await supabase.from("support_replies").insert({
        request_id: replyTo,
        author_id: profile!.id,
        body: replyText.trim(),
        internal: false,
      });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      setReplyText("");
      setReplyTo(null);
      void qc.invalidateQueries({ queryKey: ["support"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Support" />
      <LoadingRows />
    </>
  );

  const requests = data ?? [];

  return (
    <>
      <PageHeader
        title="Support"
        description="Private requests visible only to you and the administrators."
        actions={<Button onClick={() => setOpen(true)}><MessageSquarePlus /> New request</Button>}
      />

      {requests.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title="No support requests"
          description="If you face any issue — account, team, training or technical — submit a private request."
        />
      ) : (
        <div className="max-w-3xl space-y-4">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {r.subject}
                  <Badge variant={
                    r.status === "resolved" ? "success" :
                    r.status === "closed" ? "muted" :
                    r.status === "in_progress" ? "warning" : "secondary"
                  }>
                    {r.status.replace("_", " ")}
                  </Badge>
                  <Badge variant="outline">{r.category}</Badge>
                </CardTitle>
                <CardDescription>{timeAgo(r.created_at)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.description}</p>
                {r.replies.length > 0 && (
                  <div className="space-y-2 border-t pt-3">
                    {r.replies.map((x) => (
                      <div key={x.id} className="rounded-lg bg-muted/50 p-3 text-sm">
                        <p className="mb-1 text-xs text-muted-foreground">
                          {x.author?.full_name_en ?? "Support"} · {timeAgo(x.created_at)}
                        </p>
                        <p className="whitespace-pre-wrap">{x.body}</p>
                      </div>
                    ))}
                  </div>
                )}
                {r.status !== "closed" && (
                  replyTo === r.id ? (
                    <div className="flex gap-2">
                      <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Write a reply…" />
                      <Button size="sm" onClick={() => reply.mutate()} disabled={reply.isPending}><Send /></Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setReplyTo(r.id)}>Reply</Button>
                  )
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New support request</DialogTitle>
            <DialogDescription>Your request is private — only administrators can see it.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject</FormLabel>
                    <FormControl><Input placeholder="Short summary" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <select className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" {...field}>
                        <option value="account">Account</option>
                        <option value="team">Team</option>
                        <option value="training">Training</option>
                        <option value="technical">Technical</option>
                        <option value="other">Other</option>
                      </select>
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Textarea rows={4} placeholder="Describe the issue in detail…" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={create.isPending}>Submit</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
