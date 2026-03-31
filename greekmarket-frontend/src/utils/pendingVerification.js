const PENDING_VERIFICATION_KEY = "greekmarket_pending_verification";

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

export function loadPendingVerification() {
  const storage = getStorage();
  if (!storage) return null;
  return safeParse(storage.getItem(PENDING_VERIFICATION_KEY));
}

export function savePendingVerification(payload) {
  const storage = getStorage();
  if (!storage) return null;
  const nextValue = {
    ...(loadPendingVerification() || {}),
    ...(payload || {}),
    updated_at: new Date().toISOString(),
  };
  storage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(nextValue));
  return nextValue;
}

export function clearPendingVerification() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(PENDING_VERIFICATION_KEY);
}

