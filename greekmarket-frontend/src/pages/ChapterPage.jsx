import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { loadFollowNetwork, normalizeFollowCount, toggleFollow } from "../api/follows";
import API from "../api/axios";
import Avatar from "../components/Avatar";
import FollowSheet from "../components/FollowSheet";
import ReturnButton from "../components/ReturnButton";
import PostCard from "../components/PostCard";
import SocialCountsBar from "../components/SocialCountsBar";
import { useNotifications } from "../context/NotificationsContext";
import { isNetworkFailure } from "../utils/authErrors";
import { getChapterLetterFallback } from "../utils/chapterLetters";
import "../styles/ChapterPage.css";

export default function ChapterPage() {
  const { id: chapterIdParam } = useParams();
  const chapterId = Number(chapterIdParam);
  const location = useLocation();
  const navigate = useNavigate();
  const { pushNotification } = useNotifications();
  const returnTo = location.state?.returnTo || "/search";

  const [data, setData] = useState(null);
  const [followingAction, setFollowingAction] = useState(false);
  const [requestingRole, setRequestingRole] = useState("");
  const [requestFeedback, setRequestFeedback] = useState("");
  const [requestError, setRequestError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [requestActionState, setRequestActionState] = useState({ id: 0, status: "" });
  const [followNetwork, setFollowNetwork] = useState({
    counts: { followers: 0, following: 0 },
    available: { followers: false, following: false },
  });
  const [followSheet, setFollowSheet] = useState({ open: false, tab: "followers" });
  const [viewerId, setViewerId] = useState(null);
  const chapter = data?.chapter;

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const me = await API.get("/me");
        if (!active) return;
        setViewerId(me?.data?.user_id || null);
      } catch {
        if (!active) return;
        setViewerId(null);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await API.get(`/chapters/${chapterId}`);
        if (!active) return;
        setData(data);
      } catch (err) {
        if (!active) return;
        setError(
          isNetworkFailure(err)
            ? "Chapter details could not be loaded. The backend may be offline or blocked by CORS."
            : err?.response?.data?.error || "Failed to load chapter. Search again or refresh if this chapter was just created."
        );
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [chapterId, refreshKey]);

  useEffect(() => {
    let active = true;
    if (!chapter?.chapter_id) return undefined;

    (async () => {
      try {
        const network = await loadFollowNetwork("chapter", chapter.chapter_id);
        if (!active) return;
        setFollowNetwork(network);
      } catch {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, [chapter?.chapter_id]);
  const members = useMemo(() => data?.members ?? [], [data]);
  const posts = useMemo(() => data?.recent_posts ?? [], [data]);
  const pendingRequests = useMemo(() => data?.pending_requests ?? [], [data]);
  const avatarText = getChapterLetterFallback(chapter?.name || "", 3);
  const isFollowing = Boolean(data?.is_following || data?.is_member);
  const isMember = Boolean(data?.is_member);
  const isAdmin = Boolean(data?.is_admin);
  const memberRequestPending = data?.member_request_status === "pending";
  const adminRequestPending = data?.admin_request_status === "pending";
  const followerCount =
    followNetwork.counts.followers ??
    normalizeFollowCount(data, ["followers_count", "follower_count", "followers"]);
  const followingCount =
    followNetwork.counts.following ??
    normalizeFollowCount(data, ["following_count", "following", "following_total"]);

  async function updateFollow(nextFollowState) {
    try {
      setFollowingAction(true);
      setRequestError("");
      setRequestFeedback("");
      await toggleFollow("chapter", chapterId, nextFollowState);
      setData((current) =>
        current
          ? {
              ...current,
              is_following: nextFollowState,
            }
          : current
      );
      setFollowNetwork((current) => ({
        ...current,
        counts: {
          ...current.counts,
          followers: Math.max(0, (current.counts.followers ?? followerCount) + (nextFollowState ? 1 : -1)),
        },
      }));
    } catch (err) {
      if (err?.response?.status === 401) {
        navigate("/login");
        return;
      }
      setRequestError(
        err?.response?.data?.error || "Could not update your chapter follow state. Refresh the page and try again."
      );
    } finally {
      setFollowingAction(false);
    }
  }

  async function submitRequest(role) {
    try {
      setRequestingRole(role);
      setRequestError("");
      setRequestFeedback("");
      const endpoint = role === "admin" ? "admin-request" : "membership-request";
      const { data: response } = await API.post(`/chapters/${chapterId}/${endpoint}`);
      pushNotification({
        type: "chapter",
        title: role === "admin" ? "Chapter admin request sent" : "Chapter member request sent",
        body:
          role === "admin"
            ? `Your admin request for ${chapter?.name || "this chapter"} is waiting for review.`
            : `Your membership request for ${chapter?.name || "this chapter"} is waiting for review.`,
        targetUrl: `/chapter/${chapterId}`,
        sourceKey: `chapter:${chapterId}:${role}:${Date.now()}`,
      });
      setData((current) =>
        current
          ? {
              ...current,
              is_following: true,
              member_request_status:
                role === "member" ? response?.request?.status || "pending" : current.member_request_status,
              admin_request_status:
                role === "admin" ? response?.request?.status || "pending" : current.admin_request_status,
              pending_requests:
                current.can_review_requests && response?.request
                  ? [response.request, ...(current.pending_requests || [])]
                  : current.pending_requests,
            }
          : current
      );
      setRequestFeedback(
        role === "admin"
          ? "Admin request sent to chapter leadership."
          : "Membership request sent to chapter leadership."
      );
    } catch (err) {
      if (err?.response?.status === 401) {
        navigate("/login");
        return;
      }
      setRequestError(
        err?.response?.data?.error || "Could not submit that request. Refresh the page and try again, or contact a chapter admin if it keeps failing."
      );
    } finally {
      setRequestingRole("");
    }
  }

  async function reviewRequest(requestId, status) {
    try {
      setRequestActionState({ id: requestId, status });
      setRequestError("");
      setRequestFeedback("");
      const { data: response } = await API.patch(`/chapters/${chapterId}/requests/${requestId}`, { status });
      const requestPayload = response?.request;
      setData((current) => {
        if (!current) return current;
        const nextPending = (current.pending_requests || []).filter((item) => item.request_id !== requestId);
        const approvedRole = requestPayload?.requested_role;
        const approvedRequester = requestPayload?.requester;
        let nextMembers = current.members || [];
        let nextStats = current.stats || {};

        if (status === "approved" && approvedRequester?.user_id) {
          const existingIndex = nextMembers.findIndex((item) => item.user_id === approvedRequester.user_id);
          if (approvedRole === "member" && existingIndex === -1) {
            nextMembers = [
              ...nextMembers,
              {
                ...approvedRequester,
                role: "member",
              },
            ];
            nextStats = {
              ...nextStats,
              members: (nextStats.members ?? nextMembers.length) + 1,
            };
          }
          if (approvedRole === "admin") {
            nextMembers =
              existingIndex >= 0
                ? nextMembers.map((item) =>
                    item.user_id === approvedRequester.user_id ? { ...item, role: "admin" } : item
                  )
                : nextMembers;
          }
        }

        return {
          ...current,
          pending_requests: nextPending,
          members: nextMembers,
          stats: nextStats,
        };
      });
      setRequestFeedback(`Request ${status}.`);
    } catch (err) {
      setRequestError(
        err?.response?.data?.error || "Could not update that request. Reload the chapter page and try again."
      );
    } finally {
      setRequestActionState({ id: 0, status: "" });
    }
  }

  if (loading) {
    return (
      <div className="chapter-page">
        <div className="page-return-row">
          <ReturnButton fallbackTo={returnTo} />
        </div>
        <div className="chapter-hero card">
          <p className="eyebrow">Chapter</p>
          <h1>Loading chapter...</h1>
          <p className="muted">Fetching chapter details and membership state.</p>
        </div>
      </div>
    );
  }

  if (error && !chapter) {
    return (
      <div className="chapter-page">
        <div className="page-return-row">
          <ReturnButton fallbackTo={returnTo} />
        </div>
        <div className="chapter-hero card">
          <p className="eyebrow">Chapter</p>
          <h1>Could not load chapter</h1>
          <p className="muted">{error}</p>
          <div className="chapter-actions">
            <button type="button" className="secondary-action" onClick={() => setRefreshKey((x) => x + 1)}>
              Retry
            </button>
            <button type="button" className="secondary-action" onClick={() => navigate("/search")}>
              Search chapters
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chapter-page">
      <div className="page-return-row">
        <ReturnButton fallbackTo={returnTo} />
      </div>
      <section className="chapter-hero card">
        <div className="chapter-hero-main">
          <Avatar
            size="xl"
            className="chapter-avatar"
            fallback={avatarText || "CP"}
            user={{ handle: chapter?.name, profile_picture_url: chapter?.profile_picture_url }}
          />
          <div className="chapter-copy">
            <p className="eyebrow">Chapter</p>
            <h1>{chapter?.name}</h1>
            <p className="muted">
              {chapter?.type || "Chapter"}
              {chapter?.nickname ? ` - "${chapter.nickname}"` : ""}
              {chapter?.school_name ? ` at ${chapter.school_name}` : ""}
            </p>
            <SocialCountsBar
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
                  label: "Members",
                  value: data?.stats?.members ?? 0,
                },
              ]}
            />
            <div className="chapter-actions">
              {isFollowing ? (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={isMember || followingAction}
                  onClick={() => {
                    if (!isMember) updateFollow(false);
                  }}
                >
                  {isMember ? "Following" : followingAction ? "Saving..." : "Unfollow chapter"}
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => updateFollow(true)}
                  disabled={followingAction}
                >
                  {followingAction ? "Following..." : "Follow chapter"}
                </button>
              )}
              {isAdmin ? (
                <button type="button" className="primary-action success" disabled>
                  Chapter admin
                </button>
              ) : isMember ? (
                <>
                  <button type="button" className="primary-action success" disabled>
                    Approved member
                  </button>
                  {adminRequestPending ? (
                    <button type="button" className="secondary-action" disabled>
                      Admin request pending
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary-action"
                      disabled={requestingRole === "admin"}
                      onClick={() => submitRequest("admin")}
                    >
                      {requestingRole === "admin" ? "Sending..." : "Request admin access"}
                    </button>
                  )}
                </>
              ) : memberRequestPending ? (
                <button type="button" className="primary-action" disabled>
                  Membership requested
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => submitRequest("member")}
                  disabled={requestingRole === "member"}
                >
                  {requestingRole === "member" ? "Sending..." : "Request member access"}
                </button>
              )}
            </div>
            {requestFeedback ? <p className="chapter-inline-status success">{requestFeedback}</p> : null}
            {requestError ? <p className="chapter-inline-status error">{requestError}</p> : null}
          </div>
        </div>

        <div className="chapter-stats">
          <div className="stat-card card">
            <span className="stat-value">{data?.stats?.members ?? 0}</span>
            <span className="stat-label">Members</span>
          </div>
          <div className="stat-card card">
            <span className="stat-value">{data?.stats?.recent_posts ?? 0}</span>
            <span className="stat-label">Recent posts</span>
          </div>
        </div>
      </section>

      {data?.can_review_requests ? (
        <section className="chapter-panel card">
          <div className="panel-head">
            <h3>Pending requests</h3>
            <span className="muted">{pendingRequests.length}</span>
          </div>
          {pendingRequests.length ? (
            <div className="chapter-request-list">
              {pendingRequests.map((item) => {
                const busyApprove = requestActionState.id === item.request_id && requestActionState.status === "approved";
                const busyReject = requestActionState.id === item.request_id && requestActionState.status === "rejected";
                return (
                  <div key={item.request_id} className="chapter-request-card">
                    <div className="chapter-request-copy">
                      <Avatar
                        size="sm"
                        user={{
                          first_name: item.requester?.first_name,
                          last_name: item.requester?.last_name,
                          handle: item.requester?.handle,
                          profile_picture_url: item.requester?.profile_picture_url,
                        }}
                      />
                      <div>
                        <strong>{item.requester?.display_name || "Unknown requester"}</strong>
                        <span>
                          @{item.requester?.handle || "unknown"} - wants {item.requested_role} access
                        </span>
                        {item.note ? <span>{item.note}</span> : null}
                      </div>
                    </div>
                    <div className="chapter-request-actions">
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={busyApprove || busyReject}
                        onClick={() => reviewRequest(item.request_id, "approved")}
                      >
                        {busyApprove ? "Approving..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="secondary-action danger"
                        disabled={busyApprove || busyReject}
                        onClick={() => reviewRequest(item.request_id, "rejected")}
                      >
                        {busyReject ? "Rejecting..." : "Reject"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              No chapter requests are waiting right now. New member and admin requests will show up here automatically as people apply.
            </div>
          )}
        </section>
      ) : null}

      <section className="chapter-panel card">
        <div className="panel-head">
          <h3>Recent posts</h3>
          <span className="muted">{posts.length}</span>
        </div>
        {posts.length ? (
          <div className="post-grid">
            {posts.map((post) => (
              <PostCard key={post.post_id} post={post} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            {isMember || isAdmin
              ? "No chapter posts yet. Be the first approved member to create one, or browse the wider school marketplace in the meantime."
              : "No chapter posts yet. Follow this chapter and check back later, or browse the school marketplace instead."}
          </div>
        )}
      </section>

      <section className="chapter-panel card">
        <div className="panel-head">
          <h3>Members</h3>
          <span className="muted">{members.length}</span>
        </div>
        {members.length ? (
          <div className="member-grid">
            {members.map((member) => (
              <div key={member.user_id} className="member-card">
                <Avatar
                  size="sm"
                  user={{
                    first_name: member.first_name,
                    last_name: member.last_name,
                    handle: member.handle,
                    profile_picture_url: member.profile_picture_url,
                  }}
                />
                <div className="member-meta">
                  <div className="member-name">
                    {member.first_name} {member.last_name}
                  </div>
                  <div className="muted">
                    @{member.handle}
                    {member.role ? ` - ${member.role}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            {data?.can_review_requests
              ? "No approved members yet. When people request access, you can approve them from the request queue above."
              : "No approved members yet. Follow the chapter or request member access to be first in line when membership opens up."}
          </div>
        )}
      </section>

      <FollowSheet
        open={followSheet.open}
        kind="chapter"
        entityId={chapter?.chapter_id}
        entityLabel={chapter?.name || "Chapter"}
        initialTab={followSheet.tab}
        currentUserId={viewerId}
        onClose={() => setFollowSheet({ open: false, tab: "followers" })}
      />
    </div>
  );
}
