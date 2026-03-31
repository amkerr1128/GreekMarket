const PENDING_PASSWORD_RESET_KEY = "greekmarket_pending_password_reset";

function safeParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getStorage() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

export function loadPendingPasswordReset() {
  const storage = getStorage();
  if (!storage) return null;
  return safeParse(storage.getItem(PENDING_PASSWORD_RESET_KEY));
}

export function savePendingPasswordReset(payload) {
  const storage = getStorage();
  if (!storage) return null;
  const nextValue = {
    ...(loadPendingPasswordReset() || {}),
    ...(payload || {}),
    updated_at: new Date().toISOString(),
  };
  storage.setItem(PENDING_PASSWORD_RESET_KEY, JSON.stringify(nextValue));
  return nextValue;
}

export function clearPendingPasswordReset() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(PENDING_PASSWORD_RESET_KEY);
}
