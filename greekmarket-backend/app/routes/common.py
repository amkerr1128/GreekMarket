import os
from flask_jwt_extended import get_jwt_identity
from html import escape
from urllib.parse import quote
from zlib import crc32

from .. import db
from ..models import (
    BlockedUser,
    ContactVerificationChallenge,
    Chapter,
    ChapterFollow,
    ChapterJoinRequest,
    Message,
    MessageReaction,
    MessageReply,
    Post,
    PendingRegistration,
    School,
    SchoolMembership,
    SiteAdmin,
    User,
    UserChapterMembership,
    UserContactMethod,
    UserFollow,
)
from ..utils import to_int
from ..services.verification import get_user_contact_summary, get_user_profile_completion

MAX_POST_TITLE_LENGTH = 255
MAX_POST_TYPE_LENGTH = 50
MAX_POST_DESCRIPTION_LENGTH = 4000
MAX_COMMENT_LENGTH = 1000
MAX_MESSAGE_LENGTH = 2000
MAX_REPORT_REASON_LENGTH = 255
MAX_SUPPORT_SUBJECT_LENGTH = 255
MAX_SUPPORT_MESSAGE_LENGTH = 5000
MAX_SUPPORT_NOTE_LENGTH = 5000
MAX_CHAPTER_REQUEST_NOTE_LENGTH = 1000
MAX_HANDLE_LENGTH = 50
MAX_SEARCH_QUERY_LENGTH = 100
VALID_LISTING_VISIBILITIES = {"public", "school", "chapter"}


def _svg_data_uri(svg: str) -> str:
    return "data:image/svg+xml;utf8," + quote(svg, safe="")


def build_placeholder_avatar_url(display_name: str | None) -> str:
    name = (display_name or "").strip() or "GM"
    initials = "".join(part[0] for part in name.split()[:2]).upper() or "GM"
    svg = f"""
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="{name}">
      <rect width="128" height="128" rx="64" fill="#1f2937"/>
      <circle cx="64" cy="64" r="58" fill="#0f172a"/>
      <text x="64" y="74" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="#f8fafc">{initials}</text>
    </svg>
    """.strip()
    return _svg_data_uri(svg)


def build_placeholder_post_image_url(title: str | None) -> str:
    label = (title or "Greek Market listing").strip()[:72] or "Greek Market listing"
    svg = f"""
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="960" viewBox="0 0 960 960" role="img" aria-label="{escape(label)}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#111827"/>
          <stop offset="100%" stop-color="#334155"/>
        </linearGradient>
      </defs>
      <rect width="960" height="960" fill="url(#g)"/>
      <circle cx="750" cy="210" r="140" fill="#f59e0b" opacity="0.14"/>
      <circle cx="180" cy="760" r="170" fill="#38bdf8" opacity="0.12"/>
      <text x="80" y="160" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="700" fill="#e2e8f0">Greek Market</text>
      <text x="80" y="294" font-family="Arial, Helvetica, sans-serif" font-size="84" font-weight="700" fill="#ffffff">Listing preview</text>
      <text x="80" y="382" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#cbd5e1">Upload a photo to replace this placeholder.</text>
    </svg>
    """.strip()
    return _svg_data_uri(svg)


def school_tag_color(school: School | None) -> str | None:
    if not school:
        return None
    palette = [
        "#1d4ed8",
        "#0f766e",
        "#7c3aed",
        "#b45309",
        "#be123c",
        "#0369a1",
    ]
    seed = str(school.domain or school.school_id or school.name or "")
    return palette[crc32(seed.encode("utf-8")) % len(palette)]


def _normalized_email(email: str | None) -> str:
    return (email or "").strip().lower()


def _emails_from_env(var_name: str) -> set[str]:
    raw = os.getenv(var_name, "")
    return {_normalized_email(item) for item in raw.split(",") if _normalized_email(item)}


def configured_owner_emails() -> set[str]:
    owners = _emails_from_env("OWNER_EMAIL") | _emails_from_env("OWNER_EMAILS")
    environment = (os.getenv("APP_ENV") or os.getenv("FLASK_ENV") or "development").lower()
    if not owners and environment != "production":
        owners.add("austin@example.com")
    return owners


def configured_site_admin_emails() -> set[str]:
    return _emails_from_env("SITE_ADMIN_EMAILS") | _emails_from_env("ADMIN_EMAILS")


def is_owner_email(email: str | None) -> bool:
    return _normalized_email(email) in configured_owner_emails()


def is_site_admin_user(user: User | None) -> bool:
    if not user:
        return False
    email = _normalized_email(user.email)
    if email in configured_owner_emails() or email in configured_site_admin_emails():
        return True
    return SiteAdmin.query.filter_by(user_id=user.user_id).first() is not None


def serialize_school(
    school: School | None,
    *,
    viewer_user_id: int | None = None,
    include_follow_metadata: bool = False,
) -> dict | None:
    if not school:
        return None
    payload = {
        "school_id": school.school_id,
        "name": school.name,
        "domain": school.domain,
        "tag_color": school_tag_color(school),
    }
    if include_follow_metadata:
        follower_count = school_follower_count(school.school_id)
        payload["followers_count"] = follower_count
        payload["member_count"] = follower_count
        if viewer_user_id is not None:
            payload["is_following"] = school_following_state(viewer_user_id, school.school_id) or (
                User.query.filter_by(user_id=viewer_user_id, school_id=school.school_id).first() is not None
            )
            payload["is_member"] = payload["is_following"]
    return payload


def current_user_id():
    """Return the current JWT subject as an int when present."""
    identity = get_jwt_identity()
    return to_int(identity)


def is_blocked(user_id: int, other_user_id: int) -> bool:
    """Return True if either user has blocked the other."""
    return BlockedUser.query.filter(
        db.or_(
            db.and_(
                BlockedUser.user_id == user_id,
                BlockedUser.blocked_user_id == other_user_id,
            ),
            db.and_(
                BlockedUser.user_id == other_user_id,
                BlockedUser.blocked_user_id == user_id,
            ),
        )
    ).first() is not None


def viewer_has_blocked_user(viewer_user_id: int | None, target_user_id: int | None) -> bool:
    if not viewer_user_id or not target_user_id or viewer_user_id == target_user_id:
        return False
    return (
        BlockedUser.query.filter_by(user_id=viewer_user_id, blocked_user_id=target_user_id).first()
        is not None
    )


def user_has_blocked_viewer(viewer_user_id: int | None, target_user_id: int | None) -> bool:
    if not viewer_user_id or not target_user_id or viewer_user_id == target_user_id:
        return False
    return (
        BlockedUser.query.filter_by(user_id=target_user_id, blocked_user_id=viewer_user_id).first()
        is not None
    )


def user_is_chapter_admin(user_id: int | None, chapter_id: int) -> bool:
    if not user_id:
        return False
    return (
        UserChapterMembership.query.filter_by(user_id=user_id, chapter_id=chapter_id, role="admin").first()
        is not None
    )


def user_has_verified_contact(user: User | None) -> bool:
    if not user:
        return False
    return bool(get_user_contact_summary(user).get("has_verified_contact"))


def chapter_following_state(user_id: int | None, chapter_id: int) -> bool:
    if not user_id:
        return False
    return ChapterFollow.query.filter_by(user_id=user_id, chapter_id=chapter_id).first() is not None


def school_following_state(user_id: int | None, school_id: int) -> bool:
    if not user_id:
        return False
    return SchoolMembership.query.filter_by(user_id=user_id, school_id=school_id).first() is not None


def user_following_state(follower_id: int | None, followed_id: int) -> bool:
    if not follower_id or follower_id == followed_id:
        return False
    return (
        UserFollow.query.filter_by(follower_id=follower_id, followed_user_id=followed_id).first() is not None
    )


def user_follower_count(user_id: int | None) -> int:
    if not user_id:
        return 0
    return UserFollow.query.filter_by(followed_user_id=user_id).count()


def user_following_count(user_id: int | None) -> int:
    if not user_id:
        return 0
    return UserFollow.query.filter_by(follower_id=user_id).count()


def user_follower_ids(user_id: int | None) -> set[int]:
    if not user_id:
        return set()
    return {
        follower_id
        for (follower_id,) in db.session.query(UserFollow.follower_id)
        .filter_by(followed_user_id=user_id)
        .all()
    }


def user_following_ids(user_id: int | None) -> set[int]:
    if not user_id:
        return set()
    return {
        followed_user_id
        for (followed_user_id,) in db.session.query(UserFollow.followed_user_id)
        .filter_by(follower_id=user_id)
        .all()
    }


def chapter_follower_count(chapter_id: int | None) -> int:
    if not chapter_id:
        return 0
    return len(chapter_follower_user_ids(chapter_id))


def chapter_follower_user_ids(chapter_id: int | None) -> set[int]:
    if not chapter_id:
        return set()
    member_ids = {
        user_id
        for (user_id,) in db.session.query(UserChapterMembership.user_id).filter_by(chapter_id=chapter_id).all()
    }
    follow_ids = {
        user_id for (user_id,) in db.session.query(ChapterFollow.user_id).filter_by(chapter_id=chapter_id).all()
    }
    return member_ids | follow_ids


def school_follower_count(school_id: int | None) -> int:
    if not school_id:
        return 0
    return len(school_follower_user_ids(school_id))


def school_follower_user_ids(school_id: int | None) -> set[int]:
    if not school_id:
        return set()
    user_ids = {user_id for (user_id,) in db.session.query(User.user_id).filter_by(school_id=school_id).all()}
    user_ids.update(
        user_id for (user_id,) in db.session.query(SchoolMembership.user_id).filter_by(school_id=school_id).all()
    )
    return user_ids


def latest_chapter_request(user_id: int | None, chapter_id: int, requested_role: str | None = None) -> ChapterJoinRequest | None:
    if not user_id:
        return None
    query = ChapterJoinRequest.query.filter_by(user_id=user_id, chapter_id=chapter_id)
    if requested_role:
        query = query.filter_by(requested_role=requested_role)
    return query.order_by(ChapterJoinRequest.created_at.desc()).first()


def serialize_user(
    user: User,
    include_verification_details: bool = False,
    *,
    viewer_user_id: int | None = None,
    include_follow_metadata: bool = False,
    include_private_fields: bool = False,
) -> dict:
    full_name = f"{user.first_name} {user.last_name}".strip()
    display_name = full_name if full_name else user.handle
    avatar_url = user.profile_picture_url or build_placeholder_avatar_url(display_name)
    can_view_private = bool(include_private_fields or (viewer_user_id and viewer_user_id == user.user_id))
    verified_contact = user_has_verified_contact(user) if can_view_private or include_verification_details else False
    is_owner = is_owner_email(user.email) if can_view_private else False
    is_site_admin = is_site_admin_user(user) if can_view_private else False

    payload = {
        "user_id": user.user_id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": full_name,
        "display_name": display_name,
        "handle": user.handle,
        "school_id": user.school_id,
        "school_name": user.school.name if user.school else None,
        "school_domain": user.school.domain if user.school else None,
        "profile_picture_url": avatar_url,
        "avatar_url": avatar_url,
        "has_profile_picture": bool(user.profile_picture_url),
    }
    if can_view_private:
        payload["email"] = user.email
        payload["stripe_account_id"] = user.stripe_account_id
        payload["has_verified_contact"] = verified_contact
        payload["is_owner"] = is_owner
        payload["is_site_admin"] = is_site_admin
    if include_follow_metadata:
        payload["followers_count"] = user_follower_count(user.user_id)
        payload["following_count"] = user_following_count(user.user_id)
        if viewer_user_id is not None:
            viewer_blocked_user = viewer_has_blocked_user(viewer_user_id, user.user_id)
            user_blocked_viewer = user_has_blocked_viewer(viewer_user_id, user.user_id)
            any_block_relationship = bool(viewer_blocked_user or user_blocked_viewer)
            payload["is_following"] = user_following_state(viewer_user_id, user.user_id)
            payload["follows_viewer"] = user_following_state(user.user_id, viewer_user_id)
            payload["is_followed_by_viewer"] = payload["follows_viewer"]
            payload["is_blocked_by_viewer"] = viewer_blocked_user
            payload["has_blocked_viewer"] = user_blocked_viewer
            payload["has_any_block_relationship"] = any_block_relationship
            payload["can_follow"] = bool(viewer_user_id != user.user_id and not any_block_relationship)
            payload["can_follow_back"] = bool(
                payload["follows_viewer"] and not payload["is_following"] and not any_block_relationship
            )
    if include_verification_details:
        payload["contact_verification"] = get_user_contact_summary(user)
        payload["profile_completion"] = get_user_profile_completion(user)
    return payload


def viewer_allowed_chapter_ids(user_id: int | None) -> set[int]:
    if not user_id:
        return set()
    return {
        chapter_id
        for (chapter_id,) in db.session.query(UserChapterMembership.chapter_id).filter_by(user_id=user_id).all()
    }


def can_manage_post(post: Post | None, viewer_user_id: int | None = None, viewer: User | None = None) -> bool:
    if not post or not viewer_user_id:
        return False
    if post.user_id == viewer_user_id:
        return True
    if viewer is None:
        viewer = User.query.get(viewer_user_id)
    return is_site_admin_user(viewer)


def post_visible_to_viewer(
    post: Post | None,
    viewer_user_id: int | None = None,
    *,
    viewer: User | None = None,
    allowed_chapter_ids: set[int] | list[int] | None = None,
) -> bool:
    if not post:
        return False
    if can_manage_post(post, viewer_user_id, viewer):
        return True
    if viewer_user_id and is_blocked(viewer_user_id, post.user_id):
        return False
    if post.visibility == "hidden":
        return False
    if post.visibility == "public":
        return True
    if not viewer_user_id:
        return False
    if viewer is None:
        viewer = User.query.get(viewer_user_id)
    if not viewer:
        return False
    if post.visibility == "school":
        return bool(viewer.school_id and viewer.school_id == post.school_id)
    if post.visibility == "chapter":
        allowed = set(allowed_chapter_ids) if allowed_chapter_ids is not None else viewer_allowed_chapter_ids(viewer_user_id)
        return bool(post.chapter_id and post.chapter_id in allowed)
    return False


def serialize_post(post: Post) -> dict:
    return serialize_post_with_viewer(post)


def _favorite_ids_for_user(user_id: int | None) -> set[int]:
    if not user_id:
        return set()
    from ..models import Favorite

    return {fav.post_id for fav in Favorite.query.filter_by(user_id=user_id).all()}


def serialize_post_with_viewer(
    post: Post,
    viewer_user_id: int | None = None,
    favorite_post_ids: set[int] | None = None,
) -> dict:
    author = serialize_user(post.user) if post.user else None
    image_urls = [img.url for img in post.images]
    main_image_url = image_urls[0] if image_urls else build_placeholder_post_image_url(post.title)
    favorite_post_ids = favorite_post_ids if favorite_post_ids is not None else _favorite_ids_for_user(viewer_user_id)
    is_favorited = bool(viewer_user_id and post.post_id in favorite_post_ids)
    is_owner = bool(viewer_user_id and post.user_id == viewer_user_id)
    return {
        "post_id": post.post_id,
        "title": post.title,
        "type": post.type,
        "description": post.description,
        "price": float(post.price) if post.price is not None else None,
        "user_id": post.user_id,
        "author": author,
        "user_handle": author["handle"] if author else None,
        "author_handle": author["handle"] if author else None,
        "author_name": author["display_name"] if author else None,
        "author_avatar_url": author["avatar_url"] if author else None,
        "school_id": post.school_id,
        "chapter_id": post.chapter_id,
        "is_sold": post.is_sold,
        "visibility": post.visibility,
        "is_owner": is_owner,
        "is_mine": is_owner,
        "can_edit": is_owner,
        "can_toggle_sold": is_owner,
        "can_delete": is_owner,
        "created_at": post.created_at.isoformat(),
        "main_image_url": main_image_url,
        "preview_image_url": main_image_url,
        "image_urls": image_urls,
        "has_images": bool(image_urls),
        "image_count": len(image_urls),
        "comment_count": len(post.comments) if post.comments is not None else 0,
        "favorite_count": len(post.favorites) if post.favorites is not None else 0,
        "is_favorited": is_favorited,
        "is_bookmarked": is_favorited,
    }


def serialize_post_summary(post: Post) -> dict:
    return serialize_post_summary_with_viewer(post)


def serialize_post_summary_with_viewer(
    post: Post,
    viewer_user_id: int | None = None,
    favorite_post_ids: set[int] | None = None,
) -> dict:
    author = serialize_user(post.user) if post.user else None
    image_urls = [img.url for img in post.images]
    main_image_url = image_urls[0] if image_urls else build_placeholder_post_image_url(post.title)
    favorite_post_ids = favorite_post_ids if favorite_post_ids is not None else _favorite_ids_for_user(viewer_user_id)
    is_favorited = bool(viewer_user_id and post.post_id in favorite_post_ids)
    is_owner = bool(viewer_user_id and post.user_id == viewer_user_id)
    return {
        "post_id": post.post_id,
        "title": post.title,
        "description": post.description,
        "type": post.type,
        "price": float(post.price) if post.price is not None else None,
        "created_at": post.created_at.isoformat(),
        "user_handle": author["handle"] if author else None,
        "user_name": author["display_name"] if author else None,
        "user_avatar_url": author["avatar_url"] if author else None,
        "author": author,
        "image_url": main_image_url,
        "preview_image_url": main_image_url,
        "has_image": bool(image_urls),
        "image_count": len(image_urls),
        "favorite_count": len(post.favorites) if post.favorites is not None else 0,
        "is_sold": post.is_sold,
        "visibility": post.visibility,
        "is_owner": is_owner,
        "is_mine": is_owner,
        "can_edit": is_owner,
        "can_toggle_sold": is_owner,
        "can_delete": is_owner,
        "is_favorited": is_favorited,
        "is_bookmarked": is_favorited,
    }


def serialize_chapter_search_result(chapter: Chapter) -> dict:
    school = serialize_school(chapter.school)
    return {
        "chapter_id": chapter.chapter_id,
        "name": chapter.name,
        "nickname": chapter.nickname,
        "school_id": chapter.school_id,
        "school_name": school["name"] if school else None,
        "school_domain": school["domain"] if school else None,
        "school_tag_color": school["tag_color"] if school else None,
        "school": school,
        "type": chapter.type,
        "verified": bool(chapter.verified),
        "profile_picture_url": chapter.profile_picture_url,
        "followers_count": chapter_follower_count(chapter.chapter_id),
    }


def serialize_message(message: Message, current_user_id_value: int | None = None) -> dict:
    sender = serialize_user(message.sender) if message.sender else None
    recipient = serialize_user(message.recipient) if message.recipient else None
    is_from_me = current_user_id_value is not None and message.sender_id == current_user_id_value
    reply_link = MessageReply.query.filter_by(message_id=message.message_id).first()
    reply_target = reply_link.reply_to if reply_link else None

    reaction_counts: dict[str, int] = {}
    my_reaction = None
    for reaction in MessageReaction.query.filter_by(message_id=message.message_id).all():
        reaction_counts[reaction.emoji] = reaction_counts.get(reaction.emoji, 0) + 1
        if current_user_id_value is not None and reaction.user_id == current_user_id_value:
            my_reaction = reaction.emoji

    reactions = [
        {
            "emoji": emoji,
            "count": count,
            "reacted_by_me": emoji == my_reaction,
        }
        for emoji, count in sorted(reaction_counts.items(), key=lambda item: item[0])
    ]

    return {
        "message_id": message.message_id,
        "sender_id": message.sender_id,
        "recipient_id": message.recipient_id,
        "sender": sender,
        "recipient": recipient,
        "sender_handle": sender["handle"] if sender else None,
        "sender_name": sender["display_name"] if sender else None,
        "sender_avatar_url": sender["avatar_url"] if sender else None,
        "recipient_handle": recipient["handle"] if recipient else None,
        "recipient_name": recipient["display_name"] if recipient else None,
        "recipient_avatar_url": recipient["avatar_url"] if recipient else None,
        "text": message.text,
        "image_url": message.image_url,
        "sent_at": message.sent_at.isoformat(),
        "read": message.read,
        "is_from_me": is_from_me,
        "reply_to_message_id": reply_link.reply_to_message_id if reply_link else None,
        "reply_preview": (
            {
                "message_id": reply_target.message_id,
                "text": reply_target.text,
                "sender_id": reply_target.sender_id,
                "sender_name": serialize_user(reply_target.sender)["display_name"] if reply_target.sender else None,
            }
            if reply_target
            else None
        ),
        "reactions": reactions,
        "my_reaction": my_reaction,
    }
