from flask import jsonify, request
from flask_jwt_extended import jwt_required

from .. import db
from ..models import Chapter, Comment, Post, PostReport, User, UserChapterMembership
from ..services.rate_limit import key_by_user_or_ip, rate_limit
from ..utils import to_int
from ..services.notifications import create_notification
from . import bp
from .common import MAX_REPORT_REASON_LENGTH, current_user_id, is_site_admin_user


@bp.route("/posts/<int:post_id>/report", methods=["POST"])
@jwt_required()
@rate_limit("posts_report", 20, 3600, key_func=key_by_user_or_ip)
def report_post(post_id):
    me = current_user_id()
    data = request.get_json() or {}
    reason = (data.get("reason") or "").strip()
    if not reason:
        return jsonify({"error": "Report reason is required"}), 400
    if len(reason) > MAX_REPORT_REASON_LENGTH:
        return jsonify({"error": "Report reason is too long"}), 400

    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if post.user_id == me:
        return jsonify({"error": "You cannot report your own post"}), 400

    report = PostReport(reporter_id=me, post_id=post_id, reason=reason)
    db.session.add(report)
    db.session.flush()
    reporter = User.query.get(me)
    create_notification(
        recipient_id=me,
        actor_id=me,
        event_type="post_report_submitted",
        event_key=f"post-report:{report.report_id}",
        title="Post report submitted",
        body="Thanks for reporting this post. Our moderation team will review it.",
        action_url="/dashboard",
        payload={
            "report_id": report.report_id,
            "post_id": post_id,
            "reporter_handle": reporter.handle if reporter else None,
        },
    )
    db.session.commit()
    return jsonify({"message": "Post reported successfully"}), 201


@bp.route("/admin/remove-user", methods=["POST"])
@jwt_required()
def admin_remove_user():
    admin_id = current_user_id()
    data = request.get_json() or {}
    target_id = to_int(data.get("user_id"))
    if not target_id:
        return jsonify({"error": "Missing user_id"}), 400

    admin_membership = UserChapterMembership.query.filter_by(user_id=admin_id, role="admin").first()
    if not admin_membership:
        return jsonify({"error": "Only chapter admins can remove users"}), 403

    membership = UserChapterMembership.query.filter_by(
        user_id=target_id, chapter_id=admin_membership.chapter_id
    ).first()
    if not membership:
        return jsonify({"error": "User not found in your chapter"}), 404

    db.session.delete(membership)
    db.session.commit()
    return jsonify({"message": "User removed from chapter"}), 200


@bp.route("/admin/delete-post/<int:post_id>", methods=["DELETE"])
@jwt_required()
def delete_post_as_admin(post_id):
    me = current_user_id()
    admin_membership = UserChapterMembership.query.filter_by(user_id=me, role="admin").first()
    if not admin_membership:
        return jsonify({"error": "Only chapter admins can delete posts"}), 403

    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if not post.chapter_id:
        return jsonify({"error": "Post is not assigned to a chapter"}), 400
    if post.chapter_id != admin_membership.chapter_id:
        return jsonify({"error": "Post not found in your chapter"}), 404

    db.session.delete(post)
    db.session.commit()
    return jsonify({"message": "Post deleted successfully"}), 200


@bp.route("/admin/analytics", methods=["GET"])
@jwt_required()
def chapter_analytics():
    me = current_user_id()
    membership = UserChapterMembership.query.filter_by(user_id=me, role="admin").first()
    if not membership:
        return jsonify({"error": "Only chapter admins can view analytics"}), 403

    chapter_id = membership.chapter_id
    total_posts = Post.query.filter_by(chapter_id=chapter_id).count()
    total_users = UserChapterMembership.query.filter_by(chapter_id=chapter_id).count()
    total_comments = db.session.query(Comment).join(Post).filter(Post.chapter_id == chapter_id).count()

    return jsonify(
        {
            "chapter_id": chapter_id,
            "total_posts": total_posts,
            "total_users": total_users,
            "total_comments": total_comments,
        }
    ), 200


@bp.route("/admin/analytics/platform", methods=["GET"])
@jwt_required()
def get_platform_analytics():
    me = current_user_id()
    user = User.query.get(me)
    if not is_site_admin_user(user):
        return jsonify({"error": "Only site admins can view platform analytics"}), 403

    return jsonify(
        {
            "total_users": User.query.count(),
            "total_posts": Post.query.count(),
            "total_comments": Comment.query.count(),
            "total_chapters": Chapter.query.count(),
        }
    )
