import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toggleFollow } from "../api/follows";
import { useNotifications } from "../context/NotificationsContext";
import "../styles/NotificationsPage.css";

function formatRelativeTime(value) {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";

  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(diffMinutes);

  if (absMinutes < 1) return "just now";
  if (absMinutes < 60) return `${absMinutes}m ${diffMinutes > 0 ? "from now" : "ago"}`;
  const hours = Math.round(absMinutes / 60);
  if (hours < 24) return `${hours}h ${diffMinutes > 0 ? "from now" : "ago"}`;
  const days = Math.round(absMinutes / 1440);
  return `${days}d ${diffMinutes > 0 ? "from now" : "ago"}`;
}

function notificationLabel(type) {
  if ((type || "").startsWith("message")) return "Message";
  if ((type || "").startsWith("purchase")) return "Purchase";
  if ((type || "").startsWith("support")) return "Support";
  if ((type || "").startsWith("chapter")) return "Chapter";
  if ((type || "").startsWith("school")) return "School";
  if ((type || "").startsWith("admin")) return "Admin";

  switch (type) {
    case "message":
      return "Message";
    case "post":
      return "Post";
    case "purchase":
      return "Purchase";
    case "support":
      return "Support";
    case "chapter":
      return "Chapter";
    case "school":
      return "School";
    case "admin":
      return "Admin";
    default:
      return "Update";
  }
}

function NotificationRow({ item, onOpen }) {
  const isFollowNotification = String(item.type || "").startsWith("follow");
  const actorProfileUrl = item.actorId ? `/user/${item.actorId}` : item.targetUrl || "";

  async function handleFollowBack(event) {
    event.stopPropagation();
    if (!item.actorId) return;
    try {
      await toggleFollow("user", item.actorId, true);
      onOpen({ ...item, targetUrl: actorProfileUrl });
    } catch {
      // Let the main click still open the profile or target page.
      onOpen({ ...item, targetUrl: actorProfileUrl });
    }
  }

  return (
    <div
      className={`notification-row ${item.viewedAt ? "viewed" : ""}`.trim()}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      <div className="notification-dot-wrap" aria-hidden="true">
        <span className="notification-dot" />
      </div>
      <div className="notification-copy">
        <div className="notification-topline">
          <span className="notification-pill">{notificationLabel(item.type)}</span>
          <span className="notification-time">{formatRelativeTime(item.createdAt)}</span>
        </div>
        <strong>{item.title}</strong>
        {item.body ? <p>{item.body}</p> : null}
        <span className="notification-target">
          {item.targetUrl ? "Tap to open" : "No destination attached"}
        </span>
        {isFollowNotification && item.actorId ? (
          <div className="notification-actions">
            <Link className="notification-follow-link" to={actorProfileUrl} onClick={(event) => event.stopPropagation()}>
              View profile
            </Link>
            <button type="button" className="notification-follow-button" onClick={handleFollowBack}>
              Follow back
            </button>
          </div>
        ) : null}
      </div>
      <span className="notification-chevron" aria-hidden="true">
        &gt;
      </span>
    </div>
  );
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, error, markAllViewed, markViewed, refreshNotifications } =
    useNotifications();
  const hasMarkedViewed = useRef(false);

  useEffect(() => {
    if (!loading && !error && !hasMarkedViewed.current) {
      hasMarkedViewed.current = true;
      markAllViewed();
    }
  }, [error, loading, markAllViewed]);

  function openNotification(notification) {
    markViewed(notification);
    if (!notification?.targetUrl) return;
    if (/^https?:\/\//i.test(notification.targetUrl)) {
      window.location.assign(notification.targetUrl);
      return;
    }
    navigate(notification.targetUrl);
  }

  return (
    <div className="notifications-page">
      <header className="notifications-hero card">
        <div className="notifications-hero-copy">
          <p className="notifications-kicker">Notifications</p>
          <h1>Stay on top of messages, requests, and updates.</h1>
          <p className="notifications-subtitle">
            Opening this page clears the badge. Tap any notification to jump to the post, message, or page it
            belongs to.
          </p>
        </div>
        <div className="notifications-hero-stat">
          <span className="notifications-stat-value">{unreadCount}</span>
          <span className="notifications-stat-label">Unread</span>
        </div>
      </header>

      {error ? (
        <section className="notifications-state card">
          <strong>Notifications could not be loaded.</strong>
          <p>{error}</p>
          <div className="notifications-state-actions">
            <button type="button" className="notifications-secondary" onClick={refreshNotifications}>
              Retry
            </button>
            <Link className="notifications-secondary" to="/messages">
              Open messages
            </Link>
            <Link className="notifications-primary" to="/browse">
              Go to browse
            </Link>
          </div>
        </section>
      ) : null}

      {!loading && !error && notifications.length === 0 ? (
        <section className="notifications-state card">
          <strong>You're all caught up.</strong>
          <p>
            New DMs, chapter requests, support updates, and purchase events will appear here. If you expected a
            notification, check your messages or refresh the page.
          </p>
          <div className="notifications-state-actions">
            <Link className="notifications-secondary" to="/messages">
              Check messages
            </Link>
            <Link className="notifications-primary" to="/browse">
              Back to feed
            </Link>
          </div>
        </section>
      ) : null}

      <section className="notifications-list card">
        <div className="notifications-list-head">
          <div>
            <h2>Recent activity</h2>
            <p>{notifications.length ? `${notifications.length} item${notifications.length === 1 ? "" : "s"}` : "No activity yet"}</p>
          </div>
          <span className="notifications-badge">{unreadCount}</span>
        </div>

        {loading ? (
          <div className="notifications-loading">
            <div className="notifications-loading-line" />
            <div className="notifications-loading-line short" />
            <div className="notifications-loading-line" />
          </div>
        ) : notifications.length ? (
          <div className="notifications-feed">
            {notifications.map((item) => (
              <NotificationRow key={item.sourceKey || item.id} item={item} onOpen={openNotification} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
