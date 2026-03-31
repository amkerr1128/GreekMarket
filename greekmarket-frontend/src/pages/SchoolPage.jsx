import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { loadFollowNetwork, normalizeFollowCount, toggleFollow } from "../api/follows";
import API from "../api/axios";
import Avatar from "../components/Avatar";
import FollowSheet from "../components/FollowSheet";
import ReturnButton from "../components/ReturnButton";
import SocialCountsBar from "../components/SocialCountsBar";
import { isNetworkFailure } from "../utils/authErrors";
import { getChapterLetterFallback } from "../utils/chapterLetters";
import "../styles/SchoolPage.css";

const schoolAcronym = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() || "")
    .join("");

export default function SchoolPage() {
  const { id: schoolIdParam } = useParams();
  const schoolId = Number(schoolIdParam);
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = location.state?.returnTo || "/search";
  const currentPath = `/school/${schoolId}`;

  const [school, setSchool] = useState(null);
  const [joined, setJoined] = useState(false);
  const [following, setFollowing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [followingAction, setFollowingAction] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewerId, setViewerId] = useState(null);
  const [followNetwork, setFollowNetwork] = useState({
    counts: { followers: 0, following: 0 },
    available: { followers: false, following: false },
  });
  const [followSheet, setFollowSheet] = useState({ open: false, tab: "followers" });

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

  function normalizeSchool(payload) {
    if (!payload) return null;
    if (payload.school) {
      const stats = payload.stats || {};
      return {
        ...payload.school,
        members: stats.members ?? 0,
        recent_posts: stats.recent_posts ?? 0,
        chapters: payload.chapters || [],
      };
    }
    if (payload.school_id) return payload;
    if (payload.id) return { ...payload, school_id: payload.id };
    return null;
  }

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setError("");

      try {
        const { data } = await API.get(`/schools/${schoolId}`);
        if (!active) return;

        const normalized = normalizeSchool(data);
        if (!normalized?.school_id) {
          setError("School not found.");
          setSchool(null);
          return;
        }

        setSchool(normalized);

        if (typeof data?.is_primary_school === "boolean" || typeof data?.is_following === "boolean") {
          setJoined(Boolean(data.is_primary_school || data.is_member));
          setFollowing(Boolean(data.is_following || data.is_primary_school || data.is_member));
          return;
        }

        try {
          const me = await API.get("/me");
          if (!active) return;
          setJoined(Number(me?.data?.school_id) === normalized.school_id);
          setFollowing(Boolean(Number(me?.data?.school_id) === normalized.school_id));
        } catch {
          if (!active) return;
          setJoined(false);
          setFollowing(false);
        }
      } catch (err) {
        if (!active) return;
      setError(
          isNetworkFailure(err)
            ? "School details could not be loaded. The backend may be offline or blocked by CORS."
            : err?.response?.data?.error || "Failed to load school. Try search again or refresh if this school was just added."
        );
        setSchool(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [schoolId, refreshKey]);

  useEffect(() => {
    let active = true;
    if (!school?.school_id) return undefined;

    (async () => {
      try {
        const network = await loadFollowNetwork("school", school.school_id);
        if (!active) return;
        setFollowNetwork(network);
      } catch {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, [school?.school_id]);

  const chapters = useMemo(() => school?.chapters ?? [], [school]);
  const acronym = schoolAcronym(school?.name || "");
  const followerCount =
    followNetwork.counts.followers ??
    normalizeFollowCount(school, ["followers_count", "follower_count", "followers"]);
  const followingCount =
    followNetwork.counts.following ??
    normalizeFollowCount(school, ["following_count", "following", "following_total"]);

  const handleJoin = async () => {
    if (!school) return;
    setJoining(true);
    setError("");
    try {
      await API.post(`/schools/${school.school_id}/select`);
      setJoined(true);
      setFollowing(true);
    } catch (err) {
      if (err?.response?.status === 401) {
        navigate("/login");
        return;
      }
      setError(err?.response?.data?.error || "Failed to join school.");
    } finally {
      setJoining(false);
    }
  };

  const handleFollow = async () => {
    if (!school) return;
    setFollowingAction(true);
    setError("");
    try {
      const nextFollowing = !following;
      await toggleFollow("school", school.school_id, nextFollowing);
      setFollowing(nextFollowing);
      setFollowNetwork((current) => ({
        ...current,
        counts: {
          ...current.counts,
          followers: Math.max(0, (current.counts.followers ?? followerCount) + (nextFollowing ? 1 : -1)),
        },
      }));
    } catch (err) {
      if (err?.response?.status === 401) {
        navigate("/login");
        return;
      }
      setError(err?.response?.data?.error || "Failed to follow school.");
    } finally {
      setFollowingAction(false);
    }
  };

  if (loading) {
    return (
      <div className="school-page">
        <div className="page-return-row">
          <ReturnButton fallbackTo={returnTo} />
        </div>
        <div className="school-hero card">
          <p className="eyebrow">School</p>
          <h1>Loading school...</h1>
          <p className="muted">Fetching the school profile and membership state.</p>
        </div>
      </div>
    );
  }

  if (error && !school) {
    return (
      <div className="school-page">
        <div className="page-return-row">
          <ReturnButton fallbackTo={returnTo} />
        </div>
        <div className="school-hero card">
          <p className="eyebrow">School</p>
          <h1>Could not load school</h1>
          <p className="muted">{error}</p>
          <div className="school-actions">
            <button type="button" className="secondary-action" onClick={() => setRefreshKey((x) => x + 1)}>
              Retry
            </button>
            <button type="button" className="secondary-action" onClick={() => navigate("/search")}>
              Search schools
            </button>
          </div>
        </div>
      </div>
    );
  }

  const visibleSchool = school || {};

  return (
    <div className="school-page">
      <div className="page-return-row">
        <ReturnButton fallbackTo={returnTo} />
      </div>
      <section className="school-hero card">
        <div className="school-hero-main">
          <Avatar
            size="xl"
            className="school-avatar"
            fallback={acronym || "GM"}
            user={{ handle: visibleSchool.name }}
          />
          <div className="school-copy">
            <p className="eyebrow">School</p>
            <h1>{visibleSchool.name}</h1>
            <p className="muted">{visibleSchool.domain}</p>
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
                  value: visibleSchool.members ?? 0,
                },
              ]}
            />
            <div className="school-actions">
              {following ? (
                <button type="button" className="secondary-action" onClick={handleFollow} disabled={followingAction || joined}>
                  {followingAction ? "Updating..." : joined ? "Following" : "Unfollow school"}
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={handleFollow}
                  disabled={followingAction}
                >
                  {followingAction ? "Following..." : "Follow school"}
                </button>
              )}
              {joined ? (
                <button type="button" className="primary-action success" disabled>
                  Current school
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-action"
                  onClick={handleJoin}
                  disabled={joining}
                >
                  {joining ? "Saving..." : following ? "Set as primary" : "Join school"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="school-stats">
          <div className="stat-card card">
            <span className="stat-value">{visibleSchool.members ?? 0}</span>
            <span className="stat-label">Members</span>
          </div>
          <div className="stat-card card">
            <span className="stat-value">{chapters.length}</span>
            <span className="stat-label">Chapters</span>
          </div>
          <div className="stat-card card">
            <span className="stat-value">{visibleSchool.recent_posts ?? 0}</span>
            <span className="stat-label">Recent posts</span>
          </div>
        </div>
      </section>

      <section className="school-panel card">
        <div className="panel-head">
          <h3>Chapters</h3>
          <span className="muted">{chapters.length} total</span>
        </div>

        <div className="chapter-list">
          {chapters.length ? (
            chapters.map((chapter) => (
              <button
                key={chapter.chapter_id}
                type="button"
                className="chapter-row"
                onClick={() => navigate(`/chapter/${chapter.chapter_id}`, { state: { returnTo: currentPath } })}
              >
                <Avatar
                  size="sm"
                  className="chapter-avatar"
                  fallback={getChapterLetterFallback(chapter.name, 3) || "CP"}
                  user={{ handle: chapter.name, profile_picture_url: chapter.profile_picture_url }}
                />
                <div className="chapter-meta">
                  <div className="chapter-topline">
                    <span className="chapter-name">{chapter.name}</span>
                    <span className="chip">Chapter</span>
                    {chapter.verified ? <span className="chip verified">Verified</span> : null}
                  </div>
                  <div className="muted">{chapter.type || "Chapter"}</div>
                </div>
                <div className="chapter-chevron" aria-hidden="true">
                  &gt;
                </div>
              </button>
            ))
          ) : (
            <div className="empty-state">
              No chapters are listed for this school yet. Follow this school now, browse the wider marketplace, or search again later as chapters are added.
            </div>
          )}
        </div>

        <div className="school-footer">
          <Link to="/browse">Browse posts</Link>
          <Link to="/search">Search schools</Link>
          <Link to="/create">Create post</Link>
        </div>
      </section>

      <FollowSheet
        open={followSheet.open}
        kind="school"
        entityId={school?.school_id}
        entityLabel={school?.name || "School"}
        initialTab={followSheet.tab}
        currentUserId={viewerId}
        onClose={() => setFollowSheet({ open: false, tab: "followers" })}
      />
    </div>
  );
}
