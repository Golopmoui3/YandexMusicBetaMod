import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.tsx";

Sentry.init({
  dsn: import.meta.env.VITE_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  enableLogs: false,
  tracesSampleRate: 0.1,
  sampleRate: 1,
  beforeBreadcrumb: (breadcrumb) => (breadcrumb.category === "console" ? null : breadcrumb),
  beforeSend: (event) => {
    if (window.__yandexMusicModAnalyticsEnabled !== true) return null;

    // Diagnostics are anonymous even when the user explicitly opts in.
    delete event.user;
    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
      delete event.request.headers;
    }
    return event;
  },
});

const queryClient = new QueryClient();

function mountModUi() {
  if (document.getElementById("yandex-music-mod-sidebar")) return;

  const sidebar = document.createElement("div");
  sidebar.id = "yandex-music-mod-sidebar";
  document.body.appendChild(sidebar);

  createRoot(sidebar).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountModUi, { once: true });
} else {
  mountModUi();
}
