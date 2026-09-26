import { createFileRoute } from "@tanstack/react-router";
// Retire the prototype's client-authoritative WebRTC signaling endpoint.
const handle = () => new Response("Snapper uses /api/snapper/connect.", { status: 410 });

export const Route = createFileRoute("/api/rtc")({
  server: { handlers: { GET: handle, POST: handle } },
});
