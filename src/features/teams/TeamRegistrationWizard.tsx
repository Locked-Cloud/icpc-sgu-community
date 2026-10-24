import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, UserPlus, Users, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStudentSearch } from "@/features/teams/api";
import { AVAILABILITY_SLOTS, EXPERIENCE_LEVELS } from "@/lib/constants";
import { cn, initials } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { ProfilePublic } from "@/types";

const TYPES = [
  {
    value: "complete" as const,
    icon: Users,
    title: "Complete team",
    description: "Register all 3 members at once. Every member must confirm, then an admin approves.",
  },
  {
    value: "incomplete" as const,
    icon: UserPlus,
    title: "Incomplete team",
    description: "Start with 1–2 members and let other students find and join your team.",
  },
  {
    value: "individual" as const,
    icon: User,
    title: "Individual",
    description: "Register yourself and browse teams that are looking for members.",
  },
];

export default function TeamRegistrationWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [step, setStep] = useState(1);
  const [type, setType] = useState<"complete" | "incomplete" | "individual">("complete");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<ProfilePublic[]>([]);
  const [leaderId, setLeaderId] = useState<string>(profile?.id ?? "");
  const [languages, setLanguages] = useState<string[]>([]);
  const [experience, setExperience] = useState<string>("any");
  const [availability, setAvailability] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const { data: results, isFetching } = useStudentSearch(search);
  const maxMembers = type === "complete" ? 2 : type === "incomplete" ? 1 : 0;

  const reset = () => {
    setStep(1);
    setName("");
    setDescription("");
    setMembers([]);
    setLeaderId(profile?.id ?? "");
    setLanguages([]);
    setExperience("any");
    setAvailability([]);
    setSearch("");
  };

  const toggle = (list: string[], setList: (v: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const candidateLeaders = useMemo(
    () => [{ id: profile?.id ?? "", name: `${profile?.full_name_en} (you)` }, ...members.map((m) => ({ id: m.id, name: m.full_name_en }))],
    [profile, members],
  );

  const submit = async () => {
    const { supabase } = await import("@/lib/supabase");
    const { toast } = await import("sonner");
    const { error } = await supabase.rpc("create_team", {
      p_name: type === "individual" && !name.trim() ? "" : name,
      p_registration_type: type,
      p_member_ids: members.map((m) => m.id),
      p_leader_id: leaderId || profile?.id,
      p_description: description || null,
      p_preferred_languages: languages,
      p_experience_preference: experience,
      p_availability: availability,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      type === "complete"
        ? "Team registered — the other members must confirm their participation."
        : "Registration submitted.",
    );
    onOpenChange(false);
    reset();
    navigate("/team");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Team registration</DialogTitle>
          <DialogDescription>
            Step {step} of 3 — {step === 1 ? "choose your registration type" : step === 2 ? "team details" : "review and submit"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => { setType(t.value); setMembers([]); setStep(2); }}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent/50",
                  type === t.value && "border-primary bg-primary/5",
                )}
              >
                <t.icon className="h-5 w-5 text-primary" />
                <p className="font-medium">{t.title}</p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-4">
              {type !== "individual" && (
                <div className="space-y-1.5">
                  <Label>Team name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Binary Brains" maxLength={80} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500}
                  placeholder="A short intro for potential teammates" />
              </div>

              {maxMembers > 0 && (
                <div className="space-y-1.5">
                  <Label>
                    Add members ({members.length}/{maxMembers})
                    {type === "complete" && <span className="text-destructive"> — exactly 2 required</span>}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => (
                      <Badge key={m.id} variant="secondary" className="h-7 gap-1.5 pl-1">
                        <Avatar className="h-5 w-5">
                          {m.avatar_url ? <AvatarImage src={m.avatar_url} /> : null}
                          <AvatarFallback className="text-[9px]">{initials(m.full_name_en)}</AvatarFallback>
                        </Avatar>
                        {m.full_name_en}
                        <button
                          className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
                          onClick={() => setMembers(members.filter((x) => x.id !== m.id))}
                          aria-label={`Remove ${m.full_name_en}`}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                  {members.length < maxMembers && (
                    <>
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search students by name (they must have an account)…"
                      />
                      {isFetching && <p className="text-xs text-muted-foreground">Searching…</p>}
                      {results && results.length > 0 && (
                        <div className="divide-y rounded-md border">
                          {results
                            .filter((r) => !members.some((m) => m.id === r.id) && r.id !== profile?.id)
                            .map((r) => (
                              <button
                                key={r.id}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                                onClick={() => {
                                  setMembers([...members, r]);
                                  setSearch("");
                                }}
                              >
                                <Avatar className="h-6 w-6">
                                  {r.avatar_url ? <AvatarImage src={r.avatar_url} /> : null}
                                  <AvatarFallback className="text-[10px]">{initials(r.full_name_en)}</AvatarFallback>
                                </Avatar>
                                <span className="flex-1 truncate">{r.full_name_en}</span>
                                <span className="text-xs text-muted-foreground">{r.academic_year ?? ""}</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {members.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Proposed team leader</Label>
                  <RadioGroup value={leaderId} onValueChange={setLeaderId} className="flex flex-wrap gap-3">
                    {candidateLeaders.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value={c.id} />
                        {c.name}
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Preferred languages</Label>
                <div className="flex flex-wrap gap-2">
                  {["C++", "C", "Java", "Python"].map((lang) => (
                    <button
                      key={lang}
                      onClick={() => toggle(languages, setLanguages, lang)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        languages.includes(lang) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                      )}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Experience preference</Label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={experience}
                    onChange={(e) => setExperience(e.target.value)}
                  >
                    <option value="any">Any level</option>
                    {EXPERIENCE_LEVELS.map((e) => (
                      <option key={e.value} value={e.value}>{e.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Training availability</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {AVAILABILITY_SLOTS.map((slot) => (
                      <button
                        key={slot}
                        onClick={() => toggle(availability, setAvailability, slot)}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors",
                          availability.includes(slot) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                        )}
                      >
                        {slot.replace("-", " · ")}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Type</p>
              <p className="font-medium">{TYPES.find((t) => t.value === type)?.title}</p>
            </div>
            {type !== "individual" && (
              <div className="rounded-lg border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Team name</p>
                <p className="font-medium">{name}</p>
              </div>
            )}
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Members</p>
              <ul className="mt-1 space-y-1">
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-success" /> {profile?.full_name_en} (you)
                  {(leaderId === profile?.id || !leaderId) && <Badge variant="info" className="ml-1">Leader</Badge>}
                </li>
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-muted-foreground" /> {m.full_name_en}
                    {leaderId === m.id && <Badge variant="info" className="ml-1">Leader</Badge>}
                  </li>
                ))}
              </ul>
              {type === "complete" && members.length < 2 && (
                <p className="mt-2 text-xs text-destructive">A complete team needs exactly 2 other members.</p>
              )}
            </div>
            {type === "complete" && (
              <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                After submitting, the other two members must confirm their participation, then an
                administrator approves the team before it becomes official.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step === 2 && (
            <Button
              onClick={() => setStep(3)}
              disabled={type !== "individual" && name.trim().length < 3}
            >
              Continue
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={() => void submit()}
              disabled={type === "complete" && members.length !== 2}
            >
              Submit registration
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
