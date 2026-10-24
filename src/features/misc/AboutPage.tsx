import { Link } from "react-router-dom";
import { Code2, ExternalLink, GitBranch, Github, Heart, Layers, Server, Terminal } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { PageHeader } from "@/components/shared/PageComponents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const GITHUB_URL = "https://github.com/Locked-Cloud/icpc-sgu-community";
const LIVE_URL = "https://icpc-sgu-community-kappa.vercel.app";

const STACK = [
  { icon: Code2, label: "React 19 + TypeScript (strict)" },
  { icon: Layers, label: "Vite · Tailwind CSS · shadcn/ui" },
  { icon: Server, label: "Supabase — PostgreSQL, Auth, RLS, Storage, Realtime" },
  { icon: GitBranch, label: "Backend shipped as SQL migrations" },
];

export default function AboutPage() {
  return (
    <>
      <PageHeader title="About this platform" description={`${APP_NAME} — Level 1 Management Platform`} />

      <div className="mx-auto max-w-3xl space-y-6">
        <Card className="overflow-hidden">
          <div className="bg-primary/10 px-6 py-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Terminal className="h-7 w-7" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">{APP_NAME}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              El-Saleheya El-Gadida University · {APP_TAGLINE}
            </p>
          </div>
          <CardContent className="space-y-4 p-6 text-center">
            <p className="text-sm leading-relaxed">
              This website was designed and built by{" "}
              <span className="font-semibold">Ibrahim Ahmed (Locked-Cloud)</span> as a complete,
              open-source platform for the community's Level 1 training program.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The entire source code lives on GitHub — the platform, its database, and every page
              you use are taken from the repository. It is free to use, inspect, and build upon.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button asChild size="sm">
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <Github /> Source on GitHub <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={LIVE_URL} target="_blank" rel="noreferrer">
                  Live deployment <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
            <p className="break-all rounded-md bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
              {GITHUB_URL}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Built with</CardTitle>
            <CardDescription>A modern, fully open-source stack.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {STACK.map((s) => (
              <div key={s.label} className="flex items-center gap-2.5 rounded-lg border p-3 text-sm">
                <s.icon className="h-4 w-4 shrink-0 text-primary" />
                {s.label}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What's inside</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {[
              "Team registration & matching",
              "Realtime private team chat",
              "Weekly training & resources",
              "Problem sheets with progress",
              "Codeforces analytics",
              "Virtual contests — ICPC scoring",
              "Skill map & training roadmap",
              "Scheduled assignment reminders",
              "Mentorship booking",
              "Attendance & announcements",
              "Full admin suite & audit log",
            ].map((f) => (
              <Badge key={f} variant="secondary">{f}</Badge>
            ))}
          </CardContent>
        </Card>

        <Separator />
        <p className="flex items-center justify-center gap-1.5 pb-4 text-xs text-muted-foreground">
          Made with <Heart className="h-3 w-3 text-destructive" /> for the ICPC SGU Community ·
          MIT License ·{" "}
          <Link to="/dashboard" className="text-primary hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    </>
  );
}
