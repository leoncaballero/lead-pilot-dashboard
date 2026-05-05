import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/deep-review")({
  component: () => (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Deep Review</h1>
      <p className="text-muted-foreground text-sm">Revisión profunda. Próximamente.</p>
    </div>
  ),
});
