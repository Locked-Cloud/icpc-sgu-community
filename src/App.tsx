import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { isSupabaseConfigured } from "@/lib/supabase";
import { router } from "@/router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function NotConfigured() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Supabase is not configured</CardTitle>
          <CardDescription>
            {APP_NAME} needs a Supabase project to run. Copy <code>.env.example</code> to{" "}
            <code>.env</code>, fill in <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> from your Supabase dashboard, then restart the dev
            server. See the README for full setup instructions.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">What to do</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Create a free project at supabase.com</li>
            <li>
              Run <code className="rounded bg-muted px-1">npm run db:apply</code> with{" "}
              <code>SUPABASE_DB_URL</code> set to apply migrations
            </li>
            <li>Restart this dev server</li>
          </ol>
          <p className="mt-3 text-xs">{APP_TAGLINE}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          {isSupabaseConfigured ? (
            <>
              <RouterProvider router={router} />
              <Toaster position="top-right" />
            </>
          ) : (
            <NotConfigured />
          )}
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
