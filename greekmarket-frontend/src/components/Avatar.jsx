import "../styles/Avatar.css";
import { AvatarIcon } from "./icons";

function initialsFromUser(user = {}) {
  const first = (user.first_name || "").trim();
  const last = (user.last_name || "").trim();
  if (first || last) {
    return `${first[0] || ""}${last[0] || ""}`.toUpperCase();
  }
  if (user.handle) {
    return user.handle.slice(0, 2).toUpperCase();
  }
  return "GM";
}

export default function Avatar({ user, size = "md", className = "", fallback = null, style = undefined }) {
  const initials = fallback || initialsFromUser(user);
  const photo =
    user?.profile_picture_url || user?.avatar_url || user?.author_avatar_url || user?.image_url;
  const label =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.handle || "Profile";
  const showInitials = typeof fallback === "string" && fallback.trim();
  const isLongFallback = showInitials && initials.trim().length >= 3;

  return (
    <div
      className={`avatar-fallback avatar-${size} ${photo ? "has-photo" : ""} ${className}`.trim()}
      aria-label={label}
      style={style}
    >
      {photo ? (
        <img src={photo} alt={label} />
      ) : (
        <>
          <span className="avatar-shell" aria-hidden="true" />
          {showInitials ? (
            <span className={`avatar-mark ${isLongFallback ? "avatar-mark-long" : ""}`.trim()} aria-hidden="true">
              {initials}
            </span>
          ) : (
            <AvatarIcon className="avatar-icon" />
          )}
        </>
      )}
    </div>
  );
}
