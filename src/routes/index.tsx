import { createFileRoute } from "@tanstack/react-router";
import { SnapperApp } from "@/components/snapper/app";

export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <SnapperApp />;
}
