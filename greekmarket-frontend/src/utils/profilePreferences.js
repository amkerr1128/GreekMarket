const PROFILE_OVERRIDES_KEY = "greekmarket_profile_overrides";

function readStore() {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROFILE_OVERRIDES_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROFILE_OVERRIDES_KEY, JSON.stringify(store));
}

export function getProfileOverride(userId) {
  if (!userId) return null;
  const store = readStore();
  return store[String(userId)] || null;
}

export function setProfileOverride(userId, patch) {
  if (!userId) return null;
  const store = readStore();
  const key = String(userId);
  const nextValue = {
    ...(store[key] || {}),
    ...(patch || {}),
    updated_at: new Date().toISOString(),
  };

  store[key] = nextValue;
  writeStore(store);
  return nextValue;
}

export function clearProfileOverride(userId) {
  if (!userId) return;
  const store = readStore();
  delete store[String(userId)];
  writeStore(store);
}

export function applyProfileOverride(user, override = null) {
  if (!user) return user;
  const nextOverride = override || getProfileOverride(user.user_id);
  if (!nextOverride) return user;

  return {
    ...user,
    ...nextOverride,
    profile_picture_url:
      nextOverride.profile_picture_url ??
      user.profile_picture_url ??
      user.avatar_url ??
      user.author_avatar_url ??
      "",
  };
}
