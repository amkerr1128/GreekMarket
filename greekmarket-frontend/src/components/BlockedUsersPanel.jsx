import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "./Avatar";
import { getBlockedUsers, subscribeBlockedUsers, unblockUser } from "../utils/blockedUsers";
import "../styles/BlockedUsersPanel.css";

function formatBlockedAt(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

export default function BlockedUsersPanel({ accountId }) {
  const [blockedUsers, setBlockedUsers] = useState(() => getBlockedUsers(accountId));
  const [busyKey, setBusyKey] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => subscribeBlockedUsers(accountId, setBlockedUsers), [accountId]);

  async function handleUnblock(entry) {
    const key = entry.userId || entry.handle;
    if (!key) return;

    try {
      setBusyKey(key);
      setError("");
      setStatus("");
      await unblockUser(accountId, entry);
      setStatus(`Unblocked ${entry.displayName || entry.handle || "this account"}.`);
    } catch (err) {
      setError(err?.message || "Could not update blocked accounts right now.");
    } finally {
      setBusyKey("");
    }
  }

  if (!accountId) {
    return (
      <div className="blocked-users-panel">
        <div className="sheet-note">
          <strong>Log in to manage blocked accounts.</strong>
          <span>Your block list is tied to the signed-in storefront.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="blocked-users-panel">
      <div className="sheet-note">
        <strong>Blocked accounts are hidden from your search and message entry points across your account.</strong>
        <span>Unblock anyone here if you want them back in your marketplace flow on every device.</span>
      </div>

      {status ? <p className="blocked-status">{status}</p> : null}
      {error ? <p className="blocked-error">{error}</p> : null}

      {blockedUsers.length ? (
        <div className="blocked-list">
          {blockedUsers.map((entry) => {
            const key = entry.userId || entry.handle;
            const busy = busyKey === key;

            return (
              <div key={key} className="blocked-card">
                <div className="blocked-card-main">
                  <Avatar
                    size="sm"
                    user={{
                      first_name: entry.firstName,
                      last_name: entry.lastName,
                      handle: entry.handle,
                      profile_picture_url: entry.profilePictureUrl,
                    }}
                  />
                  <div className="blocked-card-copy">
                    <strong>{entry.displayName}</strong>
                    <span>{entry.handle ? `@${entry.handle}` : "Blocked account"}</span>
                    {formatBlockedAt(entry.blockedAt) ? <small>Blocked {formatBlockedAt(entry.blockedAt)}</small> : null}
                  </div>
                </div>

                <div className="blocked-card-actions">
                  {entry.userId ? (
                    <Link className="blocked-mini-button" to={`/user/${entry.userId}`}>
                      View profile
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="blocked-mini-button danger"
                    disabled={busy}
                    onClick={() => handleUnblock(entry)}
                  >
                    {busy ? "Unblocking..." : "Unblock"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="blocked-empty">
          <strong>No blocked accounts yet.</strong>
          <span>Use Block on a profile or message thread if you need to hide an account later.</span>
        </div>
      )}
    </div>
  );
}
