from datetime import datetime

from flask import jsonify, request
from flask_jwt_extended import jwt_required

from .. import db
from ..models import Chapter, ChapterFollow, ChapterJoinRequest, Post, User, UserChapterMembership
from ..services.media import upload_image_files
from ..services.notifications import create_notification
from ..services.rate_limit import key_by_user_or_ip, rate_limit
from . import bp
from .common import (
    MAX_CHAPTER_REQUEST_NOTE_LENGTH,
    chapter_follower_count,
    chapter_follower_user_ids,
    chapter_following_state,
    current_user_id,
    is_site_admin_user,
    latest_chapter_request,
    post_visible_to_viewer,
    serialize_chapter_search_result,
    serialize_post_summary_with_viewer,
    serialize_user,
    user_is_chapter_admin,
    viewer_allowed_chapter_ids,
)


def _serialize_chapter_request(join_request: ChapterJoinRequest) -> dict:
    requester = serialize_user(join_request.requester) if join_request.requester else None
    reviewer = serialize_user(join_request.reviewer) if join_request.reviewer else None
    return {
        "request_id": join_request.id,
        "chapter_id": join_request.chapter_id,
        "requested_role": join_request.requested_role,
        "note": join_request.note,
        "status": join_request.status,
        "created_at": join_request.created_at.isoformat() if join_request.created_at else None,
        "decided_at": join_request.decided_at.isoformat() if join_request.decided_at else None,
        "requester": requester,
        "reviewer": reviewer,
    }


def _can_review_chapter_requests(user: User | None, chapter_id: int) -> bool:
    if not user:
        return False
    return user_is_chapter_admin(user.user_id, chapter_id) or is_site_admin_user(user)


@bp.route("/chapters/<int:chapter_id>", methods=["GET"])
@jwt_required(optional=True)
def get_chapter_detail(chapter_id):
    """
    Chapter profile:
      - basic info
      - is_member (if logged in)
      - stats (members, recent_posts)
      - recent posts (lightweight)
      - members (first/last/handle/avatar/role)
    """
    user_id = current_user_id()
    chapter = Chapter.query.get(chapter_id)
    if not chapter:
        return jsonify({"error": "Chapter not found"}), 404

    membership = None
    viewer = User.query.get(user_id) if user_id else None
    is_member = False
    if user_id:
        membership = UserChapterMembership.query.filter_by(user_id=user_id, chapter_id=chapter_id).first()
        is_member = membership is not None
    is_following = bool(is_member or chapter_following_state(user_id, chapter_id))
    member_request = latest_chapter_request(user_id, chapter_id, "member")
    admin_request = latest_chapter_request(user_id, chapter_id, "admin")

    member_count = UserChapterMembership.query.filter_by(chapter_id=chapter_id).count()
    follower_count = chapter_follower_count(chapter_id)

    recent_posts_q = (
        Post.query.filter_by(chapter_id=chapter_id)
        .filter(Post.visibility != "hidden")
        .order_by(Post.created_at.desc())
        .limit(12)
    )
    viewer_favorite_ids = None
    if user_id:
        from ..models import Favorite

        viewer_favorite_ids = {fav.post_id for fav in Favorite.query.filter_by(user_id=user_id).all()}
    allowed_chapter_ids = viewer_allowed_chapter_ids(user_id)
    recent_posts = [
        serialize_post_summary_with_viewer(p, user_id, viewer_favorite_ids)
        for p in recent_posts_q.all()
        if post_visible_to_viewer(p, user_id, viewer=viewer, allowed_chapter_ids=allowed_chapter_ids)
    ]

    memberships = UserChapterMembership.query.filter_by(chapter_id=chapter_id).all()
    user_ids = [m.user_id for m in memberships]
    users = User.query.filter(User.user_id.in_(user_ids)).all()
    user_by_id = {u.user_id: u for u in users}
    members = []
    for m in memberships:
        u = user_by_id.get(m.user_id)
        if not u:
            continue
        member = serialize_user(u)
        member["role"] = m.role
        members.append(member)

    pending_requests = []
    if _can_review_chapter_requests(viewer, chapter_id):
        pending_requests = [
            _serialize_chapter_request(join_request)
            for join_request in ChapterJoinRequest.query.filter_by(chapter_id=chapter_id, status="pending")
            .order_by(ChapterJoinRequest.created_at.asc())
            .all()
        ]

    return jsonify(
        {
            "chapter": {
                "chapter_id": chapter.chapter_id,
                "school_id": chapter.school_id,
                "name": chapter.name,
                "nickname": chapter.nickname,
                "type": chapter.type,
                "verified": bool(chapter.verified),
                "profile_picture_url": chapter.profile_picture_url,
                "school_name": chapter.school.name if chapter.school else None,
                "followers_count": follower_count,
                "member_count": member_count,
                "is_following": is_following,
            },
            "is_member": is_member,
            "is_following": is_following,
            "is_admin": user_is_chapter_admin(user_id, chapter_id),
            "membership_role": membership.role if membership else None,
            "member_request_status": member_request.status if member_request else None,
            "admin_request_status": admin_request.status if admin_request else None,
            "can_review_requests": _can_review_chapter_requests(viewer, chapter_id),
            "stats": {
                "members": member_count,
                "followers": follower_count,
                "recent_posts": len(recent_posts),
            },
            "recent_posts": recent_posts,
            "members": members,
            "pending_requests": pending_requests,
        }
    ), 200


@bp.route("/chapters/<int:chapter_id>/follow", methods=["POST"])
@jwt_required()
@rate_limit("chapters_follow", 120, 3600, key_func=key_by_user_or_ip)
def follow_chapter(chapter_id):
    user_id = current_user_id()
    chapter = Chapter.query.get(chapter_id)
    if not chapter:
        return jsonify({"error": "Chapter not found"}), 404

    if chapter_following_state(user_id, chapter_id) or UserChapterMembership.query.filter_by(
        user_id=user_id, chapter_id=chapter_id
    ).first():
        return jsonify({"message": "Already following this chapter"}), 200

    db.session.add(ChapterFollow(user_id=user_id, chapter_id=chapter_id))
    db.session.commit()
    return jsonify({"message": "Following chapter", "chapter_id": chapter_id}), 201


@bp.route("/chapters/<int:chapter_id>/follow", methods=["DELETE"])
@jwt_required()
@rate_limit("chapters_unfollow", 120, 3600, key_func=key_by_user_or_ip)
def unfollow_chapter(chapter_id):
    user_id = current_user_id()
    chapter = Chapter.query.get(chapter_id)
    if not chapter:
        return jsonify({"error": "Chapter not found"}), 404

    if UserChapterMembership.query.filter_by(user_id=user_id, chapter_id=chapter_id).first():
        return jsonify({"error": "Official members cannot unfollow their chapter"}), 400

    follow = ChapterFollow.query.filter_by(user_id=user_id, chapter_id=chapter_id).first()
    if not follow:
        return jsonify({"error": "You are not following this chapter"}), 404

    db.session.delete(follow)
    db.session.commit()
    return jsonify({"message": "Chapter unfollowed", "chapter_id": chapter_id}), 200


@bp.route("/chapters/<int:chapter_id>/join", methods=["POST"])
@jwt_required()
def join_chapter_by_id(chapter_id):
    """Compatibility alias: request official chapter member approval."""
    return create_chapter_request(chapter_id, forced_role="member")


@bp.route("/chapters/<int:chapter_id>/membership-request", methods=["POST"])
@jwt_required()
@rate_limit("chapters_membership_request", 20, 3600, key_func=key_by_user_or_ip)
def request_chapter_membership(chapter_id):
    return create_chapter_request(chapter_id, forced_role="member")


@bp.route("/chapters/<int:chapter_id>/admin-request", methods=["POST"])
@jwt_required()
@rate_limit("chapters_admin_request", 20, 3600, key_func=key_by_user_or_ip)
def request_chapter_admin(chapter_id):
    return create_chapter_request(chapter_id, forced_role="admin")


def create_chapter_request(chapter_id: int, forced_role: str):
    user_id = current_user_id()
    chapter = Chapter.query.get(chapter_id)
    if not chapter:
        return jsonify({"error": "Chapter not found"}), 404

    existing = UserChapterMembership.query.filter_by(user_id=user_id, chapter_id=chapter_id).first()
    if forced_role == "member" and existing:
        return jsonify({"message": "You are already an official chapter member"}), 200
    if forced_role == "admin":
        if not existing:
            return jsonify({"error": "Become an approved chapter member before requesting admin access"}), 400
        if existing.role == "admin":
            return jsonify({"message": "You are already a chapter admin"}), 200

    pending = (
        ChapterJoinRequest.query.filter_by(
            user_id=user_id,
            chapter_id=chapter_id,
            requested_role=forced_role,
            status="pending",
        )
        .order_by(ChapterJoinRequest.created_at.desc())
        .first()
    )
    if pending:
        return jsonify({"message": "A request is already pending", "request": _serialize_chapter_request(pending)}), 200

    note = ((request.get_json(silent=True) or {}).get("note") or "").strip() or None
    if note and len(note) > MAX_CHAPTER_REQUEST_NOTE_LENGTH:
        return jsonify({"error": "Request note is too long"}), 400
    if not chapter_following_state(user_id, chapter_id) and not existing:
        db.session.add(ChapterFollow(user_id=user_id, chapter_id=chapter_id))

    join_request = ChapterJoinRequest(
        user_id=user_id,
        chapter_id=chapter_id,
        requested_role=forced_role,
        note=note,
        status="pending",
    )
    db.session.add(join_request)
    db.session.commit()
    return (
        jsonify(
            {
                "message": "Membership request submitted." if forced_role == "member" else "Admin request submitted.",
                "request": _serialize_chapter_request(join_request),
            }
        ),
        201,
    )


@bp.route("/chapters/<int:chapter_id>/requests", methods=["GET"])
@jwt_required()
def get_chapter_requests(chapter_id):
    user_id = current_user_id()
    user = User.query.get(user_id)
    if not _can_review_chapter_requests(user, chapter_id):
        return jsonify({"error": "Only chapter admins can review chapter requests"}), 403

    chapter = Chapter.query.get(chapter_id)
    if not chapter:
        return jsonify({"error": "Chapter not found"}), 404

    requests_payload = [
        _serialize_chapter_request(join_request)
        for join_request in ChapterJoinRequest.query.filter_by(chapter_id=chapter_id)
        .order_by(ChapterJoinRequest.created_at.desc())
        .all()
    ]
    return jsonify(requests_payload), 200


@bp.route("/chapters/<int:chapter_id>/requests/<int:request_id>", methods=["PATCH"])
@jwt_required()
@rate_limit("chapters_request_review", 60, 3600, key_func=key_by_user_or_ip)
def review_chapter_request(chapter_id, request_id):
    user_id = current_user_id()
    user = User.query.get(user_id)
    if not _can_review_chapter_requests(user, chapter_id):
        return jsonify({"error": "Only chapter admins can review chapter requests"}), 403

    join_request = ChapterJoinRequest.query.filter_by(id=request_id, chapter_id=chapter_id).first()
    if not join_request:
        return jsonify({"error": "Request not found"}), 404
    if join_request.status != "pending":
        return jsonify({"error": "This request has already been decided"}), 400

    payload = request.get_json(silent=True) or {}
    status = (payload.get("status") or "").strip().lower()
    if status not in {"approved", "rejected"}:
        return jsonify({"error": "Status must be approved or rejected"}), 400

    membership = UserChapterMembership.query.filter_by(
        user_id=join_request.user_id, chapter_id=chapter_id
    ).first()

    if status == "approved":
        if join_request.requested_role == "member":
            if not membership:
                membership = UserChapterMembership(user_id=join_request.user_id, chapter_id=chapter_id, role="member")
                db.session.add(membership)
        elif join_request.requested_role == "admin":
            if not membership:
                return jsonify({"error": "That user must be an approved chapter member before becoming admin"}), 400
            membership.role = "admin"

        if not chapter_following_state(join_request.user_id, chapter_id):
            db.session.add(ChapterFollow(user_id=join_request.user_id, chapter_id=chapter_id))

    join_request.status = status
    join_request.reviewed_by = user.user_id
    join_request.decided_at = datetime.utcnow()
    chapter_name = chapter.name if chapter else "the chapter"
    create_notification(
        recipient_id=join_request.user_id,
        actor_id=user.user_id,
        event_type="chapter_request_decision",
        event_key=f"chapter-request:{join_request.id}:{status}",
        title=f"Chapter request {status}",
        body=(
            f"Your request to join {chapter_name} was approved."
            if join_request.requested_role == "member" and status == "approved"
            else (
                f"Your request to join {chapter_name} was rejected."
                if join_request.requested_role == "member"
                else (
                    f"Your request for chapter admin access to {chapter_name} was approved."
                    if status == "approved"
                    else f"Your request for chapter admin access to {chapter_name} was rejected."
                )
            )
        ),
        action_url=f"/chapter/{chapter_id}",
        payload={
            "request_id": join_request.id,
            "chapter_id": chapter_id,
            "requested_role": join_request.requested_role,
            "status": status,
        },
    )
    db.session.commit()

    return jsonify({"message": "Chapter request updated.", "request": _serialize_chapter_request(join_request)}), 200


@bp.route("/chapters/<int:chapter_id>/profile-picture", methods=["POST", "PUT"])
@jwt_required()
@rate_limit("chapters_profile_picture", 30, 3600, key_func=key_by_user_or_ip)
def update_chapter_profile_picture(chapter_id):
    user_id = current_user_id()
    if not user_is_chapter_admin(user_id, chapter_id):
        return jsonify({"error": "Only chapter admins can update chapter branding"}), 403

    chapter = Chapter.query.get(chapter_id)
    if not chapter:
        return jsonify({"error": "Chapter not found"}), 404

    payload = request.get_json(silent=True) or {}
    image_url = (request.form.get("profile_picture_url") or payload.get("profile_picture_url") or None)

    if "image" in request.files or request.files.getlist("images") or request.files.getlist("images[]"):
        files = request.files.getlist("images") or request.files.getlist("images[]") or [request.files["image"]]
        try:
            uploaded = upload_image_files(files, folder="greekmarket/chapters")
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        image_url = uploaded[0] if uploaded else None

    if image_url is None:
        return jsonify({"error": "No chapter image provided"}), 400

    chapter.profile_picture_url = image_url
    db.session.commit()
    return jsonify({"message": "Chapter image updated.", "chapter": serialize_chapter_search_result(chapter)}), 200


@bp.route("/chapters/<int:chapter_id>/profile-picture", methods=["DELETE"])
@jwt_required()
def clear_chapter_profile_picture(chapter_id):
    user_id = current_user_id()
    if not user_is_chapter_admin(user_id, chapter_id):
        return jsonify({"error": "Only chapter admins can update chapter branding"}), 403

    chapter = Chapter.query.get(chapter_id)
    if not chapter:
        return jsonify({"error": "Chapter not found"}), 404

    chapter.profile_picture_url = None
    db.session.commit()
    return jsonify({"message": "Chapter image cleared.", "chapter": serialize_chapter_search_result(chapter)}), 200


@bp.route("/chapters/<int:chapter_id>/followers", methods=["GET"])
@jwt_required(optional=True)
def get_chapter_followers(chapter_id):
    viewer_id = current_user_id()
    chapter = Chapter.query.get(chapter_id)
    if not chapter:
        return jsonify({"error": "Chapter not found"}), 404

    follower_ids = chapter_follower_user_ids(chapter_id)
    users = User.query.filter(User.user_id.in_(list(follower_ids))).order_by(User.created_at.desc()).all() if follower_ids else []
    items = [serialize_user(user, viewer_user_id=viewer_id, include_follow_metadata=True) for user in users]
    return jsonify({"count": len(items), "items": items}), 200
