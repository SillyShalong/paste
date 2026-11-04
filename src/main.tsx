import { createRoot } from "react-dom/client";
import App from "./App";
import SettingsApp from "./settings/SettingsApp";
import { useStore } from "./store/useStore";
import "./styles.css";

const isSettings = window.location.hash.startsWith("#/settings");

// Suppress the WebView2 browser context menu (refresh / save-as / print are
// useless in a clipboard panel). Our own menus (e.g. the card context menu)
// call preventDefault themselves and render DOM elements, so they are
// unaffected by this global catch-all.
window.addEventListener("contextmenu", (e) => e.preventDefault());

// Dev-only hook: lets tools drive the panel UI (state injection, screenshots)
// without the Tauri IPC bridge. Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useStore;
}

createRoot(document.getElementById("root")!).render(
  isSettings ? <SettingsApp /> : <App />,
);
