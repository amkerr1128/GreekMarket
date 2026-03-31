from flask import jsonify
from flask_jwt_extended import jwt_required

from .. import db
from ..models import Chapter, Post, School, SchoolMembership, User
from ..services.rate_limit import key_by_user_or_ip, rate_limit
from . import bp
from .common import (
    current_user_id,
    post_visible_to_viewer,
    school_follower_user_ids,
    school_following_state,
    serialize_post_summary_with_viewer,
    serialize_school,
    serialize_user,
    viewer_allowed_chapter_ids,
)


@bp.route("/schools", methods=["GET"])
def get_schools():
    schools = School.query.all()
    return jsonify([{"id": s.school_id, "name": s.name, "domain": s.domain} for s in schools])


@bp.route("/schools/<int:school_id>", methods=["GET"])
@jwt_required(optional=True)
def get_school_detail(school_id):
    """
    Return a school's profile:
      - basic info
      - membership status for current user (if logged in)
      - chapter list (id, name, nickname, type, verified)
      - simple stats (members, chapters, recent posts count)
      - recent posts (lightweight)
    """
    user_id = current_user_id()
    school = School.query.get(school_id)
    if not school:
        return jsonify({"error": "School not found"}), 404

    is_member = False
    is_following = False
    is_primary_school = False
    if user_id:
        me = User.query.get(user_id)
        is_member = me is not None and me.school_id == school_id
        is_primary_school = is_member
        is_following = school_following_state(user_id, school_id) or is_member

    member_ids = {user.user_id for user in User.query.filter_by(school_id=school_id).all()}
    member_ids.update(
        membership.user_id for membership in SchoolMembership.query.filter_by(school_id=school_id).all()
    )
    member_count = len(member_ids)
    chapter_q = Chapter.query.filter_by(school_id=school_id).order_by(Chapter.name.asc())
    chapters = [
        {
            "chapter_id": c.chapter_id,
            "name": c.name,
            "nickname": c.nickname,
            "type": c.type,
            "verified": bool(c.verified),
        }
        for c in chapter_q.all()
    ]

    recent_posts_q = Post.query.filter_by(school_id=school_id).order_by(Post.created_at.desc()).limit(10)
    viewer_favorite_ids = None
    if user_id:
        from ..models import Favorite

        viewer_favorite_ids = {fav.post_id for fav in Favorite.query.filter_by(user_id=user_id).all()}
    viewer = User.query.get(user_id) if user_id else None
    allowed_chapter_ids = viewer_allowed_chapter_ids(user_id)
    recent_posts = [
        serialize_post_summary_with_viewer(p, user_id, viewer_favorite_ids)
        for p in recent_posts_q.all()
        if post_visible_to_viewer(p, user_id, viewer=viewer, allowed_chapter_ids=allowed_chapter_ids)
    ]
    school_payload = serialize_school(school, viewer_user_id=user_id, include_follow_metadata=True)
    follower_count = school_payload.get("followers_count", member_count)

    return jsonify(
        {
            "school": school_payload,
            "is_member": is_member,
            "is_following": is_following,
            "is_primary_school": is_primary_school,
            "stats": {
                "members": member_count,
                "followers": follower_count,
                "chapters": len(chapters),
                "recent_posts": len(recent_posts),
            },
            "chapters": chapters,
            "recent_posts": recent_posts,
        }
    ), 200


@bp.route("/schools/<int:school_id>/join", methods=["POST"])
@jwt_required()
@rate_limit("schools_join", 60, 3600, key_func=key_by_user_or_ip)
def join_school(school_id):
    """Compatibility alias: follow the school and make it the primary school."""
    return select_school(school_id)


@bp.route("/schools/<int:school_id>/follow", methods=["POST"])
@jwt_required()
@rate_limit("schools_follow", 120, 3600, key_func=key_by_user_or_ip)
def follow_school(school_id):
    user_id = current_user_id()
    user = User.query.get(user_id)
    school = School.query.get(school_id)

    if not school:
        return jsonify({"error": "School not found"}), 404

    membership = SchoolMembership.query.filter_by(user_id=user.user_id, school_id=school_id).first()
    if membership:
        return jsonify({"message": "Already following this school", "school_id": school_id}), 200

    db.session.add(SchoolMembership(user_id=user.user_id, school_id=school_id, role="member"))
    db.session.commit()
    return jsonify({"message": "Following school", "school_id": school_id}), 201


@bp.route("/schools/<int:school_id>/follow", methods=["DELETE"])
@jwt_required()
@rate_limit("schools_unfollow", 120, 3600, key_func=key_by_user_or_ip)
def unfollow_school(school_id):
    user_id = current_user_id()
    user = User.query.get(user_id)
    school = School.query.get(school_id)

    if not school:
        return jsonify({"error": "School not found"}), 404

    if user and user.school_id == school_id:
        return jsonify({"error": "You cannot unfollow your current primary school"}), 400

    membership = SchoolMembership.query.filter_by(user_id=user_id, school_id=school_id).first()
    if not membership:
        return jsonify({"error": "You are not following this school"}), 404

    db.session.delete(membership)
    db.session.commit()
    return jsonify({"message": "School unfollowed", "school_id": school_id}), 200


@bp.route("/schools/<int:school_id>/select", methods=["POST"])
@jwt_required()
@rate_limit("schools_select", 60, 3600, key_func=key_by_user_or_ip)
def select_school(school_id):
    user_id = current_user_id()
    user = User.query.get(user_id)
    school = School.query.get(school_id)

    if not school:
        return jsonify({"error": "School not found"}), 404

    membership = SchoolMembership.query.filter_by(user_id=user.user_id, school_id=school_id).first()
    if not membership:
        db.session.add(SchoolMembership(user_id=user.user_id, school_id=school_id, role="member"))

    user.school_id = school_id
    db.session.commit()
    return jsonify({"message": "Primary school updated", "school_id": school_id}), 200


@bp.route("/schools/<int:school_id>/followers", methods=["GET"])
@jwt_required(optional=True)
def get_school_followers(school_id):
    viewer_id = current_user_id()
    school = School.query.get(school_id)
    if not school:
        return jsonify({"error": "School not found"}), 404

    follower_ids = school_follower_user_ids(school_id)
    users = User.query.filter(User.user_id.in_(list(follower_ids))).order_by(User.created_at.desc()).all() if follower_ids else []
    items = [serialize_user(user, viewer_user_id=viewer_id, include_follow_metadata=True) for user in users]
    return jsonify({"count": len(items), "items": items}), 200
