import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "../lib/auth/provider";
import { AppErrorComponent } from "../lib/error-component";
import { PreviewHostBridge } from "../components/preview-host-bridge";
import { SnapperApp } from "../components/snapper/app";
import "../styles.css";

const route = createRootRoute({
  component: () => (
    <>
      <PreviewHostBridge />
      <AuthProvider>
        <SnapperApp />
      </AuthProvider>
    </>
  ),
});
const router = createRouter({ routeTree: route, defaultErrorComponent: AppErrorComponent });
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
