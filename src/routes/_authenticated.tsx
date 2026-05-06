import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { supabase } from "@/integrations/supabase/client";

/**
 * Detecta si el request HTTP del SSR contiene una cookie de sesión Supabase.
 * Las cookies que Supabase coloca tienen forma sb-{project-ref}-auth-token o
 * sb-{project-ref}-auth-token.0/.1 (chunks). Cualquiera de ellas indica sesión.
 */
async function ssrHasSupabaseAuthCookie(): Promise<boolean> {
  try {
    // Import dinámico — solo se evalúa en SSR. En cliente nunca se ejecuta.
    const mod: { getRequest?: () => Request | undefined } = await import(
      "@tanstack/react-start/server"
    );
    const request = mod.getRequest?.();
    const cookieHeader = request?.headers.get("cookie") ?? "";
    return /sb-[a-z0-9-]+-auth-token(\.\d+)?=/.test(cookieHeader);
  } catch {
    // Si no podemos leer el request, no bloqueamos en SSR — pero el guard
    // del cliente (más abajo) actuará después.
    return false;
  }
}

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    // SSR: chequea cookies del request. Si no hay cookie de Supabase auth,
    // redirige a /login ANTES de servir HTML (evita info leak del layout).
    if (typeof window === "undefined") {
      const hasCookie = await ssrHasSupabaseAuthCookie();
      if (!hasCookie) {
        throw redirect({
          to: "/login",
          search: { redirect: location.href },
        });
      }
      // Hay cookie. La validamos a fondo en el cliente más abajo (puede estar
      // expirada o ser inválida; en ese caso supabase.auth.getSession devuelve null).
      return;
    }

    // Cliente: validación completa de sesión via supabase-js (cookie + storage).
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader />
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
