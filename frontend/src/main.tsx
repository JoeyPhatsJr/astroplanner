import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { createQueryClient } from "./api/queryClient";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import "./index.css";
import { warmUpApi } from "./lib/warmUp";
import { PrefsProvider } from "./state/prefs";

const queryClient = createQueryClient();
if (import.meta.env.PROD) warmUpApi(); // the hosted API may be asleep; start waking it now

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConfirmProvider>
      </PrefsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
