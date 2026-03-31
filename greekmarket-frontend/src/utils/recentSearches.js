const STORAGE_KEY = "greekmarket:recent-searches:v1";
const MAX_HISTORY = 10;

function safeRead() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(items) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage failures and keep the UI functional.
  }
}

function normalizeQuery(query) {
  return (query || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeQuery(value).toLowerCase();
}

function normalizeItem(input) {
  if (!input) return null;

  if (typeof input === "string") {
    const title = normalizeQuery(input);
    if (!title) return null;
    const href = `/search?q=${encodeURIComponent(title)}`;
    return {
      title,
      kind: "search",
      _type: "search",
      href,
      subtitle: "Search",
      label: "Search",
      searched_at: new Date().toISOString(),
    };
  }

  const base = { ...input };
  const title = normalizeQuery(base.title || base.query || base.label || base.name);
  const kind = normalizeQuery(base.kind || base._type || base.type || base.label || "search") || "search";
  const href = normalizeQuery(base.href || base.path || base.to || "");
  const subtitle = normalizeQuery(base.subtitle || base.description || base.meta || "");
  const searchQuery = normalizeQuery(input.searchQuery || input.search_query || "");
  const searchedAt = input.searched_at || input.searchedAt || input.created_at || new Date().toISOString();

  if (!title && !href) return null;

  return {
    ...base,
    title: title || href,
    kind,
    _type: base._type || kind,
    href: href || `/search?q=${encodeURIComponent(title)}`,
    subtitle: subtitle || kind,
    label: base.label || (kind === "search" ? "Search" : kind.charAt(0).toUpperCase() + kind.slice(1)),
    search_query: searchQuery || (kind.toLowerCase() === "search" ? title : ""),
    searched_at: searchedAt,
  };
}

export function getRecentSearches() {
  return safeRead()
    .map((item) => {
      const normalized = normalizeItem(item);
      if (!normalized) return null;
      return {
        ...normalized,
        key: normalizeKey(normalized.href || `${normalized.kind}:${normalized.title}`),
        searchQuery: normalized.search_query,
      };
    })
    .filter(Boolean);
}

export function saveRecentSearch(entry) {
  const nextItem = normalizeItem(entry);
  if (!nextItem) return getRecentSearches();

  const nextKey = normalizeKey(nextItem.href || `${nextItem.kind}:${nextItem.title}`);
  const queryKey = nextItem.search_query
    ? normalizeKey(`/search?q=${encodeURIComponent(nextItem.search_query)}`)
    : "";
  const now = new Date().toISOString();
  const history = safeRead()
    .map((item) => {
      const normalized = normalizeItem(item);
      if (!normalized) return null;
      return {
        ...normalized,
        key: normalizeKey(normalized.href || `${normalized.kind}:${normalized.title}`),
        searchQuery: normalized.search_query,
      };
    })
    .filter((item) => item?.key !== nextKey && item?.key !== queryKey);
  const next = [{ ...nextItem, key: nextKey, searched_at: now }, ...history].slice(0, MAX_HISTORY);
  safeWrite(next);
  return next.map((item) => ({
    ...item,
    searchQuery: item.searchQuery || item.search_query || "",
  }));
}

export function clearRecentSearches() {
  safeWrite([]);
  return [];
}

export function formatRecentSearchTime(value) {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";

  const diffMinutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}
