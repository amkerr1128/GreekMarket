from flask import jsonify
from flask_jwt_extended import jwt_required

from .. import db
from ..models import BlockedUser, Favorite, PinnedConversation, Post, User, UserFollow
from ..services.notifications import create_notification
from ..services.rate_limit import key_by_user_or_ip, rate_limit
from . import bp
from .common import (
    current_user_id,
    is_blocked,
    post_visible_to_viewer,
    is_site_admin_user,
    serialize_post_with_viewer,
    serialize_user,
    user_follower_ids,
    user_following_ids,
    viewer_allowed_chapter_ids,
)


def _ordered_users_from_ids(user_ids: set[int], viewer_id: int | None = None) -> list[dict]:
    if not user_ids:
        return []
    users = User.query.filter(User.user_id.in_(list(user_ids))).order_by(User.created_at.desc()).all()
    return [serialize_user(user, viewer_user_id=viewer_id, include_follow_metadata=True) for user in users]


def _remove_social_links(user_id: int, other_user_id: int) -> None:
    UserFollow.query.filter(
        db.or_(
            db.and_(UserFollow.follower_id == user_id, UserFollow.followed_user_id == other_user_id),
            db.and_(UserFollow.follower_id == other_user_id, UserFollow.followed_user_id == user_id),
        )
    ).delete(synchronize_session=False)
    PinnedConversation.query.filter(
        db.or_(
            db.and_(PinnedConversation.user_id == user_id, PinnedConversation.other_user_id == other_user_id),
            db.and_(PinnedConversation.user_id == other_user_id, PinnedConversation.other_user_id == user_id),
        )
    ).delete(synchronize_session=False)


@bp.route("/user/<int:user_id>", methods=["GET"])
@jwt_required(optional=True)
def get_user_profile(user_id):
    me = current_user_id()
    if me and is_blocked(me, user_id):
        return jsonify({"error": "Access denied"}), 403
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify(serialize_user(user, viewer_user_id=me, include_follow_metadata=True))


@bp.route("/user/<int:user_id>/posts", methods=["GET"])
@jwt_required(optional=True)
def get_posts_by_user(user_id):
    viewer_id = current_user_id()
    viewer = User.query.get(viewer_id) if viewer_id else None
    if viewer_id and is_blocked(viewer_id, user_id):
        return jsonify([])
    posts = Post.query.filter_by(user_id=user_id).order_by(Post.created_at.desc()).all()
    favorite_post_ids = None
    if viewer_id:
        favorite_post_ids = {fav.post_id for fav in Favorite.query.filter_by(user_id=viewer_id).all()}
    allowed_chapter_ids = viewer_allowed_chapter_ids(viewer_id)
    visible_posts = [
        post
        for post in posts
        if post_visible_to_viewer(post, viewer_id, viewer=viewer, allowed_chapter_ids=allowed_chapter_ids)
    ]
    return jsonify([serialize_post_with_viewer(p, viewer_id, favorite_post_ids) for p in visible_posts])


@bp.route("/users/<int:user_id>/follow", methods=["POST"])
@jwt_required()
@rate_limit("users_follow", 120, 3600, key_func=key_by_user_or_ip)
def follow_user(user_id):
    me = current_user_id()
    if me == user_id:
        return jsonify({"error": "You cannot follow your own account"}), 400

    target = User.query.get(user_id)
    follower = User.query.get(me)
    if not target or not follower:
        return jsonify({"error": "User not found"}), 404
    if is_blocked(me, user_id):
        return jsonify({"error": "You cannot follow this account"}), 403

    existing = UserFollow.query.filter_by(follower_id=me, followed_user_id=user_id).first()
    if existing:
        return (
            jsonify(
                {
                    "message": "Already following this user",
                    "user": serialize_user(target, viewer_user_id=me, include_follow_metadata=True),
                }
            ),
            200,
        )

    follow = UserFollow(follower_id=me, followed_user_id=user_id)
    db.session.add(follow)
    create_notification(
        recipient_id=user_id,
        actor_id=me,
        event_type="user_follow",
        title=f"{follower.first_name} {follower.last_name}".strip() or f"@{follower.handle} followed you",
        body=f"@{follower.handle} started following you.",
        action_url=f"/user/{me}",
        payload={
            "follower_user_id": me,
            "follower_handle": follower.handle,
            "follow_back_user_id": me,
            "can_follow_back": True,
        },
    )
    db.session.commit()
    return (
        jsonify(
            {
                "message": "Now following this user",
                "user": serialize_user(target, viewer_user_id=me, include_follow_metadata=True),
            }
        ),
        201,
    )


@bp.route("/users/<int:user_id>/follow", methods=["DELETE"])
@jwt_required()
@rate_limit("users_unfollow", 120, 3600, key_func=key_by_user_or_ip)
def unfollow_user(user_id):
    me = current_user_id()
    follow = UserFollow.query.filter_by(follower_id=me, followed_user_id=user_id).first()
    if not follow:
        return jsonify({"error": "You are not following this user"}), 404

    db.session.delete(follow)
    db.session.commit()
    target = User.query.get(user_id)
    return (
        jsonify(
            {
                "message": "User unfollowed",
                "user": serialize_user(target, viewer_user_id=me, include_follow_metadata=True) if target else None,
            }
        ),
        200,
    )


@bp.route("/users/<int:user_id>/followers", methods=["GET"])
@jwt_required(optional=True)
def get_user_followers(user_id):
    viewer_id = current_user_id()
    if viewer_id and is_blocked(viewer_id, user_id):
        return jsonify({"error": "Access denied"}), 403
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    followers = _ordered_users_from_ids(user_follower_ids(user_id), viewer_id=viewer_id)
    return jsonify({"count": len(followers), "items": followers}), 200


@bp.route("/users/<int:user_id>/following", methods=["GET"])
@jwt_required(optional=True)
def get_user_following(user_id):
    viewer_id = current_user_id()
    if viewer_id and is_blocked(viewer_id, user_id):
        return jsonify({"error": "Access denied"}), 403
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    following = _ordered_users_from_ids(user_following_ids(user_id), viewer_id=viewer_id)
    return jsonify({"count": len(following), "items": following}), 200


@bp.route("/users/blocked", methods=["GET"])
@jwt_required()
def get_blocked_users():
    me = current_user_id()
    blocks = (
        BlockedUser.query.filter_by(user_id=me)
        .order_by(BlockedUser.timestamp.desc(), BlockedUser.block_id.desc())
        .all()
    )
    items = []
    for block in blocks:
        blocked_user = User.query.get(block.blocked_user_id)
        if not blocked_user:
            continue
        payload = serialize_user(blocked_user, viewer_user_id=me, include_follow_metadata=True)
        payload["blocked_at"] = block.timestamp.isoformat() if block.timestamp else None
        items.append(payload)
    return jsonify({"count": len(items), "items": items}), 200


@bp.route("/users/<int:user_id>/block", methods=["POST"])
@jwt_required()
@rate_limit("users_block", 60, 3600, key_func=key_by_user_or_ip)
def block_user(user_id):
    me = current_user_id()
    if me == user_id:
        return jsonify({"error": "You cannot block your own account"}), 400

    target = User.query.get(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404

    existing = BlockedUser.query.filter_by(user_id=me, blocked_user_id=user_id).first()
    if existing:
        return (
            jsonify(
                {
                    "message": "User is already blocked",
                    "user": serialize_user(target, viewer_user_id=me, include_follow_metadata=True),
                }
            ),
            200,
        )

    block = BlockedUser(user_id=me, blocked_user_id=user_id)
    db.session.add(block)
    _remove_social_links(me, user_id)
    db.session.commit()
    return (
        jsonify(
            {
                "message": "User blocked",
                "user": serialize_user(target, viewer_user_id=me, include_follow_metadata=True),
            }
        ),
        201,
    )


@bp.route("/users/<int:user_id>/block", methods=["DELETE"])
@jwt_required()
@rate_limit("users_unblock", 60, 3600, key_func=key_by_user_or_ip)
def unblock_user(user_id):
    me = current_user_id()
    block = BlockedUser.query.filter_by(user_id=me, blocked_user_id=user_id).first()
    if not block:
        return jsonify({"error": "User is not blocked"}), 404

    db.session.delete(block)
    db.session.commit()
    target = User.query.get(user_id)
    return (
        jsonify(
            {
                "message": "User unblocked",
                "user": serialize_user(target, viewer_user_id=me, include_follow_metadata=True) if target else None,
            }
        ),
        200,
    )
