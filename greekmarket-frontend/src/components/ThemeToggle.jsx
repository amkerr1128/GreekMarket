import { useEffect, useState } from "react";
import "../styles/ThemeToggle.css";
import { MoonIcon, SunIcon } from "./icons";
import { applyTheme, getInitialTheme } from "../utils/theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div className="theme-setting">
      <div className="theme-setting-copy">
        <p className="theme-setting-label">Appearance</p>
        <strong>{theme === "dark" ? "Dark mode" : "Light mode"}</strong>
        <span>
          {theme === "dark"
            ? "Deeper surfaces with brighter contrast."
            : "Bright surfaces with softer purple accents."}
        </span>
      </div>
      <button
        type="button"
        className={`theme-toggle ${theme === "dark" ? "is-dark" : ""}`}
        onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        aria-pressed={theme === "dark"}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        <span className="theme-toggle-track" aria-hidden="true">
          <span className="theme-toggle-thumb">
            {theme === "dark" ? (
              <MoonIcon className="theme-toggle-svg" />
            ) : (
              <SunIcon className="theme-toggle-svg" />
            )}
          </span>
        </span>
        <span className="theme-toggle-text">{theme === "dark" ? "On" : "Off"}</span>
      </button>
    </div>
  );
}
