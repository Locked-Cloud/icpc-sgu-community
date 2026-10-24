import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-4 text-center">
      <p className="font-mono text-6xl font-bold text-primary">404</p>
      <p className="text-lg font-medium">Page not found</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you are looking for does not exist or you do not have access to it.
      </p>
      <Button asChild>
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
