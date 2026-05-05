import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/activity")({
  component: () => (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Activity</h1>
      <p className="text-muted-foreground text-sm">Próximamente.</p>
    </div>
  ),
});
