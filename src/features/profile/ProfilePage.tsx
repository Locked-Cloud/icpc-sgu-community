import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Save } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase, errMsg } from "@/lib/supabase";
import { profileSchema, type ProfileValues } from "@/lib/validation";
import { AVAILABILITY_SLOTS, EXPERIENCE_LEVELS } from "@/lib/constants";
import { cn, initials } from "@/lib/utils";
import { PageHeader, ErrorState } from "@/components/shared/PageComponents";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const EMPTY = {
  full_name_en: "", full_name_ar: "", university_id: "", phone: "", whatsapp: "",
  university_email: "", academic_year: "", faculty: "", programming_experience: undefined,
  preferred_language: "C++", previous_cp_experience: false, availability: [] as string[],
  github_url: "", linkedin_url: "", bio: "", show_contact: false, show_university_id: false,
};

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const [values, setValues] = useState<ProfileValues>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setValues({
      full_name_en: profile.full_name_en ?? "",
      full_name_ar: profile.full_name_ar ?? "",
      university_id: profile.university_id ?? "",
      phone: profile.phone ?? "",
      whatsapp: profile.whatsapp ?? "",
      university_email: profile.university_email ?? "",
      academic_year: profile.academic_year ?? "",
      faculty: profile.faculty ?? "",
      programming_experience: profile.programming_experience ?? undefined,
      preferred_language: profile.preferred_language ?? "C++",
      previous_cp_experience: profile.previous_cp_experience,
      availability: profile.availability ?? [],
      github_url: profile.github_url ?? "",
      linkedin_url: profile.linkedin_url ?? "",
      bio: profile.bio ?? "",
      show_contact: profile.show_contact,
      show_university_id: profile.show_university_id,
    });
  }, [profile]);

  const set = <K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const uploadAvatar = async (file: File) => {
    if (!profile) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${profile.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ avatar_url: data.publicUrl })
        .eq("id", profile.id);
      if (updErr) throw updErr;
      toast.success("Profile picture updated");
      await refreshProfile();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const check = profileSchema.safeParse(values);
    if (!check.success) {
      const map: Record<string, string> = {};
      for (const issue of check.error.issues) map[issue.path.join(".")] = issue.message;
      setErrors(map);
      toast.error("Please fix the highlighted fields");
      return;
    }
    setErrors({});
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name_en: values.full_name_en,
        full_name_ar: values.full_name_ar || null,
        university_id: values.university_id || null,
        phone: values.phone || null,
        whatsapp: values.whatsapp || null,
        university_email: values.university_email || null,
        academic_year: values.academic_year || null,
        faculty: values.faculty || null,
        programming_experience: values.programming_experience ?? null,
        preferred_language: values.preferred_language ?? "C++",
        previous_cp_experience: values.previous_cp_experience ?? false,
        availability: values.availability ?? [],
        github_url: values.github_url || null,
        linkedin_url: values.linkedin_url || null,
        bio: values.bio || null,
        show_contact: values.show_contact ?? false,
        show_university_id: values.show_university_id ?? false,
      })
      .eq("id", profile!.id);
    setSaving(false);
    if (error) return toast.error(errMsg(error));
    toast.success("Profile saved");
    await refreshProfile();
    void qc.invalidateQueries({ queryKey: ["student-search"] });
  };

  if (!profile) return <ErrorState message="Profile not found" />;
  const completion = profile.profile_completed_at ? 100 :
    Math.round(([
      profile.full_name_en?.length >= 3, profile.university_id, profile.phone,
      profile.academic_year, profile.programming_experience, profile.preferred_language,
    ].filter(Boolean).length / 6) * 100);

  return (
    <>
      <PageHeader
        title="My Profile"
        description="Complete your profile to help with team matching."
        actions={<Button onClick={() => void save()} disabled={saving}><Save /> Save changes</Button>}
      />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <div className="relative">
            <Avatar className="h-16 w-16">
              {profile.avatar_url ? <AvatarImage src={profile.avatar_url} /> : null}
              <AvatarFallback className="text-lg">{initials(profile.full_name_en)}</AvatarFallback>
            </Avatar>
            <button
              className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5 text-primary-foreground hover:bg-primary/90"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change picture"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">{profile.full_name_en}</p>
            <p className="text-sm text-muted-foreground">
              {profile.academic_year ?? "Academic year not set"} · {profile.codeforces_handle ? `CF: ${profile.codeforces_handle}` : "No CF handle"}
            </p>
          </div>
          <Badge variant={completion === 100 ? "success" : "warning"}>
            Profile completion: {completion}%
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Personal information</CardTitle>
            <CardDescription>Phone, university ID and emails are hidden from other students by default.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name (English) *" error={errors["full_name_en"]}>
              <Input value={values.full_name_en} onChange={(e) => set("full_name_en", e.target.value)} />
            </Field>
            <Field label="Full name (Arabic)">
              <Input dir="rtl" value={values.full_name_ar} onChange={(e) => set("full_name_ar", e.target.value)} />
            </Field>
            <Field label="University ID *" error={errors["university_id"]}>
              <Input value={values.university_id} onChange={(e) => set("university_id", e.target.value)} placeholder="e.g. 202301234" />
            </Field>
            <Field label="Academic year *">
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={values.academic_year ?? ""}
                onChange={(e) => set("academic_year", e.target.value)}
              >
                <option value="">Select…</option>
                {["First Year", "Second Year", "Third Year", "Fourth Year", "Fifth Year", "Graduated"].map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </Field>
            <Field label="Phone *" error={errors["phone"]}>
              <Input value={values.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+20 1xx xxx xxxx" />
            </Field>
            <Field label="WhatsApp">
              <Input value={values.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
            </Field>
            <Field label="University email (optional)">
              <Input type="email" value={values.university_email} onChange={(e) => set("university_email", e.target.value)} />
            </Field>
            <Field label="Faculty / department">
              <Input value={values.faculty} onChange={(e) => set("faculty", e.target.value)} placeholder="e.g. Computer Science" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Programming background</CardTitle>
            <CardDescription>Used for transparent team-matching recommendations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Programming experience *">
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={values.programming_experience ?? ""}
                  onChange={(e) => set("programming_experience", (e.target.value || undefined) as ProfileValues["programming_experience"])}
                >
                  <option value="">Select…</option>
                  {EXPERIENCE_LEVELS.map((x) => (
                    <option key={x.value} value={x.value}>{x.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Preferred language *">
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={values.preferred_language ?? "C++"}
                  onChange={(e) => set("preferred_language", e.target.value)}
                >
                  {["C++", "C", "Java", "Python"].map((l) => <option key={l}>{l}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="cp-exp"
                checked={values.previous_cp_experience ?? false}
                onCheckedChange={(v) => set("previous_cp_experience", v)}
              />
              <Label htmlFor="cp-exp">I have previous competitive programming experience</Label>
            </div>
            <Field label="Training availability">
              <div className="flex flex-wrap gap-1.5">
                {AVAILABILITY_SLOTS.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() =>
                      set("availability", values.availability?.includes(slot)
                        ? values.availability.filter((s) => s !== slot)
                        : [...(values.availability ?? []), slot])
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11px] capitalize transition-colors",
                      values.availability?.includes(slot)
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {slot.replace("-", " · ")}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="GitHub" error={errors["github_url"]}>
              <Input value={values.github_url} onChange={(e) => set("github_url", e.target.value)} placeholder="https://github.com/username" />
            </Field>
            <Field label="LinkedIn" error={errors["linkedin_url"]}>
              <Input value={values.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/username" />
            </Field>
            <Field label="Short bio">
              <Textarea value={values.bio} onChange={(e) => set("bio", e.target.value)} maxLength={1000} />
            </Field>
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Privacy</p>
              <div className="flex items-center gap-2">
                <Switch id="show-contact" checked={values.show_contact ?? false} onCheckedChange={(v) => set("show_contact", v)} />
                <Label htmlFor="show-contact" className="text-sm font-normal">Show my phone/WhatsApp on my public profile</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="show-uid" checked={values.show_university_id ?? false} onCheckedChange={(v) => set("show_university_id", v)} />
                <Label htmlFor="show-uid" className="text-sm font-normal">Show my university ID on my public profile</Label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Note: public contact display requires the values above; administrators can always see your details.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
