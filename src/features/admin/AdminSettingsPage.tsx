import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { supabase, errMsg } from "@/lib/supabase";
import { settingsSchema } from "@/lib/validation";
import { formatDateTime } from "@/lib/utils";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { PageHeader, ErrorState, LoadingRows } from "@/components/shared/PageComponents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CommunitySettings } from "@/types";

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["community-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("community_settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as CommunitySettings;
    },
  });

  const [form, setForm] = useState({
    approval_required: true,
    registration_open: true,
    team_size: 3,
    timezone: "Africa/Cairo",
    reminder_offsets_days: "7, 3, 1",
    send_deadline_reminder: true,
    default_penalty_minutes: 20,
    min_cf_sync_interval_minutes: 30,
    academic_years: "First Year, Second Year, Third Year, Fourth Year, Fifth Year, Graduated",
    programming_languages: "C++, C, Java, Python",
  });

  useEffect(() => {
    if (data) {
      setForm({
        approval_required: data.approval_required,
        registration_open: data.registration_open,
        team_size: data.team_size,
        timezone: data.timezone,
        reminder_offsets_days: data.reminder_offsets_days.join(", "),
        send_deadline_reminder: data.send_deadline_reminder,
        default_penalty_minutes: data.default_penalty_minutes,
        min_cf_sync_interval_minutes: data.min_cf_sync_interval_minutes,
        academic_years: data.academic_years.join(", "),
        programming_languages: data.programming_languages.join(", "),
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = {
        approval_required: form.approval_required,
        registration_open: form.registration_open,
        team_size: form.team_size,
        timezone: form.timezone,
        reminder_offsets_days: form.reminder_offsets_days.split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)),
        send_deadline_reminder: form.send_deadline_reminder,
        default_penalty_minutes: form.default_penalty_minutes,
        min_cf_sync_interval_minutes: form.min_cf_sync_interval_minutes,
        academic_years: form.academic_years.split(",").map((s) => s.trim()).filter(Boolean),
        programming_languages: form.programming_languages.split(",").map((s) => s.trim()).filter(Boolean),
      };
      const check = settingsSchema.safeParse(parsed);
      if (!check.success) throw new Error(check.error.issues[0]?.message ?? "Invalid settings");
      const { error } = await supabase.from("community_settings").update(check.data).eq("id", 1);
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Settings saved — changes are recorded in the audit log");
      void qc.invalidateQueries({ queryKey: ["community-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return (
    <>
      <PageHeader title="Community Settings" />
      <LoadingRows />
    </>
  );
  if (error) return <ErrorState message={errMsg(error)} onRetry={() => void refetch()} />;
  if (!data) return <ErrorState message="Settings not found." />;

  return (
    <>
      <PageHeader
        title="Community Settings"
        description={`${APP_NAME} — ${APP_TAGLINE} · last updated ${formatDateTime(data.updated_at)}`}
        actions={<Button onClick={() => save.mutate()} disabled={save.isPending}><Save /> Save settings</Button>}
      />

      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Require admin approval</p>
                <p className="text-xs text-muted-foreground">New accounts wait for approval before signing in.</p>
              </div>
              <Switch checked={form.approval_required} onCheckedChange={(v) => setForm({ ...form, approval_required: v })} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Registration open</p>
                <p className="text-xs text-muted-foreground">When off, new sign-ups are still stored but flagged.</p>
              </div>
              <Switch checked={form.registration_open} onCheckedChange={(v) => setForm({ ...form, registration_open: v })} />
            </div>
            <div className="space-y-1.5">
              <Label>Team size</Label>
              <Input type="number" min={2} max={5} value={form.team_size} onChange={(e) => setForm({ ...form, team_size: Number(e.target.value) })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reminders & contests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Reminder offsets (days before deadline)</Label>
              <Input value={form.reminder_offsets_days} onChange={(e) => setForm({ ...form, reminder_offsets_days: e.target.value })} placeholder="7, 3, 1" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Send reminder at the deadline</p>
              <Switch checked={form.send_deadline_reminder} onCheckedChange={(v) => setForm({ ...form, send_deadline_reminder: v })} />
            </div>
            <div className="space-y-1.5">
              <Label>Default ICPC penalty (minutes)</Label>
              <Input type="number" min={0} max={240} value={form.default_penalty_minutes} onChange={(e) => setForm({ ...form, default_penalty_minutes: Number(e.target.value) })} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integrations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Minimum minutes between Codeforces syncs</Label>
              <Input type="number" min={5} max={1440} value={form.min_cf_sync_interval_minutes} onChange={(e) => setForm({ ...form, min_cf_sync_interval_minutes: Number(e.target.value) })} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Email delivery of reminders requires SMTP configuration on the Supabase project —
              currently only in-app notifications are sent.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Taxonomies</CardTitle>
            <CardDescription>Comma-separated lists.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Academic years</Label>
              <Input value={form.academic_years} onChange={(e) => setForm({ ...form, academic_years: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Programming languages</Label>
              <Input value={form.programming_languages} onChange={(e) => setForm({ ...form, programming_languages: e.target.value })} />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
