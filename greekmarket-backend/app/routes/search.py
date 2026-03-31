from flask import jsonify, request
from flask_jwt_extended import jwt_required

from .. import db
from ..models import BlockedUser, Chapter, Post, School, User, UserChapterMembership
from ..services.rate_limit import key_by_user_or_ip, rate_limit
from . import bp
from .common import (
    MAX_SEARCH_QUERY_LENGTH,
    current_user_id,
    is_blocked,
    post_visible_to_viewer,
    serialize_chapter_search_result,
    serialize_post_summary_with_viewer,
    serialize_user,
    viewer_allowed_chapter_ids,
)


_SCHOOL_QUERY_ALIASES = {"school", "schools", "campus", "campuses"}
_CHAPTER_QUERY_ALIASES = {"chapter", "chapters", "fraternity", "sorority", "organization", "organizations"}
_USER_QUERY_ALIASES = {"user", "users", "person", "people", "member", "members"}
_POST_QUERY_ALIASES = {"post", "posts", "listing", "listings", "item", "items"}
_POST_TYPE_ALIASES = {"apparel", "accessories", "stickers", "tickets", "other"}


@bp.route("/search/schools")
@rate_limit("search_schools", 180, 60, key_func=key_by_user_or_ip)
def search_schools():
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return jsonify([])
    if len(q) > MAX_SEARCH_QUERY_LENGTH:
        return jsonify({"error": "Search query is too long"}), 400
    query = School.query
    if q not in _SCHOOL_QUERY_ALIASES:
        query = query.filter(db.or_(School.name.ilike(f"%{q}%"), School.domain.ilike(f"%{q}%")))
    schools = query.order_by(School.name.asc()).all()
    return jsonify([{"school_id": s.school_id, "name": s.name, "domain": s.domain} for s in schools])


@bp.route("/search/chapters", methods=["GET"])
@rate_limit("search_chapters", 180, 60, key_func=key_by_user_or_ip)
def search_chapters():
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return jsonify([])
    if len(q) > MAX_SEARCH_QUERY_LENGTH:
        return jsonify({"error": "Search query is too long"}), 400
    query = Chapter.query.join(School)

    if q in {"fraternity", "fraternities"}:
        query = query.filter(Chapter.type.ilike("fraternity"))
    elif q in {"sorority", "sororities"}:
        query = query.filter(Chapter.type.ilike("sorority"))
    elif q not in _CHAPTER_QUERY_ALIASES:
        query = query.filter(
            db.or_(
                Chapter.name.ilike(f"%{q}%"),
                Chapter.nickname.ilike(f"%{q}%"),
                Chapter.type.ilike(f"%{q}%"),
                School.name.ilike(f"%{q}%"),
                School.domain.ilike(f"%{q}%"),
            )
        )

    chapters = query.order_by(Chapter.name.asc()).all()
    return jsonify([serialize_chapter_search_result(chapter) for chapter in chapters])


@bp.route("/search/users", methods=["GET"])
@jwt_required()
@rate_limit("search_users", 180, 60, key_func=key_by_user_or_ip)
def search_users():
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return jsonify({"error": "Missing search query"}), 400
    if len(q) > MAX_SEARCH_QUERY_LENGTH:
        return jsonify({"error": "Search query is too long"}), 400

    me = current_user_id()

    blocked_ids = {b.blocked_user_id for b in BlockedUser.query.filter_by(user_id=me).all()}
    blocked_by_ids = {b.user_id for b in BlockedUser.query.filter_by(blocked_user_id=me).all()}
    excluded = blocked_ids | blocked_by_ids

    query = User.query.filter(~User.user_id.in_(excluded))
    if q not in _USER_QUERY_ALIASES:
        query = query.filter(
            db.or_(
                User.first_name.ilike(f"%{q}%"),
                User.last_name.ilike(f"%{q}%"),
                User.handle.ilike(f"%{q}%"),
            )
        )
    users = query.order_by(User.handle.asc()).all()
    return jsonify([serialize_user(u) for u in users])


@bp.route("/search/posts", methods=["GET"])
@jwt_required(optional=True)
@rate_limit("search_posts", 180, 60, key_func=key_by_user_or_ip)
def search_posts():
    viewer_id = current_user_id()
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return jsonify({"error": "Missing query string"}), 400
    if len(q) > MAX_SEARCH_QUERY_LENGTH:
        return jsonify({"error": "Search query is too long"}), 400

    viewer = User.query.get(viewer_id) if viewer_id else None
    query = Post.query
    if q in _POST_TYPE_ALIASES:
        query = query.filter(Post.type.ilike(q)).order_by(Post.title.asc(), Post.created_at.desc())
    elif q not in _POST_QUERY_ALIASES:
        query = query.filter(
            db.or_(
                Post.title.ilike(f"%{q}%"),
                Post.description.ilike(f"%{q}%"),
                Post.type.ilike(f"%{q}%"),
            )
        ).order_by(Post.created_at.desc())
    else:
        query = query.order_by(Post.created_at.desc())
    posts = query.limit(100).all()

    allowed_chapter_ids = viewer_allowed_chapter_ids(viewer_id)
    visible = [
        p
        for p in posts
        if post_visible_to_viewer(p, viewer_id, viewer=viewer, allowed_chapter_ids=allowed_chapter_ids)
        and (not viewer_id or not is_blocked(viewer_id, p.user_id))
    ]
    favorite_post_ids = None
    if viewer_id:
        from ..models import Favorite

        favorite_post_ids = {fav.post_id for fav in Favorite.query.filter_by(user_id=viewer_id).all()}
    return jsonify([serialize_post_summary_with_viewer(p, viewer_id, favorite_post_ids) for p in visible])
