const STORAGE_VERSION = "v1";
const NOTIFICATION_VIEWED_PREFIX = "greekmarket:notifications:viewed";
const NOTIFICATION_MANUAL_PREFIX = "greekmarket:notifications:manual";

function storageKey(prefix, accountKey) {
  return `${prefix}:${accountKey || "guest"}:${STORAGE_VERSION}`;
}

function safeRead(key, fallback) {
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep the in-memory copy alive.
  }
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  const next = new Date(value);
  return Number.isNaN(next.getTime()) ? new Date().toISOString() : next.toISOString();
}

function makeId(prefix = "notif") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getViewedNotificationKeys(accountKey) {
  return new Set(safeRead(storageKey(NOTIFICATION_VIEWED_PREFIX, accountKey), []));
}

export function setViewedNotificationKeys(accountKey, keys) {
  safeWrite(storageKey(NOTIFICATION_VIEWED_PREFIX, accountKey), Array.from(keys));
}

export function getManualNotifications(accountKey) {
  return safeRead(storageKey(NOTIFICATION_MANUAL_PREFIX, accountKey), []);
}

export function setManualNotifications(accountKey, notifications) {
  safeWrite(storageKey(NOTIFICATION_MANUAL_PREFIX, accountKey), notifications);
}

export function normalizeNotification(raw = {}) {
  const createdAt = toIso(raw.created_at || raw.createdAt || raw.timestamp || raw.sent_at);
  const actorId =
    raw.actorId ||
    raw.actor_id ||
    raw.actor?.user_id ||
    raw.actor?.id ||
    raw.user_id ||
    raw.followed_by_user_id ||
    raw.follower_user_id ||
    raw.meta?.actor_user_id ||
    raw.meta?.user_id ||
    raw.meta?.follower_user_id ||
    "";
  const sourceKey =
    raw.sourceKey ||
    raw.source_key ||
    raw.event_key ||
    raw.notification_id ||
    raw.notificationId ||
    raw.id ||
    raw.url ||
    `${raw.type || raw.notification_type || raw.event_type || "notification"}:${createdAt}`;

  return {
    id: String(raw.id || raw.notification_id || sourceKey || makeId()),
    sourceKey: String(sourceKey),
    type: raw.type || raw.notification_type || raw.event_type || "general",
    title: raw.title || raw.subject || raw.event_title || "Notification",
    body: raw.body || raw.text || raw.message || raw.description || "",
    targetUrl:
      raw.targetUrl ||
      raw.target_url ||
      raw.action_url ||
      raw.url ||
      raw.href ||
      ((String(raw.type || raw.notification_type || raw.event_type || "").startsWith("follow") && actorId)
        ? `/user/${actorId}`
        : ""),
    createdAt,
    viewedAt: raw.viewedAt || raw.viewed_at || raw.read_at || (raw.is_read ? createdAt : ""),
    actorName:
      raw.actorName ||
      raw.actor_name ||
      raw.other_user_name ||
      raw.actor?.display_name ||
      raw.actor?.full_name ||
      "",
    actorHandle: raw.actorHandle || raw.actor_handle || raw.other_user_handle || raw.actor?.handle || "",
    actorId: String(actorId || ""),
    meta: raw.meta || raw.payload || {},
  };
}

export function normalizeNotificationList(items = []) {
  return items
    .filter(Boolean)
    .map((item) => normalizeNotification(item))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function deriveInboxNotifications(inbox = []) {
  return normalizeNotificationList(
    inbox
      .filter((conversation) => Number(conversation?.unread_count || 0) > 0)
      .map((conversation) => {
        const other = conversation.other_user || {};
        const handle = other.handle || conversation.other_user_handle || conversation.handle || conversation.user_id;
        const displayName = other.display_name || conversation.other_user_name || `@${handle}`;
        const createdAt = conversation.timestamp || conversation.last_message_at || new Date().toISOString();
        return {
          id: `dm-${conversation.user_id}-${createdAt}`,
          sourceKey: `dm:${conversation.user_id}:${createdAt}`,
          type: "message",
          title: `New message from ${displayName}`,
          body: conversation.last_message_preview || conversation.last_message || "You have a new direct message.",
          targetUrl: `/messages/${conversation.user_id}`,
          createdAt,
          viewedAt: "",
          actorName: displayName,
          actorHandle: handle,
          meta: {
            unread_count: conversation.unread_count || 0,
            pinned: Boolean(conversation.pinned),
          },
        };
      })
  );
}

export function createLocalNotification({
  title,
  body,
  targetUrl = "",
  type = "general",
  sourceKey,
  meta = {},
}) {
  const createdAt = new Date().toISOString();
  return normalizeNotification({
    id: makeId("local"),
    sourceKey: sourceKey || makeId("source"),
    type,
    title,
    body,
    targetUrl,
    createdAt,
    viewedAt: "",
    meta,
  });
}

export function dedupeNotifications(notifications = []) {
  const seen = new Set();
  return notifications.filter((notification) => {
    const key = notification.sourceKey || notification.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyViewedState(notifications = [], viewedKeys = new Set()) {
  return notifications.map((notification) => ({
    ...notification,
    viewedAt:
      notification.viewedAt ||
      (viewedKeys.has(notification.sourceKey || notification.id) ? notification.createdAt : ""),
  }));
}

export function markNotificationViewed(notification, accountKey) {
  const viewed = getViewedNotificationKeys(accountKey);
  viewed.add(notification.sourceKey || notification.id);
  setViewedNotificationKeys(accountKey, viewed);
}

export function markNotificationsViewed(notifications = [], accountKey) {
  const viewed = getViewedNotificationKeys(accountKey);
  notifications.forEach((notification) => {
    viewed.add(notification.sourceKey || notification.id);
  });
  setViewedNotificationKeys(accountKey, viewed);
}

export function saveManualNotification(notification, accountKey) {
  const current = getManualNotifications(accountKey);
  const next = dedupeNotifications([notification, ...current]).slice(0, 40);
  setManualNotifications(accountKey, next);
  return next;
}
