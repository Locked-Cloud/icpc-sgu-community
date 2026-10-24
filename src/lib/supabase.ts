import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are present. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * The client is created even without credentials (using placeholders) so the
 * module import never throws at build time. When `isSupabaseConfigured` is
 * false the router renders a configuration screen instead of the app.
 */
export const supabase: SupabaseClient = createClient(
  url && /^https?:\/\//.test(url) ? url : "http://localhost:54321",
  anonKey ?? "not-configured",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

/** Extracts a readable message from a Supabase/Postgres error. */
export function errMsg(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  const anyErr = error as { message?: string; details?: string; hint?: string; code?: string };
  return anyErr.message ?? anyErr.details ?? anyErr.hint ?? String(error);
}
