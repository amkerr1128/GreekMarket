import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { loadFollowNetwork, normalizeFollowCount, toggleFollow } from "../api/follows";
import API from "../api/axios";
import BlockUserDialog from "../components/BlockUserDialog";
import Avatar from "../components/Avatar";
import FollowSheet from "../components/FollowSheet";
import SocialCountsBar from "../components/SocialCountsBar";
import ProfileEditorPanel from "../components/ProfileEditorPanel";
import { LISTING_PLACEHOLDER, resolveListingImage } from "../utils/listingImages";
import { BLOCKED_USERS_CHANGED_EVENT, blockUser, isBlockedUser, unblockUser } from "../utils/blockedUsers";
import ReturnButton from "../components/ReturnButton";
import { applyProfileOverride, getProfileOverride } from "../utils/profilePreferences";
import "../styles/UserSafety.css";
import "../styles/UserProfilePage.css";

export default function UserProfilePage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [me, setMe] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState("");
  const [blockStatus, setBlockStatus] = useState("");
  const [blockedTick, setBlockedTick] = useState(0);
  const [followState, setFollowState] = useState({ isFollowing: false, followingAction: false, error: "" });
  const [followNetwork, setFollowNetwork] = useState({
    counts: { followers: null, following: null },
    available: { followers: false, following: false },
  });
  const [followSheet, setFollowSheet] = useState({ open: false, tab: "followers" });

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setError("");
      try {
        const [profileRes, postsRes] = await Promise.all([API.get(`/user/${id}`), API.get(`/user/${id}/posts`)]);
        if (!active) return;
        setUser(applyProfileOverride(profileRes.data, getProfileOverride(profileRes.data?.user_id)));
        setPosts(postsRes.data || []);
        try {
          const meRes = await API.get("/me");
          if (!active) return;
          setMe(meRes.data || null);
        } catch {
          if (!active) return;
          setMe(null);
        }
      } catch (err) {
        if (!active) return;
        if (err?.response?.status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }
        setError(err?.response?.data?.error || err?.message || "Failed to load user.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [id, navigate, refreshKey]);

  useEffect(() => {
    let active = true;
    if (!user?.user_id) return undefined;

    (async () => {
      try {
        const network = await loadFollowNetwork("user", user.user_id);
        if (!active) return;
        setFollowNetwork(network);
      } catch {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.user_id]);

  useEffect(() => {
    setFollowState((current) => ({
      ...current,
      isFollowing: Boolean(
        user?.is_following ||
          user?.following ||
          user?.is_followed_by_me ||
          user?.viewer_is_following
      ),
    }));
  }, [user?.is_following, user?.following, user?.is_followed_by_me, user?.viewer_is_following]);

  useEffect(() => {
    if (!me?.user_id) return undefined;
    const syncBlocked = () => setBlockedTick((current) => current + 1);
    window.addEventListener(BLOCKED_USERS_CHANGED_EVENT, syncBlocked);
    window.addEventListener("storage", syncBlocked);
    return () => {
      window.removeEventListener(BLOCKED_USERS_CHANGED_EVENT, syncBlocked);
      window.removeEventListener("storage", syncBlocked);
    };
  }, [me?.user_id]);

  const isSelf = !!me?.user_id && Number(me.user_id) === Number(user?.user_id);
  const isBlocked = useMemo(
    () => {
      void blockedTick;
      return Boolean(me?.user_id && user?.user_id && isBlockedUser(me.user_id, user));
    },
    [blockedTick, me?.user_id, user]
  );
  const returnTo = location.state?.returnTo || "/search";
  const currentPath = `/user/${id}`;
  const followerCount = useMemo(
    () =>
      normalizeFollowCount(followNetwork, ["followers_count", "followers", "follower_count"]) ||
      normalizeFollowCount(user, ["followers_count", "followers", "follower_count"]),
    [followNetwork, user]
  );
  const followingCount = useMemo(
    () =>
      normalizeFollowCount(followNetwork, ["following_count", "following", "following_total"]) ||
      normalizeFollowCount(user, ["following_count", "following", "following_total"]),
    [followNetwork, user]
  );
  const postCount = posts.length || normalizeFollowCount(user, ["posts_count", "post_count", "post_total"]);

  async function handleToggleFollow() {
    if (!user?.user_id) return;
    setFollowState((current) => ({ ...current, followingAction: true, error: "" }));
    try {
      const nextFollow = !followState.isFollowing;
      await toggleFollow("user", user.user_id, nextFollow);
      setFollowState((current) => ({ ...current, isFollowing: nextFollow, followingAction: false, error: "" }));
      setFollowNetwork((current) => ({
        ...current,
        counts: {
          ...current.counts,
          followers: Math.max(0, (current.counts.followers || followerCount) + (nextFollow ? 1 : -1)),
        },
      }));
    } catch (err) {
      if (err?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setFollowState((current) => ({
        ...current,
        followingAction: false,
        error: err?.response?.data?.error || "Could not update follow state right now.",
      }));
    }
  }

  async function submitUserReport() {
    if (!reportReason.trim()) {
      setReportError("Add a reason so admins know what to review.");
      return;
    }

    try {
      setReportSubmitting(true);
      setReportError("");
      setReportStatus("");
      await API.post(`/users/${user.user_id || id}/report`, { reason: reportReason.trim() });
      setReportStatus("Account reported. Admins will see it in the moderation queue.");
      setReportReason("");
      setReportOpen(false);
    } catch (err) {
      if (err?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setReportError(err?.response?.data?.error || "Could not submit that report.");
    } finally {
      setReportSubmitting(false);
    }
  }

  async function handleBlockToggle() {
    if (!me?.user_id) {
      setBlockError("Log in again to manage blocked accounts.");
      return;
    }

    setBlockError("");
    setBlockStatus("");

    try {
      if (isBlocked) {
        await unblockUser(me.user_id, user);
        setBlockStatus(`Unblocked @${user?.handle || "this user"}.`);
        return;
      }

      setBlockDialogOpen(true);
    } catch (err) {
      setBlockError(err?.message || "Could not update blocked accounts right now.");
    }
  }

  async function confirmBlockUser() {
    if (!me?.user_id) {
      setBlockError("Log in again to manage blocked accounts.");
      return;
    }

    try {
      setBlockSubmitting(true);
      setBlockError("");
      setBlockStatus("");
      await blockUser(me.user_id, user, { source: "profile" });
      setBlockStatus(`Blocked @${user?.handle || "this user"}. You can undo it from Settings > Blocked accounts.`);
      setBlockDialogOpen(false);
    } catch (err) {
      setBlockError(err?.message || "Could not block that account right now.");
    } finally {
      setBlockSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="profile-page">
        <div className="page-return-row">
          <ReturnButton fallbackTo={returnTo} />
        </div>
        <div className="profile-hero card">
          <p className="eyebrow">Profile</p>
          <h1>Loading profile...</h1>
          <p className="muted">Fetching user details and recent posts.</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="profile-page">
        <div className="page-return-row">
          <ReturnButton fallbackTo={returnTo} />
        </div>
        <div className="profile-hero card">
          <p className="eyebrow">Profile</p>
          <h1>Could not load profile</h1>
          <p className="muted">{error || "User not found."}</p>
          <div className="profile-actions">
            <button type="button" className="secondary-action" onClick={() => setRefreshKey((current) => current + 1)}>
              Retry
            </button>
            <button type="button" className="secondary-action" onClick={() => navigate("/browse")}>
              Browse feed
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-main-column">
        <div className="page-return-row">
          <ReturnButton fallbackTo={returnTo} />
        </div>

          <section className="profile-hero card">
            <div className="profile-main">
              <Avatar
                size="xl"
                className="profile-avatar"
                user={{
                  first_name: user.first_name,
                  last_name: user.last_name,
                  handle: user.handle,
                  profile_picture_url: user.profile_picture_url,
                }}
              />
              <div className="profile-copy">
                <p className="eyebrow">Profile</p>
                <h1 className="profile-display-name">
                  {user.first_name} {user.last_name}
                </h1>
                <p className="profile-handle">@{user.handle}</p>
                <div className="profile-meta">
                  {user.school_id ? (
                    <Link className="meta-chip" to={`/school/${user.school_id}`} state={{ returnTo: currentPath }}>
                      {user.school_name || `School #${user.school_id}`}
                    </Link>
                  ) : (
                    <span className="meta-chip muted">School not set</span>
                  )}
                  {user.chapter_id ? (
                    <Link className="meta-chip" to={`/chapter/${user.chapter_id}`} state={{ returnTo: currentPath }}>
                      {user.chapter_name || "Chapter"}
                    </Link>
                  ) : null}
                </div>
                <SocialCountsBar
                  className="profile-counts"
                  items={[
                    {
                      label: "Followers",
                      value: followNetwork.counts.followers ?? followerCount,
                      onClick: () => setFollowSheet({ open: true, tab: "followers" }),
                    },
                    {
                      label: "Following",
                      value: followNetwork.counts.following ?? followingCount,
                      onClick: () => setFollowSheet({ open: true, tab: "following" }),
                    },
                    {
                      label: "Posts",
                      value: postCount,
                    },
                  ]}
                />
                <div className="profile-actions">
                  {isSelf ? (
                    <button type="button" className="secondary-action" onClick={() => navigate("/dashboard")}>
                      Edit profile
                    </button>
                  ) : null}
                  {!isSelf ? (
                    !isBlocked ? (
                      <button
                        type="button"
                        className={`primary-action ${followState.isFollowing ? "success" : ""}`.trim()}
                        onClick={handleToggleFollow}
                        disabled={followState.followingAction}
                      >
                        {followState.followingAction
                          ? followState.isFollowing
                            ? "Unfollowing..."
                            : "Following..."
                          : followState.isFollowing
                            ? "Unfollow"
                            : "Follow"}
                      </button>
                    ) : null
                  ) : null}
                  {!isSelf ? (
                    isBlocked ? (
                      <button type="button" className="primary-action success" disabled>
                        Message blocked
                      </button>
                    ) : (
                      <Link className="primary-action" to={`/messages/${user.user_id || id}`}>
                        Message
                      </Link>
                    )
                  ) : null}
                  {!isSelf ? (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => {
                        setReportOpen((current) => !current);
                        setReportError("");
                        setReportStatus("");
                      }}
                    >
                      {reportOpen ? "Close report" : "Report account"}
                    </button>
                  ) : null}
                  {!isSelf ? (
                    <button
                      type="button"
                      className={`secondary-action ${isBlocked ? "success" : ""}`.trim()}
                      onClick={handleBlockToggle}
                    >
                      {isBlocked ? "Unblock" : "Block user"}
                    </button>
                  ) : null}
                </div>
                {followState.error ? <p className="profile-follow-error">{followState.error}</p> : null}
                {blockStatus ? <p className="profile-report-status">{blockStatus}</p> : null}
                {blockError ? <p className="profile-report-error">{blockError}</p> : null}
              </div>
            </div>
          </section>

          {!isSelf && isBlocked ? (
            <section className="profile-panel card">
              <div className="safety-banner">
                <strong>This account is blocked.</strong>
                <span>Unblock to restore messaging, follow actions, and search visibility across your account.</span>
                <div className="safety-banner-actions">
                  <button type="button" className="secondary-action" onClick={handleBlockToggle}>
                    Unblock
                  </button>
                  <button type="button" className="secondary-action" onClick={() => navigate("/dashboard")}>
                    Manage blocks
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {!isSelf && reportOpen ? (
            <section className="profile-panel card">
              <div className="panel-head">
                <h3>Report this account</h3>
              </div>
              <label className="profile-report-field">
                <span>Reason</span>
                <textarea
                  rows={4}
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value)}
                  placeholder="Tell admins what behavior or issue needs review."
                />
              </label>
              {reportError ? <p className="profile-report-error">{reportError}</p> : null}
              {reportStatus ? <p className="profile-report-status">{reportStatus}</p> : null}
              <div className="profile-actions">
                <button type="button" className="secondary-action" onClick={() => setReportOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action"
                  disabled={reportSubmitting}
                  onClick={submitUserReport}
                >
                  {reportSubmitting ? "Sending report..." : "Submit report"}
                </button>
              </div>
            </section>
          ) : null}

          {isSelf ? (
            <ProfileEditorPanel
              user={user}
              onSaved={(nextUser) => setUser(nextUser)}
              title="Edit this profile"
              description="These changes update the public profile view and keep your current session aligned."
            />
          ) : null}

          <section className="profile-panel card">
            <div className="panel-head">
              <h3>Recent posts</h3>
              <span className="muted">{posts.length}</span>
            </div>

            {posts.length ? (
              <div className="post-grid">
                {posts.map((post) => (
                  <Link key={post.post_id} className="post-card" to={`/post/${post.post_id}`}>
                    <img
                      src={resolveListingImage(post.main_image_url || post.image_url)}
                      alt={post.title}
                      className="post-image"
                      onError={(event) => {
                        const image = event.currentTarget;
                        if (image.dataset.fallbackApplied === "true") return;
                        image.dataset.fallbackApplied = "true";
                        image.src = LISTING_PLACEHOLDER;
                      }}
                    />
                    <div className="post-info">
                      <h4>{post.title}</h4>
                      <p>{post.type}</p>
                      {post.price != null ? <p>${Number(post.price).toFixed(2)}</p> : null}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                This profile has not posted anything yet. Message the user directly or browse other listings while you wait for their first post.
              </div>
            )}
          </section>
      </div>

      <FollowSheet
        open={followSheet.open}
        kind="user"
        entityId={user?.user_id || id}
        entityLabel={`${user.first_name} ${user.last_name}`}
        initialTab={followSheet.tab}
        currentUserId={me?.user_id}
        onClose={() => setFollowSheet({ open: false, tab: "followers" })}
        onFollowChange={() => {
          setFollowSheet((current) => ({ ...current }));
          setFollowNetwork((current) => ({
            ...current,
            counts: {
              ...current.counts,
              following: Math.max(0, (current.counts.following ?? followingCount) + 1),
            },
          }));
        }}
      />

      <BlockUserDialog
        open={blockDialogOpen}
        user={user}
        currentUserLabel={me?.handle ? `@${me.handle}` : "your account"}
        title={`Block @${user?.handle || "this user"}?`}
        description="Blocking hides this account from your search results and message entry points across your account. You can undo it later from Settings > Blocked accounts."
        actionLabel="Block account"
        busyLabel="Blocking..."
        submitting={blockSubmitting}
        error={blockError}
        status={blockStatus}
        onCancel={() => {
          setBlockDialogOpen(false);
          setBlockError("");
        }}
        onConfirm={confirmBlockUser}
      />
    </div>
  );
}
