const GREEK_MAP = {
  alpha: "\u0391",
  beta: "\u0392",
  gamma: "\u0393",
  delta: "\u0394",
  epsilon: "\u0395",
  zeta: "\u0396",
  eta: "\u0397",
  theta: "\u0398",
  iota: "\u0399",
  kappa: "\u039A",
  lambda: "\u039B",
  lamda: "\u039B",
  mu: "\u039C",
  nu: "\u039D",
  xi: "\u039E",
  omicron: "\u039F",
  pi: "\u03A0",
  rho: "\u03A1",
  sigma: "\u03A3",
  tau: "\u03A4",
  upsilon: "\u03A5",
  phi: "\u03A6",
  chi: "\u03A7",
  psi: "\u03A8",
  omega: "\u03A9",
};

function plainInitials(name = "", maxGlyphs = 3) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxGlyphs)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
}

export function getChapterLetterFallback(name = "", maxGlyphs = 3) {
  const tokens = name
    .replace(/\(.*?\)/g, "")
    .toLowerCase()
    .split(/[^a-z]+/i)
    .filter(Boolean);

  const glyphs = tokens
    .map((token) => GREEK_MAP[token] || "")
    .filter(Boolean)
    .slice(0, maxGlyphs);

  if (glyphs.length) return glyphs.join("");
  return plainInitials(name, Math.min(maxGlyphs, 3));
}
