import { Navigate, Outlet } from "react-router-dom";
import { Code2, Flag, Terminal, Trophy, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

export default function AuthLayout() {
  const { session } = useAuth();
  if (session) return <Navigate to="/dashboard" replace />;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-card p-10 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 20%, rgba(59,130,246,0.15), transparent 40%), radial-gradient(circle at 80% 80%, rgba(139,92,246,0.12), transparent 40%)",
          }}
        />
        <div className="relative flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Terminal className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">{APP_NAME}</p>
            <p className="text-xs text-muted-foreground">{APP_TAGLINE}</p>
          </div>
        </div>
        <div className="relative space-y-6">
          <h2 className="max-w-md text-3xl font-bold leading-tight">
            Level 1 Management Platform
          </h2>
          <p className="max-w-md text-muted-foreground">
            One place for team formation, weekly training, problem sheets, virtual contests,
            Codeforces analytics, and mentorship — built for the ICPC community at El-Saleheya
            El-Gadida University.
          </p>
          <div className="grid max-w-md grid-cols-2 gap-3">
            {[
              { icon: Users, label: "Team registration & matching" },
              { icon: Code2, label: "Codeforces integration" },
              { icon: Trophy, label: "Virtual contests & standings" },
              { icon: Flag, label: "Training roadmap" },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-2 rounded-lg border bg-background/50 px-3 py-2 text-sm">
                <f.icon className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{f.label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-muted-foreground">
          © {new Date().getFullYear()} {APP_NAME}
        </p>
      </div>
      <div className="flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
