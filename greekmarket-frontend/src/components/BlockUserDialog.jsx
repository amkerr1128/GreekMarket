import Avatar from "./Avatar";
import { BlockIcon, CloseIcon } from "./icons";
import "../styles/UserSafety.css";

export default function BlockUserDialog({
  open,
  user,
  currentUserLabel = "your account",
  title = "Block this account?",
  description = "This hides the account from your search, messaging, and profile entry points across your account until you unblock them.",
  actionLabel = "Block account",
  busyLabel = "Blocking...",
  error = "",
  status = "",
  submitting = false,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  const handle = user?.handle || user?.user_handle || user?.other_user_handle || "";
  const displayName =
    user?.display_name ||
    user?.name ||
    [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
    (handle ? `@${handle}` : "This account");

  return (
    <>
      <div className="safety-backdrop" onClick={onCancel} />
      <div className="safety-dialog" role="dialog" aria-modal="true">
        <div className="safety-dialog-head">
          <div>
            <p className="safety-kicker">Safety</p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="safety-close" onClick={onCancel} aria-label="Close dialog">
            <CloseIcon className="safety-close-icon" />
          </button>
        </div>

        <div className="safety-user-card">
          <Avatar
            size="md"
            user={{
              first_name: user?.first_name,
              last_name: user?.last_name,
              handle,
              profile_picture_url: user?.profile_picture_url,
            }}
          />
          <div className="safety-user-copy">
            <strong>{displayName}</strong>
            <span>{handle ? `@${handle}` : `Manage blocks from ${currentUserLabel}`}</span>
          </div>
        </div>

        <p className="safety-copy">{description}</p>

        {status ? <p className="safety-status">{status}</p> : null}
        {error ? <p className="safety-error">{error}</p> : null}

        <div className="safety-actions">
          <button type="button" className="safety-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="safety-primary danger" onClick={onConfirm} disabled={submitting}>
            <BlockIcon className="safety-action-icon" />
            {submitting ? busyLabel : actionLabel}
          </button>
        </div>
      </div>
    </>
  );
}
