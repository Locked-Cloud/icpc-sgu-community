import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { FullScreenLoader } from "@/components/layout/guards";

/** Handles Supabase auth email redirects (verification / recovery). */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        if (params.get("reset") === "1" || params.get("type")?.includes("recovery")) {
          navigate("/reset-password", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      } else {
        navigate("/login", { replace: true });
      }
    };
    void run();
  }, [navigate, params]);

  return <FullScreenLoader label="Confirming your email link…" />;
}
