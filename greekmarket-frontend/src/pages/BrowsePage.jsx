import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../api/axios";
import Avatar from "../components/Avatar";
import FancySelect from "../components/FancySelect";
import PostCard from "../components/PostCard";
import { isNetworkFailure } from "../utils/authErrors";
import "../styles/BrowsePage.css";

const TYPES = ["all", "apparel", "accessories", "stickers", "tickets", "other"];
const SORTS = [
  { value: "new", label: "Newest", meta: "Latest listings first" },
  { value: "price", label: "Price: Low -> High", meta: "Compare the cheapest options" },
  { value: "-price", label: "Price: High -> Low", meta: "Start with premium listings" },
];

function SkeletonCard() {
  return (
    <div className="post-card skeleton-card">
      <div className="skeleton-media shimmer" />
      <div className="skeleton-body">
        <div className="skeleton-line shimmer" />
        <div className="skeleton-line short shimmer" />
      </div>
    </div>
  );
}

function DMItem({ convo }) {
  const navigate = useNavigate();
  const person = convo.other_user || {};
  const handle = person.handle || convo.other_user_handle || convo.handle || String(convo.user_id);
  const name = person.display_name || convo.other_user_name || `@${handle}`;
  const preview = convo.last_message_preview || convo.last_message || "No messages yet";

  return (
    <button
      type="button"
      className={`dm-row ${convo.unread_count ? "has-unread" : ""}`}
      onClick={() => navigate(`/messages/${convo.user_id}`)}
    >
      <Avatar
        size="sm"
        className="dm-avatar"
        user={{ ...person, handle, profile_picture_url: convo.other_user_avatar_url }}
      />
      <div className="dm-col">
        <div className="dm-top">
          <span className="dm-name">{name}</span>
          {convo.unread_count ? <span className="pill">{convo.unread_count}</span> : null}
        </div>
        <div className="dm-handle">@{handle}</div>
        <div className="dm-last">{preview}</div>
      </div>
      <span className="chev">&gt;</span>
    </button>
  );
}

export default function BrowsePage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("new");
  const [inbox, setInbox] = useState([]);
  const [dmErr, setDmErr] = useState("");
  const [feedErr, setFeedErr] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const filtered = useMemo(() => {
    let nextPosts = posts;
    if (q.trim()) {
      const query = q.trim().toLowerCase();
      nextPosts = nextPosts.filter(
        (item) =>
          item.title?.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query) ||
          item.user_handle?.toLowerCase().includes(query) ||
          item.author_handle?.toLowerCase().includes(query) ||
          item.author_name?.toLowerCase().includes(query)
      );
    }
    return nextPosts;
  }, [posts, q]);
  const isLoggedIn = Boolean(localStorage.getItem("token"));
  const hasSearchFilters = Boolean(q.trim() || type !== "all" || sort !== "new");

  function clearBrowseFilters() {
    setQ("");
    setType("all");
    setSort("new");
  }

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setFeedErr("");
      try {
        const token = localStorage.getItem("token");
        if (token) {
          const me = await API.get("/me");
          const schoolId = me.data.school_id;
          const params = new URLSearchParams();
          if (type !== "all") params.set("type", type);
          if (sort === "price") params.set("sort", "price");
          else if (sort === "-price") params.set("sort", "-price");
          const { data } = await API.get(
            `/posts/${schoolId}${params.toString() ? `?${params}` : ""}`
          );
          if (!active) return;
          setPosts(data);
        } else {
          const { data } = await API.get("/activity/posts");
          if (!active) return;
          setPosts(data);
        }
      } catch (error) {
        console.error("Error fetching posts:", error);
        if (!active) return;
        setPosts([]);
        setFeedErr(
          isNetworkFailure(error)
            ? "The feed could not be loaded right now. The backend may be offline or blocked by CORS."
            : error?.response?.data?.error || "Failed to load posts."
        );
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [type, sort, reloadKey]);

  useEffect(() => {
    (async () => {
      setDmErr("");
      try {
        const token = localStorage.getItem("token");
        if (!token) return;
        const { data } = await API.get("/messages/inbox");
        setInbox(data || []);
      } catch {
        setInbox([]);
        setDmErr(" ");
      }
    })();
  }, []);

  return (
    <div className="browse-wrap">
      <header className="browse-topbar">
        <div>
          <p className="browse-kicker">GreekMarket</p>
          <h1>Browse</h1>
        </div>
        <div className="right-controls">
          <div className="searchbox">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search posts, descriptions, @handles..."
              aria-label="Search"
            />
          </div>
        </div>
      </header>

      <div className="filters">
        <div className="chips">
          {TYPES.map((item) => (
            <button
              key={item}
              type="button"
              className={`chip ${type === item ? "active" : ""}`}
              onClick={() => setType(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>

        <div className="sort-shell">
          <span className="sort-label">Sort posts by</span>
          <FancySelect
            className="sort-select"
            value={sort}
            onChange={setSort}
            ariaLabel="Sort posts by"
            options={SORTS}
          />
        </div>
      </div>

      {feedErr ? (
        <div className="feed-error card">
          <div className="feed-error-copy">
            <strong>We could not load listings right now</strong>
            <p>{feedErr}</p>
            <p>Try a refresh first. If the feed is still unavailable, open another section like Messages or Search while the connection recovers.</p>
          </div>
          <div className="feed-error-actions">
            <button type="button" className="cta" onClick={() => setReloadKey((current) => current + 1)}>
              Retry feed
            </button>
            <Link className="chip-link" to="/search">
              Open search
            </Link>
          </div>
        </div>
      ) : null}

      <div className="browse-body">
        <main className="browse-list">
          {loading
            ? Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} />)
            : filtered.length > 0
              ? filtered.map((post) => (
                  <div key={post.post_id} className="list-card">
                    <PostCard post={post} />
                  </div>
                ))
              : feedErr ? (
                  <div className="empty-state card">
                    <img src="/listing-placeholder.svg" alt="" />
                    <h3>Feed unavailable</h3>
                    <p>Try again in a moment or check whether the API server is reachable.</p>
                    <button type="button" className="cta" onClick={() => setReloadKey((current) => current + 1)}>
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="empty-state card">
                    <img src="/listing-placeholder.svg" alt="" />
                    <h3>{hasSearchFilters ? "No listings match this view yet" : "No listings yet"}</h3>
                    <p>
                      {hasSearchFilters
                        ? "Clear the search or switch categories to widen the results. If you already know what you want to sell, create a listing instead."
                        : "Your community has not posted anything yet. You can browse another category now or publish the first listing when you are ready."}
                    </p>
                    <div className="empty-actions">
                      {hasSearchFilters ? (
                        <button type="button" className="cta secondary" onClick={clearBrowseFilters}>
                          Clear filters
                        </button>
                      ) : null}
                      <Link className="cta" to="/create">
                        Create post
                      </Link>
                    </div>
                  </div>
                )}
        </main>

        <aside className="browse-rail">
          <div className="dm-card">
            <div className="dm-head">
              <h3>Messages</h3>
              <Link className="dm-link" to="/messages">
                Open Inbox
              </Link>
            </div>

            {!isLoggedIn ? (
              <div className="dm-empty muted">
                <strong>Log in to use messages</strong>
                <span>Once you log in, you can message sellers from any listing and keep every conversation here.</span>
                <Link className="dm-link" to="/login">
                  Log in
                </Link>
              </div>
            ) : dmErr ? (
              <div className="dm-empty muted">
                <strong>Inbox preview unavailable</strong>
                <span>Open the full inbox or refresh the page to try loading your conversations again.</span>
                <Link className="dm-link" to="/messages">
                  Open inbox
                </Link>
              </div>
            ) : inbox.length === 0 ? (
              <div className="dm-empty muted">
                <strong>No conversations yet</strong>
                <span>Start by opening any listing and tapping Message seller. New replies will appear here automatically.</span>
                <Link className="dm-link" to="/browse">
                  Browse listings
                </Link>
              </div>
            ) : (
              <div className="dm-list">
                {inbox.slice(0, 10).map((conversation) => (
                  <DMItem key={conversation.user_id} convo={conversation} />
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
