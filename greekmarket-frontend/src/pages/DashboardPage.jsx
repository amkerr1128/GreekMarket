import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadFollowNetwork, normalizeFollowCount } from "../api/follows";
import API from "../api/axios";
import AccountCompletionCard from "../components/AccountCompletionCard";
import Avatar from "../components/Avatar";
import FollowSheet from "../components/FollowSheet";
import SocialCountsBar from "../components/SocialCountsBar";
import ProfileEditorPanel from "../components/ProfileEditorPanel";
import BlockedUsersPanel from "../components/BlockedUsersPanel";
import PostCard from "../components/PostCard";
import ThemeToggle from "../components/ThemeToggle";
import { CloseIcon, MenuIcon } from "../components/icons";
import { useNotifications } from "../context/NotificationsContext";
import logout from "../utils/logout";
import { getAuthErrorMessage } from "../utils/authErrors";
import { setBottomNavCollapsed } from "../utils/bottomNav";
import { applyProfileOverride, getProfileOverride } from "../utils/profilePreferences";
import { resolveListingImage } from "../utils/listingImages";
import {
  activateSavedAccount,
  getSavedAccounts,
  removeSavedAccount,
  saveAccountSession,
} from "../utils/savedAccounts";
import "../styles/DashboardPage.css";

const MENU_VIEWS = {
  main: "main",
  settings: "settings",
  editProfile: "editProfile",
  activity: "activity",
  saved: "saved",
  blocked: "blocked",
  switchAccounts: "switchAccounts",
  contact: "contact",
  deleteAccount: "deleteAccount",
};

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [err, setErr] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState(MENU_VIEWS.main);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recentPosts, setRecentPosts] = useState([]);
  const [recentPostsLoading, setRecentPostsLoading] = useState(true);
  const [savedPosts, setSavedPosts] = useState([]);
  const [savedPostsLoading, setSavedPostsLoading] = useState(false);
  const [savedPostsLoaded, setSavedPostsLoaded] = useState(false);
  const [savedPostsError, setSavedPostsError] = useState("");
  const [followNetwork, setFollowNetwork] = useState({
    counts: { followers: null, following: null },
  });
  const [followSheet, setFollowSheet] = useState({ open: false, tab: "followers" });
  const [savedAccounts, setSavedAccounts] = useState(() => getSavedAccounts());
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportError, setSupportError] = useState("");
  const [supportStatus, setSupportStatus] = useState("");
  const navigate = useNavigate();
  const { pushNotification, refreshNotifications, remoteAvailable } = useNotifications();

  function openAdminWorkspace() {
    window.location.assign("/admin");
  }

  function goToPath(path) {
    navigate(path);
  }

  useEffect(() => {
    let active = true;

    (async () => {
      setRecentPostsLoading(true);
      setSavedPosts([]);
      setSavedPostsLoaded(false);
      setSavedPostsError("");
      try {
        const [profileRes, postsRes] = await Promise.allSettled([API.get("/me"), API.get("/my-posts")]);
        if (!active) return;

        if (profileRes.status === "rejected") {
          const error = profileRes.reason;
          const status = error?.response?.status;
          const jwtMessage = error?.response?.data?.msg;
          if (status === 401 || (status === 422 && jwtMessage)) {
            localStorage.removeItem("token");
            setErr(jwtMessage || "Your session expired. Please log in again.");
            setTimeout(() => navigate("/login"), 600);
            return;
          }
          setErr(getAuthErrorMessage(error, "Could not load your profile."));
          setUser(null);
          return;
        }

        const nextUser = applyProfileOverride(
          profileRes.value.data,
          getProfileOverride(profileRes.value.data?.user_id)
        );
        setUser(nextUser);
        setErr("");
        saveAccountSession({
          token: localStorage.getItem("token"),
          user: nextUser,
          email: nextUser.email,
        });
        setSavedAccounts(getSavedAccounts());

        if (postsRes.status === "fulfilled") {
          setRecentPosts(postsRes.value.data || []);
        } else {
          setRecentPosts([]);
        }
      } catch (error) {
        if (!active) return;
        setErr(getAuthErrorMessage(error, "Could not load your profile."));
        setUser(null);
      } finally {
        if (active) setRecentPostsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [navigate, refreshKey]);

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
  }, [user?.user_id, refreshKey]);

  async function loadSavedPosts() {
    setSavedPostsLoading(true);
    setSavedPostsError("");
    try {
      const { data } = await API.get("/my-favorites");
      setSavedPosts(data || []);
    } catch (error) {
      setSavedPosts([]);
      setSavedPostsError(error?.response?.data?.error || "Could not load bookmarked posts.");
    } finally {
      setSavedPostsLoaded(true);
      setSavedPostsLoading(false);
    }
  }

  useEffect(() => {
    if (menuOpen && menuView === MENU_VIEWS.saved && !savedPostsLoaded && !savedPostsLoading) {
      loadSavedPosts();
    }
  }, [menuOpen, menuView, savedPostsLoaded, savedPostsLoading]);

  useEffect(() => {
    if (menuOpen && menuView === MENU_VIEWS.switchAccounts) {
      setSavedAccounts(getSavedAccounts());
    }
  }, [menuOpen, menuView]);

  function closeMenu() {
    setMenuOpen(false);
    setMenuView(MENU_VIEWS.main);
    setDeletePassword("");
    setDeleteError("");
  }

  function openMenuView(view) {
    setMenuView(view);
    if (view === MENU_VIEWS.saved && !savedPostsLoaded) {
      loadSavedPosts();
    }
    if (view === MENU_VIEWS.switchAccounts) {
      setSavedAccounts(getSavedAccounts());
    }
  }

  function menuHeading() {
    switch (menuView) {
      case MENU_VIEWS.editProfile:
        return "Edit profile";
      case MENU_VIEWS.settings:
        return "Settings";
      case MENU_VIEWS.activity:
        return "Your activity";
      case MENU_VIEWS.saved:
        return "Bookmarked posts";
      case MENU_VIEWS.blocked:
        return "Blocked accounts";
      case MENU_VIEWS.switchAccounts:
        return "Switch accounts";
      case MENU_VIEWS.contact:
        return "Contact us";
      case MENU_VIEWS.deleteAccount:
        return "Delete account";
      default:
        return "More options";
    }
  }

  function syncPostLists(updatedPost) {
    setRecentPosts((current) =>
      current.map((post) => (post.post_id === updatedPost.post_id ? { ...post, ...updatedPost } : post))
    );

    setSavedPosts((current) => {
      if (!savedPostsLoaded) return current;
      const exists = current.some((post) => post.post_id === updatedPost.post_id);
      if (updatedPost.is_bookmarked || updatedPost.is_favorited) {
        if (exists) {
          return current.map((post) =>
            post.post_id === updatedPost.post_id ? { ...post, ...updatedPost } : post
          );
        }
        return [{ ...updatedPost }, ...current];
      }
      return current.filter((post) => post.post_id !== updatedPost.post_id);
    });
  }

  function handleBookmarkChange(updatedPost) {
    syncPostLists(updatedPost);
  }

  function handlePostChange(updatedPost) {
    syncPostLists(updatedPost);
  }

  function handleCompletionAction(item) {
    switch (item?.actionKey) {
      case "review_setup":
        setMenuOpen(true);
        setMenuView(MENU_VIEWS.settings);
        break;
      case "verify":
        navigate("/verify");
        break;
      case "school":
        navigate("/onboarding");
        break;
      case "chapter":
        navigate("/search");
        break;
      case "photo":
        setMenuOpen(true);
        setMenuView(MENU_VIEWS.editProfile);
        break;
      case "stripe":
        navigate("/account");
        break;
      default:
        navigate("/dashboard");
    }
  }

  useEffect(() => {
    setBottomNavCollapsed(menuOpen);
    return () => setBottomNavCollapsed(false);
  }, [menuOpen]);

  async function handleSavedListToggle(post) {
    try {
      await API.delete(`/posts/${post.post_id}/unfavorite`);
      setSavedPosts((current) => current.filter((item) => item.post_id !== post.post_id));
      setRecentPosts((current) =>
        current.map((item) =>
          item.post_id === post.post_id
            ? { ...item, is_bookmarked: false, is_favorited: false, favorite_count: Math.max(0, (item.favorite_count || 1) - 1) }
            : item
        )
      );
    } catch (error) {
      setSavedPostsError(error?.response?.data?.error || "Could not update that bookmark.");
    }
  }

  function switchToAccount(account) {
    if (!activateSavedAccount(account)) return;
    setSavedAccounts(getSavedAccounts());
    closeMenu();
    setRefreshKey((current) => current + 1);
    navigate("/dashboard");
  }

  function handleProfileSaved(nextUser) {
    setUser(nextUser);
    setSavedAccounts(getSavedAccounts());
    setErr("");
  }

  function forgetAccount(userId) {
    setSavedAccounts(removeSavedAccount(userId));
  }

  async function handleDeleteAccount() {
    if (!deletePassword) {
      setDeleteError("Enter your password to confirm account deletion.");
      return;
    }

    setDeletingAccount(true);
    setDeleteError("");
    try {
      await API.delete("/me", {
        data: { password: deletePassword },
      });
      removeSavedAccount(user?.user_id);
      localStorage.removeItem("token");
      closeMenu();
      navigate("/signup", {
        replace: true,
        state: { accountDeleted: true },
      });
    } catch (error) {
      setDeleteError(error?.response?.data?.error || getAuthErrorMessage(error, "Could not delete your account."));
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleSupportSubmit() {
    if (!supportSubject.trim() || !supportMessage.trim()) {
      setSupportError("Add both a subject and message so support can triage this quickly.");
      return;
    }

    setSupportSubmitting(true);
    setSupportError("");
    setSupportStatus("");
    try {
      await API.post("/support/tickets", {
        subject: supportSubject.trim(),
        message: supportMessage.trim(),
        category: "support",
      });
      if (remoteAvailable) {
        refreshNotifications();
      } else {
        pushNotification({
          type: "support",
          title: "Support request sent",
          body: supportSubject.trim() || "Your support ticket is now in the queue.",
          targetUrl: "/dashboard",
          sourceKey: `support:${Date.now()}`,
        });
      }
      setSupportSubject("");
      setSupportMessage("");
      setSupportStatus("Support request submitted. The admin queue will see it right away.");
    } catch (error) {
      setSupportError(error?.response?.data?.error || "Could not send that support request.");
    } finally {
      setSupportSubmitting(false);
    }
  }

  const followerCount =
    followNetwork.counts.followers ??
    normalizeFollowCount(user, ["followers_count", "follower_count", "followers"]);
  const followingCount =
    followNetwork.counts.following ??
    normalizeFollowCount(user, ["following_count", "following", "following_total"]);
  const postCount = useMemo(
    () => recentPosts.length || normalizeFollowCount(user, ["posts_count", "post_count", "post_total"]),
    [recentPosts.length, user]
  );

  return (
    <div className="dashboard-container">
      <header className="dashboard-header card">
        <div className="dashboard-brand">
          <img src="/MiniLogo.png" alt="GreekMarket" className="dashboard-logo" />
          <div>
            <p className="dashboard-kicker">Profile</p>
            <h2>Dashboard</h2>
          </div>
        </div>
        <button
          className="menu-btn"
          aria-label="Open menu"
          onClick={() => setMenuOpen(true)}
        >
          <MenuIcon className="menu-icon" />
        </button>
      </header>

      {!user && !err && <div className="dashboard-loading">Loading...</div>}
      {err && <p className="dashboard-error">{err}</p>}
      {err && (
        <button className="menu-btn dashboard-retry" onClick={() => setRefreshKey((current) => current + 1)}>
          Retry
        </button>
      )}

      {user ? (
        <>
          <section className="profile-card">
            <div className="profile-main">
              <Avatar user={user} size="xl" className="profile-avatar" />
              <div className="profile-copy">
                <p className="eyebrow">Profile</p>
                <h3 className="profile-display-name">
                  {user.first_name} {user.last_name}
                </h3>
                <p className="profile-handle">@{user.handle}</p>
                <div className="profile-meta">
                  {user.school_name ? (
                    <span className="meta-chip">{user.school_name}</span>
                  ) : (
                    <span className="meta-chip muted">School not set</span>
                  )}
                  {user.chapter_name ? (
                    <span className="meta-chip">
                      {user.chapter_name}
                      {user.chapter_role ? ` - ${user.chapter_role}` : ""}
                    </span>
                  ) : null}
                </div>
                <SocialCountsBar
                  className="dashboard-profile-counts"
                  items={[
                    {
                      label: "Followers",
                      value: followerCount,
                      onClick: () => setFollowSheet({ open: true, tab: "followers" }),
                    },
                    {
                      label: "Following",
                      value: followingCount,
                      onClick: () => setFollowSheet({ open: true, tab: "following" }),
                    },
                    {
                      label: "Posts",
                      value: postCount,
                    },
                  ]}
                />
                <div className="profile-actions">
                  <button
                    className="profile-edit-btn"
                    type="button"
                    onClick={() => {
                      setMenuOpen(true);
                      setMenuView(MENU_VIEWS.editProfile);
                    }}
                  >
                    Edit profile
                  </button>
                </div>
              </div>
            </div>
          </section>

          <AccountCompletionCard
            user={user}
            className="dashboard-completion-card"
            onAction={handleCompletionAction}
          />

          <section className="quick-actions">
            <Link className="qa-btn primary" to="/create">
              Create Post
            </Link>
            <button
              className="qa-btn"
              type="button"
              onClick={() => {
                setMenuOpen(true);
                openMenuView(MENU_VIEWS.saved);
              }}
            >
              Saved posts
            </button>
            <Link className={`qa-btn ${user.stripe_account_id ? "" : "warn"}`.trim()} to="/account">
              {user.stripe_account_id ? "Manage Payouts" : "Complete Account Setup"}
            </Link>
            {user.is_site_admin ? (
              <a
                className="qa-btn qa-btn-admin"
                href="/admin"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                Admin Workspace
              </a>
            ) : null}
          </section>

          <section className="dashboard-section">
            <div className="dashboard-section-head">
              <div>
                <h4>Your recent posts</h4>
                <p className="dashboard-subtle">
                  The latest listings tied to this account show up here automatically.
                </p>
              </div>
              <span className="dashboard-count">{recentPosts.length}</span>
            </div>

            {recentPostsLoading ? (
              <p className="muted">Loading your recent posts...</p>
            ) : recentPosts.length ? (
              <div className="dashboard-post-grid">
                {recentPosts.slice(0, 6).map((post) => (
                  <PostCard
                    key={post.post_id}
                    post={post}
                    onBookmarkChange={handleBookmarkChange}
                    onPostChange={handlePostChange}
                    showOwnerActions
                  />
                ))}
              </div>
            ) : (
              <div className="dashboard-empty">
                <strong>No posts yet.</strong>
                <span>Your recent listings will appear here after you publish your first one.</span>
              </div>
            )}
          </section>
        </>
      ) : null}

      <FollowSheet
        open={followSheet.open}
        kind="user"
        entityId={user?.user_id}
        entityLabel={user ? `${user.first_name} ${user.last_name}` : "Your storefront"}
        initialTab={followSheet.tab}
        currentUserId={user?.user_id}
        onClose={() => setFollowSheet({ open: false, tab: "followers" })}
        onFollowChange={() => {
          setFollowNetwork((current) => ({
            ...current,
            counts: {
              ...current.counts,
              following: Math.max(0, (current.counts.following ?? followingCount) + 1),
            },
          }));
        }}
      />

      {menuOpen ? (
        <>
          <div className="dash-backdrop" onClick={closeMenu} />
          <div
            className={`dash-sheet ${menuView === MENU_VIEWS.editProfile ? "dash-sheet-wide" : ""}`.trim()}
            role="dialog"
            aria-modal="true"
          >
            <div className="dash-grabber" />
            <div className="sheet-header">
              {menuView !== MENU_VIEWS.main ? (
                <button className="sheet-back" type="button" onClick={() => setMenuView(MENU_VIEWS.main)}>
                  Back
                </button>
              ) : (
                <span className="sheet-spacer" />
              )}
              <div>
                <p className="sheet-kicker">Profile</p>
                <h3>{menuHeading()}</h3>
              </div>
              <button className="sheet-close" type="button" onClick={closeMenu} aria-label="Close">
                <CloseIcon className="sheet-close-icon" />
              </button>
            </div>

            {menuView === MENU_VIEWS.main ? (
              <>
                <div className="sheet-group">
                  <div className="sheet-label">Settings</div>
                  <button className="sheet-item" type="button" onClick={() => openMenuView(MENU_VIEWS.editProfile)}>
                    Edit profile
                  </button>
                  <button className="sheet-item" type="button" onClick={() => openMenuView(MENU_VIEWS.settings)}>
                    Settings
                  </button>
                  <button className="sheet-item" type="button" onClick={() => openMenuView(MENU_VIEWS.activity)}>
                    Your activity
                  </button>
                  <button className="sheet-item" type="button" onClick={() => openMenuView(MENU_VIEWS.saved)}>
                    Bookmarked posts
                  </button>
                  <button className="sheet-item" type="button" onClick={() => openMenuView(MENU_VIEWS.blocked)}>
                    Blocked accounts
                  </button>
                  <button className="sheet-item" type="button" onClick={() => openMenuView(MENU_VIEWS.switchAccounts)}>
                    Switch accounts
                  </button>
                  <button className="sheet-item" type="button" onClick={() => openMenuView(MENU_VIEWS.contact)}>
                    Contact us
                  </button>
                  {user?.is_site_admin ? (
                    <button
                      className="sheet-item"
                      type="button"
                      onClick={() => {
                        openAdminWorkspace();
                      }}
                    >
                      Admin workspace
                    </button>
                  ) : null}
                  <button className="sheet-item danger" type="button" onClick={() => openMenuView(MENU_VIEWS.deleteAccount)}>
                    Delete account
                  </button>
                </div>

                <div className="sheet-group">
                  <div className="sheet-label">Shortcuts</div>
                  <button
                    className="sheet-item"
                    type="button"
                    onClick={() => {
                      goToPath("/messages");
                    }}
                  >
                    Messages
                  </button>
                  <button
                    className="sheet-item"
                    type="button"
                    onClick={() => {
                      goToPath("/purchases");
                    }}
                  >
                    Purchases
                  </button>
                  <button
                    className="sheet-item"
                    type="button"
                    onClick={() => {
                      goToPath("/create");
                    }}
                  >
                    Create Post
                  </button>
                </div>

                <button className="sheet-item danger" type="button" onClick={logout}>
                  Log out
                </button>
              </>
            ) : null}

            {menuView === MENU_VIEWS.settings ? (
              <div className="sheet-stack">
                <div className="sheet-group">
                  <div className="sheet-label">Appearance / Display</div>
                  <ThemeToggle />
                </div>
                <div className="sheet-group">
                  <div className="sheet-label">Account</div>
                  <button className="sheet-item" type="button" onClick={() => openMenuView(MENU_VIEWS.switchAccounts)}>
                    Switch accounts
                  </button>
                  <button className="sheet-item" type="button" onClick={() => openMenuView(MENU_VIEWS.blocked)}>
                    Blocked accounts
                  </button>
                  <button
                    className="sheet-item"
                    type="button"
                    onClick={() => {
                      goToPath("/purchases");
                    }}
                  >
                    Purchases
                  </button>
                  <button
                    className="sheet-item"
                    type="button"
                    onClick={() => {
                      goToPath("/messages");
                    }}
                  >
                    Messages
                  </button>
                  <button
                    className="sheet-item"
                    type="button"
                    onClick={() => {
                      goToPath("/account");
                    }}
                  >
                    {user?.stripe_account_id ? "Manage payouts" : "Complete payout setup"}
                  </button>
                  <button className="sheet-item danger" type="button" onClick={() => openMenuView(MENU_VIEWS.deleteAccount)}>
                    Delete account
                  </button>
                  {user?.is_site_admin ? (
                    <button
                      className="sheet-item"
                      type="button"
                      onClick={() => {
                        openAdminWorkspace();
                      }}
                    >
                      Open admin workspace
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {menuView === MENU_VIEWS.editProfile ? (
              <div className="sheet-stack edit-profile-stack">
                <ProfileEditorPanel
                  user={user}
                  onSaved={handleProfileSaved}
                  title="Edit your storefront"
                  description="Update your name, handle, school, and profile photo from a single place."
                />
              </div>
            ) : null}

            {menuView === MENU_VIEWS.activity ? (
              <div className="sheet-stack">
                <div className="sheet-group">
                  <div className="sheet-label">This account</div>
                  <div className="sheet-note">
                    <strong>{user?.school_name || "School not set"}</strong>
                    <span>
                      {user?.chapter_name
                        ? `${user.chapter_name}${user?.chapter_role ? ` - ${user.chapter_role}` : ""}`
                        : "No chapter connected yet."}
                    </span>
                  </div>
                  <div className="sheet-note">
                    <strong>{recentPosts.length} recent post{recentPosts.length === 1 ? "" : "s"}</strong>
                    <span>
                      {recentPosts.length
                        ? "Your latest listings are already live in the recent-post panel."
                        : "Publish a listing and it will show up in your recent-post panel right away."}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {menuView === MENU_VIEWS.saved ? (
              <div className="sheet-stack">
                <div className="sheet-group">
                  <div className="sheet-label">Bookmarked posts</div>
                  {savedPostsLoading ? (
                    <div className="sheet-note">
                      <strong>Loading your saved posts...</strong>
                      <span>Pulling the latest bookmarks tied to this account.</span>
                    </div>
                  ) : savedPostsError ? (
                    <div className="sheet-note">
                      <strong>Could not load bookmarks.</strong>
                      <span>{savedPostsError}</span>
                    </div>
                  ) : savedPosts.length ? (
                    <div className="sheet-post-list">
                      {savedPosts.map((post) => (
                        <div key={post.post_id} className="sheet-post-card">
                          <Link
                            className="sheet-post-link"
                            to={`/post/${post.post_id}`}
                            onClick={closeMenu}
                          >
                            <img
                              src={resolveListingImage(post.main_image_url || post.image_url)}
                              alt={post.title}
                              className="sheet-post-image"
                              onError={(event) => {
                                const image = event.currentTarget;
                                if (image.dataset.fallbackApplied === "true") return;
                                image.dataset.fallbackApplied = "true";
                                image.src = "/listing-placeholder.svg";
                              }}
                            />
                            <div className="sheet-post-copy">
                              <strong>{post.title}</strong>
                              <span>{post.type || "Listing"}</span>
                              <span>{post.price != null ? `$${Number(post.price).toFixed(2)}` : "Free"}</span>
                            </div>
                          </Link>
                          <button
                            className="sheet-mini-save"
                            type="button"
                            onClick={() => handleSavedListToggle(post)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="sheet-note">
                      <strong>No posts have been saved yet.</strong>
                      <span>Use the bookmark on any listing and it will show up here.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {menuView === MENU_VIEWS.blocked ? (
              <div className="sheet-stack">
                <div className="sheet-group">
                  <div className="sheet-label">Blocked accounts</div>
                  <BlockedUsersPanel accountId={user?.user_id} />
                </div>
              </div>
            ) : null}

            {menuView === MENU_VIEWS.switchAccounts ? (
              <div className="sheet-stack">
                <div className="sheet-group">
                  <div className="sheet-label">Saved accounts</div>
                  {savedAccounts.length ? (
                    <div className="account-list">
                      {savedAccounts.map((account) => {
                        const isCurrent = account.user_id === user?.user_id;
                        return (
                          <div key={account.user_id} className={`account-card ${isCurrent ? "current" : ""}`}>
                            <div className="account-copy">
                              <Avatar
                                size="sm"
                                user={{
                                  first_name: account.first_name,
                                  last_name: account.last_name,
                                  handle: account.handle,
                                  profile_picture_url: account.profile_picture_url,
                                }}
                              />
                              <div>
                                <strong>{account.display_name}</strong>
                                <span>@{account.handle || account.email}</span>
                                {account.school_name ? <span>{account.school_name}</span> : null}
                              </div>
                            </div>
                            <div className="account-actions">
                              <button
                                className={`sheet-mini-save ${isCurrent ? "current" : ""}`}
                                type="button"
                                disabled={isCurrent}
                                onClick={() => switchToAccount(account)}
                              >
                                {isCurrent ? "Current" : "Switch"}
                              </button>
                              <button
                                className="account-remove"
                                type="button"
                                onClick={() => forgetAccount(account.user_id)}
                              >
                                Forget
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="sheet-note">
                      <strong>No saved accounts yet.</strong>
                      <span>Once you log into another profile, it will appear here for quick switching.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {menuView === MENU_VIEWS.contact ? (
              <div className="sheet-stack">
                <div className="sheet-group">
                  <div className="sheet-label">Support</div>
                  <div className="sheet-note">
                    <strong>Need help or want to report an issue?</strong>
                    <span>Your message will create a support ticket in the admin workspace.</span>
                  </div>
                  <label className="support-field">
                    <span>Subject</span>
                    <input
                      type="text"
                      value={supportSubject}
                      onChange={(event) => setSupportSubject(event.target.value)}
                      placeholder="What do you need help with?"
                    />
                  </label>
                  <label className="support-field">
                    <span>Message</span>
                    <textarea
                      value={supportMessage}
                      onChange={(event) => setSupportMessage(event.target.value)}
                      placeholder="Tell support what happened, which page it happened on, and any urgent details."
                      rows={6}
                    />
                  </label>
                  {supportError ? <p className="danger-error">{supportError}</p> : null}
                  {supportStatus ? <p className="support-status">{supportStatus}</p> : null}
                  <button
                    className="sheet-item"
                    type="button"
                    disabled={supportSubmitting}
                    onClick={handleSupportSubmit}
                  >
                    {supportSubmitting ? "Sending support request..." : "Send support request"}
                  </button>
                </div>
              </div>
            ) : null}

            {menuView === MENU_VIEWS.deleteAccount ? (
              <div className="sheet-stack">
                <div className="sheet-group">
                  <div className="sheet-label">Permanent action</div>
                  <div className="sheet-note danger-note">
                    <strong>This deletes your account permanently.</strong>
                    <span>
                      Your profile, messages, saved posts, purchases tied to your account, and your listings will be removed.
                    </span>
                  </div>
                  <label className="danger-field">
                    <span>Confirm with your password</span>
                    <input
                      type="password"
                      value={deletePassword}
                      onChange={(event) => setDeletePassword(event.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                    />
                  </label>
                  {deleteError ? <p className="danger-error">{deleteError}</p> : null}
                  <button
                    className="sheet-item danger"
                    type="button"
                    disabled={deletingAccount}
                    onClick={handleDeleteAccount}
                  >
                    {deletingAccount ? "Deleting account..." : "Delete account permanently"}
                  </button>
                </div>
              </div>
            ) : null}

            <button className="sheet-cancel" type="button" onClick={closeMenu}>
              Close
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
