import { createRoot } from "react-dom/client";
import App from "./App";
import SettingsApp from "./settings/SettingsApp";
import "./styles.css";

const isSettings = window.location.hash.startsWith("#/settings");

createRoot(document.getElementById("root")!).render(
  isSettings ? <SettingsApp /> : <App />,
);
