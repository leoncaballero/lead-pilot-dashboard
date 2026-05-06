import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

async function ssrHasSupabaseAuthCookie(): Promise<boolean> {
  try {
    const mod: { getRequest?: () => Request | undefined } = await import(
      "@tanstack/react-start/server"
    );
    const request = mod.getRequest?.();
    const cookieHeader = request?.headers.get("cookie") ?? "";
    return /sb-[a-z0-9-]+-auth-token(\.\d+)?=/.test(cookieHeader);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") {
      // SSR: redirige basado en cookies para no servir nada mientras se decide
      const hasCookie = await ssrHasSupabaseAuthCookie();
      throw redirect({ to: hasCookie ? "/triage" : "/login" });
    }
    // Cliente: validación completa
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/triage" : "/login" });
  },
});
