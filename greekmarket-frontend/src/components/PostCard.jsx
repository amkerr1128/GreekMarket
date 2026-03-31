import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../api/axios";
import Avatar from "./Avatar";
import { BookmarkIcon } from "./icons";
import { isNetworkFailure } from "../utils/authErrors";
import { LISTING_PLACEHOLDER, resolveListingImage } from "../utils/listingImages";
import "../styles/PostCard.css";

function PostCard({ post, onBookmarkChange, onPostChange, showOwnerActions = false }) {
  const navigate = useNavigate();
  const author = post.author || {};
  const authorHandle = author.handle || post.author_handle || post.user_handle;
  const authorName = author.display_name || post.author_name || (authorHandle ? `@${authorHandle}` : "Seller");
  const authorAvatar =
    author.profile_picture_url ||
    author.avatar_url ||
    post.author_avatar_url ||
    post.user_profile_picture_url;
  const heroImage = resolveListingImage(post.main_image_url || post.image_urls?.[0] || post.image_url);
  const category = post.type ? `${post.type[0].toUpperCase()}${post.type.slice(1)}` : null;

  const [isBookmarked, setIsBookmarked] = useState(Boolean(post.is_bookmarked || post.is_favorited));
  const [favoriteCount, setFavoriteCount] = useState(Number(post.favorite_count || 0));
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [isSold, setIsSold] = useState(Boolean(post.is_sold));
  const [sellingNow, setSellingNow] = useState(false);

  useEffect(() => {
    setIsBookmarked(Boolean(post.is_bookmarked || post.is_favorited));
    setFavoriteCount(Number(post.favorite_count || 0));
    setIsSold(Boolean(post.is_sold));
  }, [post.favorite_count, post.is_bookmarked, post.is_favorited, post.is_sold, post.post_id]);

  async function toggleBookmark(event) {
    event.preventDefault();
    event.stopPropagation();

    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login");
      return;
    }

    if (savingBookmark) return;

    const nextValue = !isBookmarked;
    const previousCount = favoriteCount;
    setSavingBookmark(true);
    setIsBookmarked(nextValue);
    setFavoriteCount((current) => Math.max(0, current + (nextValue ? 1 : -1)));

    try {
      const response = nextValue
        ? await API.post(`/posts/${post.post_id}/favorite`)
        : await API.delete(`/posts/${post.post_id}/unfavorite`);

      const nextCount =
        typeof response?.data?.favorite_count === "number"
          ? response.data.favorite_count
          : previousCount + (nextValue ? 1 : -1);
      const nextSaved = Boolean(
        response?.data?.is_bookmarked ?? response?.data?.is_favorited ?? nextValue
      );

      setIsBookmarked(nextSaved);
      setFavoriteCount(Math.max(0, nextCount));
      onBookmarkChange?.({
        ...post,
        favorite_count: Math.max(0, nextCount),
        is_bookmarked: nextSaved,
        is_favorited: nextSaved,
      });
    } catch (error) {
      setIsBookmarked(!nextValue);
      setFavoriteCount(previousCount);
      if (error?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
      }
    } finally {
      setSavingBookmark(false);
    }
  }

  async function markSold(event) {
    event.preventDefault();
    event.stopPropagation();

    if (sellingNow || isSold || !post?.is_owner) return;

    try {
      setSellingNow(true);
      await API.post(`/posts/${post.post_id}/mark-sold`);
      const nextPost = { ...post, is_sold: true };
      setIsSold(true);
      onPostChange?.(nextPost);
    } catch (error) {
      if (error?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      if (!isNetworkFailure(error)) {
        console.error("Could not mark listing sold:", error?.response?.data?.error || error.message);
      }
    } finally {
      setSellingNow(false);
    }
  }

  return (
    <article className="post-card">
      <button
        type="button"
        className={`bookmark-btn ${isBookmarked ? "active" : ""}`}
        aria-label={isBookmarked ? "Remove bookmark" : "Save post"}
        aria-pressed={isBookmarked}
        disabled={savingBookmark}
        onClick={toggleBookmark}
      >
        <BookmarkIcon className="bookmark-icon" filled={isBookmarked} />
      </button>

      <Link className="post-card-link" to={`/post/${post.post_id}`}>
        <div className="post-hero">
          <img
            src={heroImage}
            alt={post.title}
            className="post-image"
            loading="lazy"
            onError={(event) => {
              const image = event.currentTarget;
              if (image.dataset.fallbackApplied === "true") return;
              image.dataset.fallbackApplied = "true";
              image.src = LISTING_PLACEHOLDER;
            }}
          />
          {isSold ? <span className="post-status sold">Sold</span> : null}
          {post.is_owner ? <span className="post-status owner">Your listing</span> : null}
        </div>
        <div className="post-meta">
          <div className="post-meta-row">
            <div className="post-chip-row">
              {category ? <span className="post-pill">{category}</span> : <span className="post-pill">Listing</span>}
              {post.comment_count ? <span className="post-stat">{post.comment_count} comments</span> : null}
            </div>
            {favoriteCount ? <span className="post-stat">{favoriteCount} saved</span> : null}
          </div>
          <div className="post-topline">
            <Avatar
              user={{
                first_name: author.first_name || post.user_first_name,
                last_name: author.last_name || post.user_last_name,
                handle: authorHandle,
                profile_picture_url: authorAvatar,
              }}
              size="sm"
              className="post-avatar"
            />
            <div className="post-heading">
              <h3 className="post-title">{post.title}</h3>
              <p className="post-seller">{authorName}</p>
              {authorHandle ? <p className="post-handle">@{authorHandle}</p> : null}
            </div>
          </div>
          {post.price != null && <p className="post-price">${Number(post.price).toFixed(2)}</p>}
          {showOwnerActions && post.is_owner ? (
            <div className="post-owner-actions">
              <button
                type="button"
                className="post-owner-btn"
                disabled={isSold || sellingNow}
                onClick={markSold}
              >
                {isSold ? "Marked sold" : sellingNow ? "Marking sold..." : "Mark sold"}
              </button>
              <span className="post-owner-note">
                {isSold ? "This listing is already sold." : "Tap once you hand off the item."}
              </span>
            </div>
          ) : null}
        </div>
      </Link>
    </article>
  );
}

export default PostCard;
