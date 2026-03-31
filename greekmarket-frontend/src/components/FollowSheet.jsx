import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "./Avatar";
import { CloseIcon } from "./icons";
import { loadFollowNetwork, toggleFollow } from "../api/follows";
import { getAuthErrorMessage } from "../utils/authErrors";
import "../styles/FollowSheet.css";

function normalizePerson(item = {}) {
  const userId = item.user_id || item.id || item.followed_user_id || item.follower_user_id || item.actor_id;
  const fallbackId =
    userId ||
    item.follower_id ||
    item.followed_id ||
    item.user?.user_id ||
    item.user?.id ||
    item.actor?.user_id ||
    item.actor?.id;
  const handle = item.handle || item.username || item.actor_handle || item.other_user_handle || "";
  const firstName = item.first_name || item.actor_first_name || "";
  const lastName = item.last_name || item.actor_last_name || "";
  const displayName =
    item.display_name ||
    item.name ||
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    item.actor_name ||
    (handle ? `@${handle}` : "Member");
  const isFollowing = Boolean(
    item.is_following || item.viewer_is_following || item.following || item.followed_by_me
  );
  const followsViewer = Boolean(
    item.follows_viewer ||
      item.is_followed_by_viewer ||
      item.followed_by_viewer ||
      item.following_back ||
      item.follow_back ||
      item.is_following_back
  );

  return {
    user_id: fallbackId,
    first_name: firstName,
    last_name: lastName,
    handle,
    display_name: displayName,
    profile_picture_url: item.profile_picture_url || item.avatar_url || "",
    school_name: item.school_name || "",
    chapter_name: item.chapter_name || "",
    is_following: isFollowing,
    follows_viewer: followsViewer,
    can_follow_back: Boolean(
      item.can_follow_back ||
        (followsViewer && !isFollowing)
    ),
  };
}

export default function FollowSheet({
  open,
  kind,
  entityId,
  entityLabel,
  initialTab = "followers",
  onClose,
  currentUserId,
  onFollowChange,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(initialTab);
  const [network, setNetwork] = useState({
    followers: [],
    following: [],
    counts: { followers: 0, following: 0 },
    available: { followers: false, following: false },
  });
  const [updatingId, setUpdatingId] = useState("");

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open || !entityId) return;
    let active = true;

    (async () => {
      setLoading(true);
      setError("");
      try {
        const next = await loadFollowNetwork(kind, entityId);
        if (!active) return;
        setNetwork(next);
      } catch (err) {
        if (!active) return;
        setError(
          getAuthErrorMessage(
            err,
            "Follower details could not be loaded right now. The backend may not expose the list endpoint yet."
          )
        );
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [entityId, kind, open]);

  const activeList = useMemo(() => {
    if (tab === "following") return network.following.map(normalizePerson);
    return network.followers.map(normalizePerson);
  }, [network.followers, network.following, tab]);

  const counts = network.counts || { followers: 0, following: 0 };
  const availableTabs = [
    { key: "followers", label: "Followers", count: counts.followers ?? network.followers.length, available: network.available.followers },
    { key: "following", label: "Following", count: counts.following ?? network.following.length, available: network.available.following },
  ].filter((item) => item.available || item.count > 0);

  async function handleFollowUser(person) {
    if (!person?.user_id) return;
    setUpdatingId(String(person.user_id));
    setError("");
    try {
      await toggleFollow("user", person.user_id, true);
      onFollowChange?.({
        person,
        kind: "user",
        entityId: person.user_id,
        following: true,
      });
      setNetwork((current) => ({
        ...current,
        followers: current.followers.map((item) =>
          String(item.user_id || item.id || item.actor_id) === String(person.user_id)
            ? { ...item, is_following: true, can_follow_back: false }
            : item
        ),
      }));
    } catch (err) {
      setError(getAuthErrorMessage(err, "Could not follow this account right now."));
    } finally {
      setUpdatingId("");
    }
  }

  if (!open) return null;

  return (
    <div className="follow-sheet-backdrop" onClick={onClose}>
      <div className="follow-sheet card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="follow-sheet-grabber" />
        <div className="follow-sheet-header">
          <div>
            <p className="follow-sheet-kicker">{kind}</p>
            <h3>{entityLabel}</h3>
          </div>
          <button type="button" className="follow-sheet-close" onClick={onClose} aria-label="Close">
            <CloseIcon className="follow-sheet-close-icon" />
          </button>
        </div>

        {availableTabs.length > 1 ? (
          <div className="follow-sheet-tabs" role="tablist" aria-label="Followers and following tabs">
            {availableTabs.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`follow-sheet-tab ${tab === item.key ? "active" : ""}`}
                onClick={() => setTab(item.key)}
                role="tab"
                aria-selected={tab === item.key}
              >
                <strong>{item.label}</strong>
                <span>{item.count ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}

        {error ? <p className="follow-sheet-error">{error}</p> : null}

        {loading ? (
          <div className="follow-sheet-loading">
            <div className="follow-sheet-loading-line" />
            <div className="follow-sheet-loading-line short" />
            <div className="follow-sheet-loading-line" />
          </div>
        ) : activeList.length ? (
          <div className="follow-sheet-list">
            {activeList.map((person) => {
              const personId = String(person.user_id || "");
              const isSelf = personId && String(currentUserId || "") === personId;
              const canFollow = tab === "followers" && personId && !isSelf && !person.is_following;
              const followLabel = person.can_follow_back ? "Follow back" : "Follow";
              return (
                <div key={personId || person.display_name} className="follow-sheet-row">
                  <Link className="follow-sheet-person" to={`/user/${person.user_id}`} onClick={onClose}>
                    <Avatar
                      size="sm"
                      user={{
                        first_name: person.first_name,
                        last_name: person.last_name,
                        handle: person.handle,
                        profile_picture_url: person.profile_picture_url,
                      }}
                    />
                    <div className="follow-sheet-copy">
                      <strong>{person.display_name}</strong>
                      <span>@{person.handle || "member"}</span>
                      {person.school_name ? <span>{person.school_name}</span> : null}
                      {person.chapter_name ? <span>{person.chapter_name}</span> : null}
                    </div>
                  </Link>
                  <div className="follow-sheet-actions">
                    {canFollow ? (
                      <button
                        type="button"
                        className="follow-sheet-action primary"
                        disabled={updatingId === personId}
                        onClick={() => handleFollowUser(person)}
                      >
                        {updatingId === personId ? "Following..." : followLabel}
                      </button>
                    ) : (
                      <span className="follow-sheet-chip">
                        {isSelf ? "You" : tab === "followers" ? (person.is_following ? "Following" : "Follower") : "Following"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="follow-sheet-empty">
            <strong>
              {tab === "followers" ? "No followers yet." : "Not following anyone yet."}
            </strong>
            <span>
              {availableTabs.length
                ? "Once the backend returns list data, people will appear here."
                : "This backend route hasn't exposed list data yet, so we can still show the counts but not the members."}
            </span>
          </div>
        )}

        <button type="button" className="follow-sheet-close-bottom" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
