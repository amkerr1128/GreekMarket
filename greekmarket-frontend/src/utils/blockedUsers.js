import API from "../api/axios";

const BLOCKED_USERS_CHANGED_EVENT = "greekmarket:blocked-users-changed";
const blockedCache = new Map();

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeHandle(handle) {
  return normalizeString(handle).replace(/^@+/, "").toLowerCase();
}

function normalizeBlockedUser(input = {}) {
  const userId = normalizeString(input.user_id ?? input.userId ?? input.id);
  const handle = normalizeHandle(input.handle);
  const firstName = normalizeString(input.first_name ?? input.firstName);
  const lastName = normalizeString(input.last_name ?? input.lastName);
  const displayName =
    normalizeString(input.display_name ?? input.displayName) ||
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    (handle ? `@${handle}` : "") ||
    "Blocked account";

  if (!userId && !handle) return null;

  return {
    userId,
    handle,
    firstName,
    lastName,
    displayName,
    profilePictureUrl: normalizeString(
      input.profile_picture_url ?? input.profilePictureUrl ?? input.avatar_url ?? input.avatarUrl
    ),
    schoolName: normalizeString(input.school_name ?? input.schoolName),
    blockedAt: normalizeString(input.blockedAt ?? input.blocked_at),
    reason: normalizeString(input.reason),
    source: normalizeString(input.source),
  };
}

function cacheKey(accountId) {
  return normalizeString(accountId) || "guest";
}

function emitChange(accountId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BLOCKED_USERS_CHANGED_EVENT, { detail: { accountId: cacheKey(accountId) } }));
}

function setCachedBlockedUsers(accountId, items, { notify = false } = {}) {
  const key = cacheKey(accountId);
  blockedCache.set(key, items);
  if (notify) {
    emitChange(key);
  }
  return items;
}

function readResponseItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.blocked_users)) return data.blocked_users;
  return [];
}

export async function refreshBlockedUsers(accountId) {
  if (typeof window === "undefined") return [];
  const key = cacheKey(accountId);
  if (!key || key === "guest") {
    return setCachedBlockedUsers(key, []);
  }

  const { data } = await API.get("/users/blocked");
  const items = readResponseItems(data).map(normalizeBlockedUser).filter(Boolean);
  return setCachedBlockedUsers(key, items);
}

export function getBlockedUsers(accountId) {
  return blockedCache.get(cacheKey(accountId)) || [];
}

export function isBlockedUser(accountId, candidate) {
  const blockedUsers = getBlockedUsers(accountId);
  const userId = normalizeString(candidate?.user_id ?? candidate?.userId ?? candidate?.id);
  const handle = normalizeHandle(candidate?.handle);

  return blockedUsers.some((entry) => {
    if (userId && entry.userId && entry.userId === userId) return true;
    if (handle && entry.handle && entry.handle === handle) return true;
    return false;
  });
}

export async function blockUser(accountId, candidate = {}, meta = {}) {
  const targetId = normalizeString(candidate.user_id ?? candidate.userId ?? candidate.id);
  if (!targetId) {
    throw new Error("Open the user profile or message thread again and try blocking from there.");
  }

  await API.post(`/users/${targetId}/block`, meta?.reason ? { reason: meta.reason } : {});
  const items = await refreshBlockedUsers(accountId);
  emitChange(accountId);
  return items;
}

export async function unblockUser(accountId, candidate = {}) {
  const targetId = normalizeString(candidate.user_id ?? candidate.userId ?? candidate.id);
  if (!targetId) {
    throw new Error("Open the user profile or message thread again and try unblocking from there.");
  }

  await API.delete(`/users/${targetId}/block`);
  const items = await refreshBlockedUsers(accountId);
  emitChange(accountId);
  return items;
}

export function subscribeBlockedUsers(accountId, callback) {
  if (typeof window === "undefined") return () => {};

  let active = true;
  const key = cacheKey(accountId);

  const sync = async () => {
    try {
      const next = await refreshBlockedUsers(key);
      if (!active) return;
      callback(next);
    } catch {
      if (!active) return;
      callback(getBlockedUsers(key));
    }
  };

  const handleChange = (event) => {
    if (event?.type === "greekmarket:blocked-users-changed") {
      if (event.detail?.accountId && event.detail.accountId !== key) return;
    }
    sync();
  };

  window.addEventListener(BLOCKED_USERS_CHANGED_EVENT, handleChange);
  window.addEventListener("focus", handleChange);
  sync();

  return () => {
    active = false;
    window.removeEventListener(BLOCKED_USERS_CHANGED_EVENT, handleChange);
    window.removeEventListener("focus", handleChange);
  };
}

export { BLOCKED_USERS_CHANGED_EVENT, normalizeBlockedUser };
