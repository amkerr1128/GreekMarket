import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/Layout.css"; // <-- use the single merged stylesheet
import App from "./App.jsx";
import { applyTheme, getInitialTheme } from "./utils/theme";

applyTheme(getInitialTheme());

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
