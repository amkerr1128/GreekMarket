import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import API from "../api/axios";
import Avatar from "../components/Avatar";
import { BookmarkIcon } from "../components/icons";
import { isNetworkFailure } from "../utils/authErrors";
import { LISTING_PLACEHOLDER, resolveListingImage } from "../utils/listingImages";
import "../styles/PostDetailPage.css";

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function PostDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [loadingViewer, setLoadingViewer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [ownerActionLoading, setOwnerActionLoading] = useState(false);
  const [ownerActionError, setOwnerActionError] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setErr("");
      try {
        const { data } = await API.get(`/post/${id}`);
        if (!active) return;
        setPost(data);
      } catch (e) {
        if (!active) return;
        const status = e?.response?.status;
        if (status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }
        setErr(e?.response?.data?.error || e.message || "Failed to load post.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [id, navigate, refreshKey]);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      setViewer(null);
      return;
    }

    let active = true;
    (async () => {
      setLoadingViewer(true);
      try {
        const { data } = await API.get("/me");
        if (!active) return;
        setViewer(data);
      } catch {
        if (!active) return;
        setViewer(null);
      } finally {
        if (active) setLoadingViewer(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const images = useMemo(() => {
    if (!post) return [];
    if (Array.isArray(post.image_urls) && post.image_urls.length > 0) {
      return post.image_urls.map(resolveListingImage);
    }
    return post.main_image_url ? [resolveListingImage(post.main_image_url)] : [];
  }, [post]);
  const author = post?.author || {};
  const isOwner = Boolean(post?.is_owner || post?.is_mine);
  const isSold = Boolean(post?.is_sold);
  const isFree = post?.price == null || Number(post?.price) === 0;
  const sellerReady = Boolean(author?.stripe_account_id);
  const viewerVerified = Boolean(
    viewer?.has_verified_contact || viewer?.contact_verification?.has_verified_contact
  );
  const checkoutState = useMemo(() => {
    if (!post) return { label: "Buy now", disabled: true, hint: "" };
    if (isSold) return { label: "Sold", disabled: true, hint: "This listing is no longer available." };
    if (isOwner) return { label: "Your listing", disabled: true, hint: "You own this listing." };
    if (localStorage.getItem("token") && loadingViewer) {
      return {
        label: "Loading account...",
        disabled: true,
        hint: "Checking whether this account is verified for purchases.",
      };
    }
    if (localStorage.getItem("token") && !viewerVerified) {
      return {
        label: "Verify account to buy",
        disabled: false,
        hint: "A verified email or phone is required before you can make purchases.",
        mode: "verify",
      };
    }
    if (isFree) {
      return {
        label: "Free item",
        disabled: false,
        hint: "Free items are handled directly with the seller.",
        mode: "free",
      };
    }
    if (!sellerReady) {
      return {
        label: "Seller not payout-ready",
        disabled: true,
        hint: "The seller needs to finish Stripe setup before checkout can open.",
      };
    }
    return {
      label: "Buy now",
      disabled: false,
      hint: "You’ll be redirected to secure Stripe checkout.",
      mode: "checkout",
    };
  }, [isFree, isOwner, isSold, loadingViewer, post, sellerReady, viewerVerified]);

  async function toggleBookmark() {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login");
      return;
    }

    if (!post || bookmarkSaving) return;
    const nextValue = !(post.is_bookmarked || post.is_favorited);
    setBookmarkSaving(true);
    setPost((current) =>
      current
        ? {
            ...current,
            is_bookmarked: nextValue,
            is_favorited: nextValue,
            favorite_count: Math.max(0, (current.favorite_count || 0) + (nextValue ? 1 : -1)),
          }
        : current
    );

    try {
      const response = nextValue
        ? await API.post(`/posts/${id}/favorite`)
        : await API.delete(`/posts/${id}/unfavorite`);

      setPost((current) =>
        current
          ? {
              ...current,
              is_bookmarked: Boolean(response?.data?.is_bookmarked ?? response?.data?.is_favorited ?? nextValue),
              is_favorited: Boolean(response?.data?.is_favorited ?? response?.data?.is_bookmarked ?? nextValue),
              favorite_count:
                typeof response?.data?.favorite_count === "number"
                  ? response.data.favorite_count
                  : current.favorite_count,
            }
          : current
      );
    } catch (error) {
      setPost((current) =>
        current
          ? {
              ...current,
              is_bookmarked: !nextValue,
              is_favorited: !nextValue,
              favorite_count: Math.max(0, (current.favorite_count || 0) + (nextValue ? -1 : 1)),
            }
          : current
      );
      if (error?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
      }
    } finally {
      setBookmarkSaving(false);
    }
  }

  async function handlePrimaryCta() {
    if (!post || checkoutLoading) return;
    setCheckoutError("");

    if (checkoutState.mode === "free") {
      if (!post.user_id) return;
      navigate(`/messages/${post.user_id}`);
      return;
    }

    if (checkoutState.mode === "verify") {
      navigate("/verify");
      return;
    }

    if (checkoutState.disabled) return;

    if (!localStorage.getItem("token")) {
      navigate("/login");
      return;
    }

    try {
      setCheckoutLoading(true);
      const { data } = await API.post("/create-checkout-session", { post_id: post.post_id });
      const checkoutUrl = data?.checkout_url;
      if (!checkoutUrl) throw new Error("Missing checkout URL.");
      window.location.assign(checkoutUrl);
    } catch (error) {
      setCheckoutError(
        isNetworkFailure(error)
          ? "Checkout could not be reached. Check that the API server and Stripe are available."
          : error?.response?.data?.error || error?.message || "Could not start checkout."
      );
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function updateOwnerListing(nextSoldState) {
    if (!post || ownerActionLoading || !isOwner) return;

    setOwnerActionError("");
    try {
      setOwnerActionLoading(true);
      const endpoint = nextSoldState ? `/posts/${post.post_id}/mark-sold` : `/posts/${post.post_id}/relist`;
      const { data } = await API.post(endpoint);
      setPost((current) =>
        current
          ? {
              ...current,
              is_sold: Boolean(data?.is_sold ?? nextSoldState),
            }
          : current
      );
    } catch (error) {
      if (error?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setOwnerActionError(
        isNetworkFailure(error)
          ? "Could not update this listing right now. Check the API connection and try again."
          : error?.response?.data?.error || "Could not update this listing."
      );
    } finally {
      setOwnerActionLoading(false);
    }
  }

  async function deleteListing() {
    if (!post || ownerActionLoading || !isOwner) return;

    setOwnerActionError("");
    try {
      setOwnerActionLoading(true);
      await API.delete(`/posts/${post.post_id}`);
      navigate("/dashboard");
    } catch (error) {
      if (error?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setOwnerActionError(
        isNetworkFailure(error)
          ? "Could not delete this listing right now. Check the API connection and try again."
          : error?.response?.data?.error || "Could not delete this listing."
      );
      setOwnerActionLoading(false);
    }
  }

  async function submitReport() {
    if (!reportReason.trim() || !post) {
      setReportError("Add a short reason so the admin queue can act on it quickly.");
      return;
    }

    try {
      setReportSubmitting(true);
      setReportError("");
      setReportStatus("");
      await API.post(`/posts/${post.post_id}/report`, { reason: reportReason.trim() });
      setReportStatus("Report submitted. Admins will see it in the moderation queue.");
      setReportReason("");
      setReportOpen(false);
    } catch (error) {
      if (error?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setReportError(error?.response?.data?.error || "Could not submit that report.");
    } finally {
      setReportSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="post-detail-page">
        <button className="pd-back" onClick={() => navigate(-1)}>
          Back
        </button>
        <p className="pd-muted">Loading...</p>
      </div>
    );
  }

  if (err || !post) {
    return (
      <div className="post-detail-page">
        <header className="pd-head card">
          <div>
            <p className="pd-kicker">Listing</p>
            <h1>We could not open this listing</h1>
            <p className="pd-muted">
              {err || "This listing may have been removed, sold, or is temporarily unavailable."}
            </p>
          </div>
          <button className="pd-back" onClick={() => navigate(-1)}>
            Back
          </button>
        </header>
        <div className="pd-actions pd-error-actions">
          <button className="pd-back" type="button" onClick={() => setRefreshKey((current) => current + 1)}>
            Retry listing
          </button>
          <Link className="pd-link secondary" to="/browse">
            Browse feed
          </Link>
          <Link className="pd-link secondary" to="/search">
            Search instead
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="post-detail-page">
      <header className="pd-head card">
        <div>
          <p className="pd-kicker">{post.type || "Listing"}</p>
          <h1>{post.title}</h1>
        </div>
        <button className="pd-back" onClick={() => navigate(-1)}>
          Back
        </button>
      </header>

      <article className="pd-card">
        <div className="pd-gallery">
          {images.length > 0 ? (
            images.map((src, idx) => (
              <img
                key={`${src}-${idx}`}
                src={src}
                alt={post.title}
                className="pd-image"
                onError={(event) => {
                  const image = event.currentTarget;
                  if (image.dataset.fallbackApplied === "true") return;
                  image.dataset.fallbackApplied = "true";
                  image.src = LISTING_PLACEHOLDER;
                }}
              />
            ))
          ) : (
            <div className="pd-empty-media">
              <img src={LISTING_PLACEHOLDER} alt="" className="pd-fallback-image" />
            </div>
          )}
        </div>

        <div className="pd-body">
          <div className="pd-price-row">
            <span className="pd-price">
              {isFree ? "Free" : `$${Number(post.price).toFixed(2)}`}
            </span>
            {isSold ? <span className="pd-pill sold">Sold</span> : <span className="pd-pill">Available</span>}
            <span className="pd-pill">{post.visibility || "Public"}</span>
            <button
              type="button"
              className={`pd-save ${post.is_bookmarked || post.is_favorited ? "active" : ""}`}
              onClick={toggleBookmark}
              disabled={bookmarkSaving}
            >
              <BookmarkIcon className="pd-save-icon" filled={post.is_bookmarked || post.is_favorited} />
              <span>{post.is_bookmarked || post.is_favorited ? "Saved" : "Save"}</span>
            </button>
          </div>

          <div className="pd-purchase-card card">
            <div className="pd-purchase-copy">
              <div className="pd-label">Purchase</div>
              <strong>{checkoutState.label}</strong>
              <p>{checkoutError || checkoutState.hint}</p>
            </div>
            <button
              type="button"
              className="primary-action pd-buy-btn"
              onClick={handlePrimaryCta}
              disabled={checkoutLoading || checkoutState.disabled}
            >
              {checkoutLoading ? "Opening checkout..." : checkoutState.label}
            </button>
          </div>

          {isOwner ? (
            <div className="pd-manage-card card">
              <div className="pd-purchase-copy">
                <div className="pd-label">Manage listing</div>
                <strong>{isSold ? "This listing is currently marked sold" : "This listing is live and purchasable"}</strong>
                <p>
                  {ownerActionError ||
                    (isSold
                      ? "Relist it if the deal falls through or inventory changes."
                      : "Mark it sold once the handoff is complete, or remove it if you no longer want it live.")}
                </p>
              </div>
              <div className="pd-manage-actions">
                <button
                  type="button"
                  className="secondary-action pd-manage-btn"
                  onClick={() => updateOwnerListing(!isSold)}
                  disabled={ownerActionLoading}
                >
                  {ownerActionLoading ? "Saving..." : isSold ? "Relist item" : "Mark sold"}
                </button>
                {!isSold ? (
                  <button
                    type="button"
                    className="pd-manage-btn danger"
                    onClick={deleteListing}
                    disabled={ownerActionLoading}
                  >
                    Delete listing
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <p className="pd-description">
            {post.description || "No description provided."}
          </p>

          <div className="pd-seller card">
            <Avatar
              user={{
                first_name: author.first_name || post.user_first_name,
                last_name: author.last_name || post.user_last_name,
                handle: author.handle || post.user_handle,
                profile_picture_url: author.profile_picture_url || post.user_profile_picture_url,
              }}
              size="md"
            />
            <div>
              <div className="pd-label">Seller</div>
              {post.user_id ? (
                <Link to={`/user/${post.user_id}`}>
                  {author.display_name || (post.user_handle ? `@${post.user_handle}` : "View seller")}
                </Link>
              ) : (
                <span>View seller</span>
              )}
            </div>
          </div>

          <dl className="pd-meta">
            {post.school_id ? (
              <div>
                <dt>School</dt>
                <dd>
                  <Link to={`/school/${post.school_id}`}>View school</Link>
                </dd>
              </div>
            ) : null}
            {post.chapter_id ? (
              <div>
                <dt>Chapter</dt>
                <dd>
                  <Link to={`/chapter/${post.chapter_id}`}>View chapter</Link>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Created</dt>
              <dd>{formatDate(post.created_at)}</dd>
            </div>
            <div>
              <dt>Views</dt>
              <dd>{post.views ?? 0}</dd>
            </div>
          </dl>

          <div className="pd-actions">
            <Link className="pd-link" to="/browse">
              Back to browse
            </Link>
            {!isOwner && post.user_id ? (
              <Link className="pd-link secondary" to={`/messages/${post.user_id}`}>
                Message seller
              </Link>
            ) : null}
            {!isOwner ? (
              <button
                type="button"
                className="pd-link secondary"
                onClick={() => {
                  setReportOpen((current) => !current);
                  setReportError("");
                  setReportStatus("");
                }}
              >
                {reportOpen ? "Close report" : "Report listing"}
              </button>
            ) : null}
          </div>

          {!isOwner && reportOpen ? (
            <div className="pd-report card">
              <div className="pd-label">Safety report</div>
              <strong>Flag this listing for admin review</strong>
              <textarea
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
                rows={4}
                placeholder="Tell admins what is wrong with this listing so they can review it quickly."
              />
              {reportError ? <p className="pd-error">{reportError}</p> : null}
              {reportStatus ? <p className="pd-report-status">{reportStatus}</p> : null}
              <div className="pd-manage-actions">
                <button
                  type="button"
                  className="secondary-action pd-manage-btn"
                  onClick={() => setReportOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action pd-manage-btn"
                  disabled={reportSubmitting}
                  onClick={submitReport}
                >
                  {reportSubmitting ? "Sending report..." : "Submit report"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}
