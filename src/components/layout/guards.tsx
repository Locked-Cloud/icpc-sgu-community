import { Navigate, useLocation } from "react-router-dom";
import { Hourglass, ShieldAlert, ShieldX } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function FullScreenLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function StatusScreen({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Hourglass;
  title: string;
  description: string;
}) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoader label="Loading your account…" />;
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!profile) return <FullScreenLoader label="Loading your profile…" />;

  if (profile.status === "pending_approval") {
    return (
      <StatusScreen
        icon={Hourglass}
        title="Waiting for approval"
        description="Your registration was received. An administrator will review your account shortly — you will be able to sign in once it is approved."
      />
    );
  }
  if (profile.status === "pending_verification") {
    return (
      <StatusScreen
        icon={Hourglass}
        title="Verify your email"
        description="Please verify your email address using the link we sent you, then sign in again."
      />
    );
  }
  if (profile.status === "suspended" || profile.status === "deactivated") {
    return (
      <StatusScreen
        icon={ShieldX}
        title="Account unavailable"
        description="Your account is currently suspended or deactivated. Contact the community administrators through the support email if you believe this is a mistake."
      />
    );
  }

  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Administrator access required</CardTitle>
            <CardDescription>
              You do not have permission to view this page. If you believe you should, contact the
              Level 1 lead.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
