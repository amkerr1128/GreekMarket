const PRESET_THEMES = [
  {
    match: ["florida state", "fsu.edu"],
    accent: "#782f40",
    soft: "rgba(120, 47, 64, 0.16)",
    border: "rgba(196, 165, 83, 0.38)",
    glow: "rgba(196, 165, 83, 0.28)",
  },
  {
    match: ["university of florida", "ufl.edu"],
    accent: "#1e50a2",
    soft: "rgba(30, 80, 162, 0.14)",
    border: "rgba(250, 112, 33, 0.32)",
    glow: "rgba(250, 112, 33, 0.2)",
  },
];

const FALLBACK_PALETTE = [
  { accent: "#1d4ed8", soft: "rgba(29, 78, 216, 0.14)", border: "rgba(29, 78, 216, 0.28)", glow: "rgba(29, 78, 216, 0.18)" },
  { accent: "#0f766e", soft: "rgba(15, 118, 110, 0.14)", border: "rgba(15, 118, 110, 0.28)", glow: "rgba(15, 118, 110, 0.18)" },
  { accent: "#7c3aed", soft: "rgba(124, 58, 237, 0.14)", border: "rgba(124, 58, 237, 0.28)", glow: "rgba(124, 58, 237, 0.18)" },
  { accent: "#b45309", soft: "rgba(180, 83, 9, 0.14)", border: "rgba(180, 83, 9, 0.28)", glow: "rgba(180, 83, 9, 0.18)" },
  { accent: "#be123c", soft: "rgba(190, 18, 60, 0.14)", border: "rgba(190, 18, 60, 0.28)", glow: "rgba(190, 18, 60, 0.18)" },
  { accent: "#0369a1", soft: "rgba(3, 105, 161, 0.14)", border: "rgba(3, 105, 161, 0.28)", glow: "rgba(3, 105, 161, 0.18)" },
];

function hashValue(input = "") {
  return [...String(input)].reduce((total, char) => total + char.charCodeAt(0), 0);
}

function hexToRgba(hex, alpha) {
  const normalized = String(hex || "").replace("#", "");
  if (normalized.length !== 6) return `rgba(123, 82, 255, ${alpha})`;
  const value = parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function getSchoolTheme(name = "", domain = "", accentOverride = "") {
  const haystack = `${name} ${domain}`.toLowerCase();
  const preset = PRESET_THEMES.find((theme) => theme.match.some((token) => haystack.includes(token)));
  if (preset) return preset;

  if (accentOverride) {
    return {
      accent: accentOverride,
      soft: hexToRgba(accentOverride, 0.14),
      border: hexToRgba(accentOverride, 0.28),
      glow: hexToRgba(accentOverride, 0.18),
    };
  }

  return FALLBACK_PALETTE[hashValue(`${name}|${domain}`) % FALLBACK_PALETTE.length];
}

export function getSchoolThemeVars(name = "", domain = "", accentOverride = "") {
  const theme = getSchoolTheme(name, domain, accentOverride);
  return {
    "--school-accent": theme.accent,
    "--school-accent-soft": theme.soft,
    "--school-accent-border": theme.border,
    "--school-accent-glow": theme.glow,
  };
}
