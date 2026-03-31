const SAVED_ACCOUNTS_KEY = "saved_accounts";

function safeParse(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sortAccounts(accounts) {
  return [...accounts].sort((left, right) => {
    const leftTime = Date.parse(left?.last_used_at || 0) || 0;
    const rightTime = Date.parse(right?.last_used_at || 0) || 0;
    return rightTime - leftTime;
  });
}

function normalizeAccount({ token, user, email }) {
  if (!token || !user?.user_id) return null;
  const displayName =
    user.display_name ||
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
    user.handle ||
    email ||
    "Saved account";

  return {
    user_id: user.user_id,
    email: user.email || email || "",
    handle: user.handle || "",
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    display_name: displayName,
    profile_picture_url: user.profile_picture_url || user.avatar_url || "",
    school_name: user.school_name || "",
    chapter_name: user.chapter_name || "",
    token,
    last_used_at: new Date().toISOString(),
  };
}

export function getSavedAccounts() {
  if (typeof window === "undefined") return [];
  return sortAccounts(safeParse(window.localStorage.getItem(SAVED_ACCOUNTS_KEY)));
}

export function saveAccountSession({ token, user, email }) {
  if (typeof window === "undefined") return [];
  const nextAccount = normalizeAccount({ token, user, email });
  if (!nextAccount) return getSavedAccounts();

  const existing = getSavedAccounts().filter((account) => account.user_id !== nextAccount.user_id);
  const nextAccounts = sortAccounts([nextAccount, ...existing]);
  window.localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(nextAccounts));
  return nextAccounts;
}

export function removeSavedAccount(userId) {
  if (typeof window === "undefined") return [];
  const nextAccounts = getSavedAccounts().filter((account) => account.user_id !== userId);
  window.localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(nextAccounts));
  return nextAccounts;
}

export function activateSavedAccount(account) {
  if (typeof window === "undefined" || !account?.token) return false;
  window.localStorage.setItem("token", account.token);
  saveAccountSession({ token: account.token, user: account, email: account.email });
  return true;
}
