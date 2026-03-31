import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import API from "../api/axios";
import Avatar from "../components/Avatar";
import { isNetworkFailure } from "../utils/authErrors";
import { getChapterLetterFallback } from "../utils/chapterLetters";
import { subscribeBlockedUsers } from "../utils/blockedUsers";
import {
  clearRecentSearches,
  getRecentSearches,
  saveRecentSearch,
} from "../utils/recentSearches";
import { getSchoolThemeVars } from "../utils/schoolThemes";
import "../styles/SearchPage.css";

function schoolFallback(name = "") {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");
}

function userFallback(first, last, handle) {
  const initials = `${(first || "")[0] || ""}${(last || "")[0] || ""}`.toUpperCase();
  if (initials.trim()) return initials;
  if (handle) return handle.slice(0, 2).toUpperCase();
  return "GM";
}

function getItemType(item) {
  return item.resultType || item._type || (item.kind || "search").toLowerCase();
}

function filterBlockedSearchResults(items, blockedUsers) {
  if (!blockedUsers.length) return items;

  const blockedIds = new Set(
    blockedUsers
      .map((entry) => entry.userId)
      .filter(Boolean)
  );
  const blockedHandles = new Set(
    blockedUsers
      .map((entry) => entry.handle)
      .filter(Boolean)
  );

  return items.filter((item) => {
    const itemType = getItemType(item);
    if (itemType === "user") {
      const candidateId = String(item.id || item.user?.user_id || item.user_id || "").trim();
      const candidateHandle = String(item.user?.handle || item.handle || item.subtitle || "")
        .replace(/^@+/, "")
        .toLowerCase();
      if (candidateId && blockedIds.has(candidateId)) return false;
      if (candidateHandle && blockedHandles.has(candidateHandle)) return false;
      return true;
    }

    if (itemType === "post") {
      const handle = String(item.user_handle || item.user?.handle || "").replace(/^@+/, "").toLowerCase();
      if (handle && blockedHandles.has(handle)) return false;
    }

    return true;
  });
}

function getAvatarProps(item) {
  const itemType = getItemType(item);

  if (itemType === "user") {
    return {
      user: item.user,
    };
  }

  if (itemType === "chapter") {
    return {
      user: {
        handle: item.title,
        profile_picture_url: item.profile_picture_url,
      },
      fallback: item.fallback,
      style: item.schoolStyle,
    };
  }

  return {
    user: { handle: item.title },
    fallback: item.fallback,
    style: item.schoolStyle,
  };
}

function SearchResultCard({ item, returnTo, onSelect, className = "", footer = null }) {
  const itemType = getItemType(item);
  const avatarProps =
    getAvatarProps(item);
  const itemLabel = item.label || item.kind || "Search";

  return (
    <Link
      className={`search-result card ${className}`.trim()}
      to={item.href}
      state={{ returnTo }}
      onClick={() => onSelect(item)}
    >
      <Avatar
        size="md"
        className={`search-avatar ${itemType} ${itemType === "chapter" ? "chapter-avatar" : ""}`}
        {...avatarProps}
      />
      <div className="search-meta">
        <div className="search-topline">
          <div className="search-title">{item.title}</div>
          <span className={`search-pill ${itemType}`}>{itemLabel}</span>
          {item.school_name ? (
            <span className="search-pill school-tag" style={item.schoolStyle}>
              {item.school_name}
            </span>
          ) : null}
          {item.verified ? <span className="search-pill verified">Verified</span> : null}
        </div>
        <div className="search-sub">{item.subtitle}</div>
        {footer ? <div className="recent-search-foot">{footer}</div> : null}
      </div>
      <div className="search-chevron" aria-hidden="true">
        &gt;
      </div>
    </Link>
  );
}

function SearchResult(props) {
  return <SearchResultCard {...props} />;
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [results, setResults] = useState([]);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [viewerId, setViewerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recentSearches, setRecentSearches] = useState(() => getRecentSearches());
  const debounceRef = useRef(null);
  const skipDebounceRef = useRef(false);
  const resultsRef = useRef(null);
  const returnTo = query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search";
  const visibleResults = useMemo(() => filterBlockedSearchResults(results, blockedUsers), [blockedUsers, results]);
  const hiddenCount = Math.max(0, results.length - visibleResults.length);

  const runSearch = async (term, options = {}) => {
    const { focusResults = false } = options;
    const trimmed = term.trim();
    if (!trimmed) {
      setResults([]);
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const q = encodeURIComponent(trimmed);
      const settled = await Promise.allSettled([
        API.get(`/search/users?q=${q}`),
        API.get(`/search/schools?q=${q}`),
        API.get(`/search/chapters?q=${q}`),
        API.get(`/search/posts?q=${q}`),
      ]);

      const [users, schools, chapters, posts] = settled.map((entry) =>
        entry.status === "fulfilled" ? entry.value : { data: [] }
      );
      const failedRequests = settled.filter((entry) => entry.status === "rejected");

      const normalized = [
        ...(chapters.data || []).map((item) => {
          const schoolStyle = getSchoolThemeVars(
            item.school_name || item.school?.name || "",
            item.school_domain || item.school?.domain || "",
            item.school_tag_color || item.school?.tag_color || ""
          );

          return {
            _type: "chapter",
            id: item.chapter_id,
            title: item.name,
            subtitle: `${item.type || "Chapter"}${item.school_name ? ` at ${item.school_name}` : ""}`,
            label: "Chapter",
            verified: Boolean(item.verified),
            fallback: getChapterLetterFallback(item.name, 3),
            href: `/chapter/${item.chapter_id}`,
            school_name: item.school_name || item.school?.name || "",
            schoolStyle,
            profile_picture_url: item.profile_picture_url,
          };
        }),
        ...(schools.data || []).map((item) => ({
          _type: "school",
          id: item.school_id,
          title: item.name,
          subtitle: item.domain || "School",
          label: "School",
          fallback: schoolFallback(item.name),
          href: `/school/${item.school_id}`,
          schoolStyle: getSchoolThemeVars(item.name, item.domain, item.tag_color || ""),
        })),
        ...(posts.data || []).map((item) => ({
          _type: "post",
          id: item.post_id,
          title: item.title,
          subtitle: [
            item.type || "Listing",
            item.user_handle ? `@${item.user_handle}` : null,
            item.price != null ? `$${Number(item.price).toFixed(2)}` : null,
          ]
            .filter(Boolean)
            .join(" - "),
          label: "Post",
          fallback: "P",
          href: `/post/${item.post_id}`,
        })),
        ...(users.data || []).map((item) => ({
          _type: "user",
          id: item.user_id,
          title: `${item.first_name || ""} ${item.last_name || ""}`.trim() || item.handle,
          subtitle: item.email || `@${item.handle}`,
          label: "User",
          fallback: userFallback(item.first_name, item.last_name, item.handle),
          user: {
            first_name: item.first_name,
            last_name: item.last_name,
            handle: item.handle,
            profile_picture_url: item.profile_picture_url,
          },
          href: `/user/${item.user_id}`,
        })),
      ];

      setResults(normalized);
      if (failedRequests.length === settled.length) {
        const firstError = failedRequests[0]?.reason;
        setError(
          isNetworkFailure(firstError)
            ? "Search is unavailable right now. The backend may be offline or blocked by CORS."
            : firstError?.response?.data?.error || "Search could not be completed."
        );
      }
    } catch (err) {
      setResults([]);
      setError(
        isNetworkFailure(err)
          ? "Search is unavailable right now. The backend may be offline or blocked by CORS."
          : err?.response?.data?.error || "Search could not be completed."
      );
    } finally {
      setLoading(false);
      if (focusResults && resultsRef.current) {
        window.requestAnimationFrame(() => {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  };

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (query.trim()) next.set("q", query);
    else next.delete("q");
    setSearchParams(next, { replace: true });

    if (skipDebounceRef.current) {
      skipDebounceRef.current = false;
      return () => clearTimeout(debounceRef.current);
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 280);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    setRecentSearches(getRecentSearches());
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { data } = await API.get("/me");
        if (!active) return;
        setViewerId(String(data?.user_id || ""));
      } catch {
        if (!active) return;
        setViewerId("");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!viewerId) {
      setBlockedUsers([]);
      return undefined;
    }

    return subscribeBlockedUsers(viewerId, setBlockedUsers);
  }, [viewerId]);

  useEffect(() => {
    const syncRecentSearches = () => setRecentSearches(getRecentSearches());
    window.addEventListener("storage", syncRecentSearches);
    return () => window.removeEventListener("storage", syncRecentSearches);
  }, []);

  const submitSearch = (term, options = {}) => {
    skipDebounceRef.current = true;
    setQuery(term);
    runSearch(term, options);
  };

  const registerRecentSearch = (item) => {
    const next = saveRecentSearch(item);
    setRecentSearches(next);
    return next;
  };

  const handleClearRecentSearches = () => {
    const next = clearRecentSearches();
    setRecentSearches(next);
  };

  const countLabel = useMemo(() => {
    if (!query.trim()) return "Search people, schools, chapters, and posts.";
    if (loading) return "Searching...";
    if (error) return "";
    const base = visibleResults.length === 1 ? "1 result" : `${visibleResults.length} results`;
    return hiddenCount ? `${base} (${hiddenCount} hidden)` : base;
  }, [error, hiddenCount, loading, query, visibleResults.length]);

  return (
    <div className="search-page">
      <section className="search-hero card">
        <div className="search-hero-copy">
          <p className="eyebrow">Explore GreekMarket</p>
          <h1>Find people, campuses, and listings.</h1>
          <p>Search is fast, visual, and tuned for the school community flow you already know.</p>
        </div>

        <form
          className="search-bar"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch(query, { focusResults: true });
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search users, schools, chapters, and posts"
            aria-label="Search"
          />
          <button type="submit">Search</button>
        </form>

        <div className="search-status">
          <span>{countLabel}</span>
          <div className="search-links">
            <Link to="/browse">Browse feed</Link>
            <Link to="/create">Create post</Link>
          </div>
        </div>

        {hiddenCount ? (
          <p className="search-hidden-note">Blocked accounts are hidden from this search result list.</p>
        ) : null}

        <section className="recent-searches card" aria-labelledby="recent-searches-title">
          <div className="recent-searches-header">
            <div>
              <p className="eyebrow">Recent searches</p>
              <h2 id="recent-searches-title">Jump back into what you searched last</h2>
            </div>
            <button
              type="button"
              className="recent-search-clear"
              onClick={handleClearRecentSearches}
              disabled={!recentSearches.length}
            >
              Clear history
            </button>
          </div>

          {recentSearches.length ? (
            <div className="recent-searches-list">
              {recentSearches.map((item) => (
                <SearchResult
                  key={item.key}
                  item={item}
                  returnTo="/search"
                  onSelect={registerRecentSearch}
                />
              ))}
            </div>
          ) : (
            <div className="recent-search-empty">
              <h3>No recent searches yet</h3>
              <p>
                Search for a person, school, chapter, or post and your last 10 searches will show
                up here for one-tap reruns.
              </p>
            </div>
          )}
        </section>
      </section>

      {error ? <div className="search-alert card">{error}</div> : null}

      <section className="search-results" ref={resultsRef}>
        {loading && !visibleResults.length ? (
          Array.from({ length: 5 }).map((_, index) => (
            <div className="search-result card skeleton" key={index}>
              <div className="skeleton-avatar shimmer" />
              <div className="search-meta">
                <div className="skeleton-line shimmer" />
                <div className="skeleton-sub shimmer" />
              </div>
            </div>
          ))
        ) : visibleResults.length ? (
          visibleResults.map((item) => (
            <SearchResult
              key={`${item._type}:${item.id}`}
              item={item}
              returnTo={returnTo}
              onSelect={registerRecentSearch}
            />
          ))
        ) : query.trim() ? (
          <div className="search-empty card">
            <h3>No visible matches found</h3>
            <p>
              {hiddenCount
                ? "Some matching accounts are blocked on your account. Try a broader search or manage blocked accounts from your dashboard."
                : "Try a broader term, clear one word at a time, or tap a recent search to rerun it."}
            </p>
          </div>
        ) : (
          <div className="search-empty card">
            <h3>Start with a name, school, or item</h3>
            <p>
              Use the search bar above, or pick one of your recent searches to jump back in
              instantly.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
