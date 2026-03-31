const RETURN_LABELS = [
  { prefix: "/browse", label: "Return to browse" },
  { prefix: "/search", label: "Return to search" },
  { prefix: "/dashboard", label: "Return to dashboard" },
  { prefix: "/messages", label: "Return to messages" },
  { prefix: "/notifications", label: "Return to notifications" },
  { prefix: "/school/", label: "Return to school" },
  { prefix: "/chapter/", label: "Return to chapter" },
  { prefix: "/user/", label: "Return to profile" },
  { prefix: "/post/", label: "Return to listing" },
  { prefix: "/create", label: "Return to post editor" },
  { prefix: "/account", label: "Return to account" },
  { prefix: "/verify", label: "Return to verification" },
  { prefix: "/onboarding", label: "Return to onboarding" },
];

function normalizePath(target = "") {
  return String(target).split(/[?#]/)[0] || "";
}

export function resolveReturnTarget(location, fallbackTo = "/browse") {
  const stateTarget = location?.state?.returnTo;
  if (typeof stateTarget === "string" && stateTarget.trim()) {
    return stateTarget.trim();
  }
  return fallbackTo;
}

export function getReturnLabel(target = "") {
  const path = normalizePath(target);
  const match = RETURN_LABELS.find((item) => path === item.prefix || path.startsWith(item.prefix));
  return match ? match.label : "Return";
}
