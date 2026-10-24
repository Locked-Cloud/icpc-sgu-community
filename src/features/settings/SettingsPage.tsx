import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Bell } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { NOTIFICATION_KIND_LABELS } from "@/lib/constants";
import { PageHeader } from "@/components/shared/PageComponents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { NotificationPreferences } from "@/types";

const ALL_KINDS = Object.keys(NOTIFICATION_KIND_LABELS);

export default function SettingsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const { data: prefs } = useQuery({
    queryKey: ["notification-prefs", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", profile!.id)
        .maybeSingle();
      return data as NotificationPreferences | null;
    },
  });

  const [muted, setMuted] = useState<string[]>([]);
  useEffect(() => {
    if (prefs) setMuted(prefs.muted_kinds);
  }, [prefs]);

  const savePrefs = useMutation({
    mutationFn: async (newMuted: string[]) => {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ user_id: profile!.id, muted_kinds: newMuted, email_enabled: false });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Preferences saved");
      void qc.invalidateQueries({ queryKey: ["notification-prefs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      if (password.length < 8) throw new Error("Password must be at least 8 characters");
      if (password !== confirm) throw new Error("Passwords do not match");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(errMsg(error));
    },
    onSuccess: () => {
      toast.success("Password updated");
      setPassword("");
      setConfirm("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader title="Settings" description="Account security and notification preferences." />

      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-primary" /> Change password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new password</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button onClick={() => changePassword.mutate()} disabled={changePassword.isPending || !password}>
              Update password
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-primary" /> Notifications</CardTitle>
            <CardDescription>
              Choose which notifications you receive in-app. Critical system messages are always delivered.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ALL_KINDS.map((kind) => (
              <div key={kind} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50">
                <span className="text-sm">{NOTIFICATION_KIND_LABELS[kind]}</span>
                <Switch
                  checked={!muted.includes(kind)}
                  onCheckedChange={(on) =>
                    setMuted(on ? muted.filter((k) => k !== kind) : [...muted, kind])
                  }
                  aria-label={`Toggle ${kind} notifications`}
                />
              </div>
            ))}
            <Button className="mt-2" size="sm" onClick={() => savePrefs.mutate(muted)} disabled={savePrefs.isPending}>
              Save preferences
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Email notifications require SMTP configuration by the administrators; only in-app
              notifications are currently delivered.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
