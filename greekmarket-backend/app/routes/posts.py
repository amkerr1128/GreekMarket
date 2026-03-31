from flask import jsonify, request
from flask_jwt_extended import jwt_required

from .. import db
from ..models import Chapter, Comment, Favorite, Post, PostImage, Purchase, User, UserChapterMembership
from ..services.rate_limit import key_by_user_or_ip, rate_limit
from ..utils import to_int
from ..services.media import upload_image_files
from . import bp
from .common import (
    MAX_COMMENT_LENGTH,
    MAX_POST_DESCRIPTION_LENGTH,
    MAX_POST_TITLE_LENGTH,
    MAX_POST_TYPE_LENGTH,
    VALID_LISTING_VISIBILITIES,
    current_user_id,
    is_blocked,
    is_site_admin_user,
    post_visible_to_viewer,
    serialize_post_summary_with_viewer,
    serialize_post_with_viewer,
    user_has_verified_contact,
    viewer_allowed_chapter_ids,
)


def _collect_post_image_urls(data: dict) -> list[str]:
    image_urls: list[str] = []

    raw_urls = data.get("image_urls")
    if isinstance(raw_urls, list):
        image_urls.extend([url for url in raw_urls if url])
    elif isinstance(raw_urls, str) and raw_urls:
        image_urls.append(raw_urls)

    image_urls.extend([url for url in request.form.getlist("image_urls[]") if url])
    image_urls.extend([url for url in request.form.getlist("image_urls") if url])

    uploaded_files = request.files.getlist("images") or request.files.getlist("images[]")
    image_urls.extend(upload_image_files(uploaded_files, folder="greekmarket/posts"))
    return image_urls


@bp.route("/posts", methods=["POST"])
@jwt_required()
@rate_limit("posts_create", 20, 3600, key_func=key_by_user_or_ip)
def create_post():
    """
    Create a post. User must have a school_id set.
    Accepts JSON body or multipart/form-data.
    """
    user_id = current_user_id()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    if not user_has_verified_contact(user):
        return jsonify({"error": "Verify your email or phone before creating a listing."}), 403
    if not user.school_id:
        return jsonify({"error": "Please select your school before creating a post."}), 400

    data = request.get_json(silent=True)
    if data is None:
        data = request.form.to_dict(flat=True)
    else:
        data = data or {}
    image_urls = _collect_post_image_urls(data)

    title = (data.get("title") or "").strip()
    ptype = (data.get("type") or "").strip()
    if not title:
        return jsonify({"error": "Title is required."}), 400
    if len(title) > MAX_POST_TITLE_LENGTH:
        return jsonify({"error": f"Title must be {MAX_POST_TITLE_LENGTH} characters or fewer."}), 400
    if not ptype:
        return jsonify({"error": "Type is required."}), 400
    if len(ptype) > MAX_POST_TYPE_LENGTH:
        return jsonify({"error": "Type is too long."}), 400

    description = (data.get("description") or "").strip()
    if len(description) > MAX_POST_DESCRIPTION_LENGTH:
        return jsonify({"error": f"Description must be {MAX_POST_DESCRIPTION_LENGTH} characters or fewer."}), 400
    visibility = (data.get("visibility") or "public").strip().lower()
    if visibility not in VALID_LISTING_VISIBILITIES:
        return jsonify({"error": "Visibility must be public, school, or chapter."}), 400
    chapter_id = to_int(data.get("chapter_id"))
    if chapter_id:
        chapter = Chapter.query.get(chapter_id)
        if not chapter or chapter.school_id != user.school_id:
            return jsonify({"error": "Chapter is invalid for your current school."}), 400
        if not UserChapterMembership.query.filter_by(user_id=user_id, chapter_id=chapter_id).first():
            return jsonify({"error": "Join the chapter before posting there."}), 403

    raw_price = data.get("price")
    price = None
    if raw_price not in (None, ""):
        try:
            price = float(raw_price)
        except (TypeError, ValueError):
            return jsonify({"error": "Price must be a number."}), 400
        if price < 0:
            return jsonify({"error": "Price must be zero or greater."}), 400

    try:
        post = Post(
            user_id=user_id,
            school_id=user.school_id,
            chapter_id=chapter_id,
            type=ptype,
            title=title,
            description=description,
            price=price,
            is_sold=False,
            visibility=visibility,
        )
        db.session.add(post)
        db.session.flush()

        for url in image_urls:
            if url:
                db.session.add(PostImage(post_id=post.post_id, url=url))

        db.session.commit()
        return jsonify(serialize_post_with_viewer(post, user_id, set())), 201
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        print("Create post error:", e)
        return jsonify({"error": "Server error creating post"}), 500


@bp.route("/posts/<int:school_id>", methods=["GET"])
@jwt_required(optional=True)
def get_posts_for_school(school_id):
    viewer_id = current_user_id()
    viewer = User.query.get(viewer_id) if viewer_id else None
    favorite_post_ids = None
    if viewer_id:
        favorite_post_ids = {fav.post_id for fav in Favorite.query.filter_by(user_id=viewer_id).all()}
    allowed_chapter_ids = viewer_allowed_chapter_ids(viewer_id)

    q = Post.query.filter_by(school_id=school_id)

    post_type = request.args.get("type")
    if post_type:
        q = q.filter_by(type=post_type)

    sort = request.args.get("sort")
    if sort == "price":
        q = q.order_by(Post.price.asc())
    elif sort == "-price":
        q = q.order_by(Post.price.desc())
    else:
        q = q.order_by(Post.created_at.desc())

    posts = q.all()
    result = []
    for p in posts:
        if not post_visible_to_viewer(p, viewer_id, viewer=viewer, allowed_chapter_ids=allowed_chapter_ids):
            continue
        result.append(serialize_post_with_viewer(p, viewer_id, favorite_post_ids))
    return jsonify(result)


@bp.route("/post/<int:post_id>", methods=["GET"])
@jwt_required(optional=True)
def get_post_detail(post_id):
    viewer_id = current_user_id()
    viewer = User.query.get(viewer_id) if viewer_id else None
    favorite_post_ids = None
    if viewer_id:
        favorite_post_ids = {fav.post_id for fav in Favorite.query.filter_by(user_id=viewer_id).all()}
    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404

    if not post_visible_to_viewer(post, viewer_id, viewer=viewer):
        return jsonify({"error": "Post not found"}), 404

    post.views += 1
    db.session.commit()

    data = serialize_post_with_viewer(post, viewer_id, favorite_post_ids)
    data["views"] = post.views
    return jsonify(data)


@bp.route("/my-posts", methods=["GET"])
@jwt_required()
def get_my_posts():
    me = current_user_id()
    posts = Post.query.filter_by(user_id=me).order_by(Post.created_at.desc()).all()
    favorite_post_ids = {fav.post_id for fav in Favorite.query.filter_by(user_id=me).all()}
    return jsonify([serialize_post_with_viewer(p, me, favorite_post_ids) for p in posts])


@bp.route("/posts/<int:post_id>", methods=["PUT"])
@jwt_required()
@rate_limit("posts_edit", 60, 3600, key_func=key_by_user_or_ip)
def edit_post(post_id):
    me = current_user_id()
    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if post.user_id != me:
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json(silent=True) or request.form.to_dict(flat=True)
    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "Title cannot be empty"}), 400
        if len(title) > MAX_POST_TITLE_LENGTH:
            return jsonify({"error": f"Title must be {MAX_POST_TITLE_LENGTH} characters or fewer."}), 400
        post.title = title
    if "description" in data:
        description = (data.get("description") or "").strip()
        if len(description) > MAX_POST_DESCRIPTION_LENGTH:
            return jsonify({"error": f"Description must be {MAX_POST_DESCRIPTION_LENGTH} characters or fewer."}), 400
        post.description = description
    if "price" in data:
        raw_price = data.get("price")
        if raw_price in ("", None):
            post.price = None
        else:
            try:
                price = float(raw_price)
            except (TypeError, ValueError):
                return jsonify({"error": "Price must be a number."}), 400
            if price < 0:
                return jsonify({"error": "Price must be zero or greater."}), 400
            post.price = price
    if "visibility" in data:
        visibility = (data.get("visibility") or "").strip().lower()
        if visibility not in VALID_LISTING_VISIBILITIES:
            return jsonify({"error": "Visibility must be public, school, or chapter."}), 400
        post.visibility = visibility

    uploaded_files = request.files.getlist("images") or request.files.getlist("images[]")
    incoming_urls = []
    if "image_urls" in data or request.form.getlist("image_urls[]") or request.form.getlist("image_urls") or uploaded_files:
        try:
            PostImage.query.filter_by(post_id=post_id).delete()
            raw_urls = data.get("image_urls")
            if isinstance(raw_urls, list):
                incoming_urls.extend([url for url in raw_urls if url])
            elif isinstance(raw_urls, str) and raw_urls:
                incoming_urls.append(raw_urls)
            incoming_urls.extend([url for url in request.form.getlist("image_urls[]") if url])
            incoming_urls.extend([url for url in request.form.getlist("image_urls") if url])
            incoming_urls.extend(upload_image_files(uploaded_files, folder="greekmarket/posts"))
            for url in incoming_urls:
                db.session.add(PostImage(post_id=post_id, url=url))
        except ValueError as exc:
            db.session.rollback()
            return jsonify({"error": str(exc)}), 400

    db.session.commit()
    return jsonify({"message": "Post updated successfully"}), 200


@bp.route("/posts/<int:post_id>/mark-sold", methods=["POST"])
@jwt_required()
@rate_limit("posts_mark_sold", 60, 3600, key_func=key_by_user_or_ip)
def mark_post_sold(post_id):
    return set_post_sold_state(post_id, True)


@bp.route("/posts/<int:post_id>/toggle-sold", methods=["POST"])
@jwt_required()
@rate_limit("posts_toggle_sold", 60, 3600, key_func=key_by_user_or_ip)
def toggle_post_sold(post_id):
    data = request.get_json(silent=True) or {}
    if "is_sold" in data:
        return set_post_sold_state(post_id, bool(data.get("is_sold")))

    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    return set_post_sold_state(post_id, not post.is_sold)


@bp.route("/posts/<int:post_id>/relist", methods=["POST"])
@jwt_required()
@rate_limit("posts_relist", 60, 3600, key_func=key_by_user_or_ip)
def relist_post(post_id):
    return set_post_sold_state(post_id, False)


def set_post_sold_state(post_id: int, is_sold: bool):
    me = current_user_id()
    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if post.user_id != me:
        return jsonify({"error": "You can only mark your own posts as sold"}), 403
    post.is_sold = is_sold
    db.session.commit()
    return (
        jsonify(
            {
                "message": "Post marked as sold!" if is_sold else "Post marked as available!",
                "post_id": post.post_id,
                "is_sold": post.is_sold,
            }
        ),
        200,
    )


@bp.route("/posts/<int:post_id>", methods=["DELETE"])
@jwt_required()
@rate_limit("posts_delete", 20, 3600, key_func=key_by_user_or_ip)
def delete_post(post_id):
    me = current_user_id()
    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if post.user_id != me:
        return jsonify({"error": "You can only delete your own posts"}), 403

    has_purchase = Purchase.query.filter_by(post_id=post_id).first() is not None
    if post.is_sold or has_purchase:
        return jsonify({"error": "Sold posts cannot be deleted"}), 400

    db.session.delete(post)
    db.session.commit()
    return jsonify({"message": "Post deleted successfully", "post_id": post_id}), 200


@bp.route("/posts/<int:post_id>/comment", methods=["POST"])
@jwt_required()
@rate_limit("posts_comment", 60, 600, key_func=key_by_user_or_ip)
def add_comment(post_id):
    me = current_user_id()
    viewer = User.query.get(me)
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Comment text is required"}), 400
    if len(text) > MAX_COMMENT_LENGTH:
        return jsonify({"error": f"Comments must be {MAX_COMMENT_LENGTH} characters or fewer"}), 400

    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if not post_visible_to_viewer(post, me, viewer=viewer, allowed_chapter_ids=viewer_allowed_chapter_ids(me)):
        return jsonify({"error": "Post not found"}), 404

    db.session.add(Comment(user_id=me, post_id=post_id, text=text))
    db.session.commit()
    return jsonify({"message": "Comment added"}), 201


@bp.route("/posts/<int:post_id>/comments", methods=["GET"])
@jwt_required(optional=True)
def get_comments(post_id):
    viewer_id = current_user_id()
    viewer = User.query.get(viewer_id) if viewer_id else None
    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if not post_visible_to_viewer(post, viewer_id, viewer=viewer, allowed_chapter_ids=viewer_allowed_chapter_ids(viewer_id)):
        return jsonify({"error": "Post not found"}), 404
    comments = Comment.query.filter_by(post_id=post_id).order_by(Comment.created_at.asc()).all()
    return jsonify(
        [
            {
                "comment_id": c.comment_id,
                "user_id": c.user_id,
                "text": c.text,
                "created_at": c.created_at.isoformat(),
            }
            for c in comments
        ]
    )


@bp.route("/posts/<int:post_id>/favorite", methods=["POST"])
@jwt_required()
@rate_limit("posts_favorite", 120, 3600, key_func=key_by_user_or_ip)
def favorite_post(post_id):
    me = current_user_id()
    viewer = User.query.get(me)
    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if not post_visible_to_viewer(post, me, viewer=viewer, allowed_chapter_ids=viewer_allowed_chapter_ids(me)):
        return jsonify({"error": "Post not found"}), 404

    existing = Favorite.query.filter_by(user_id=me, post_id=post_id).first()
    if existing:
        favorite_count = Favorite.query.filter_by(post_id=post_id).count()
        return jsonify(
            {
                "message": "Already favorited",
                "post_id": post_id,
                "is_favorited": True,
                "is_bookmarked": True,
                "favorite_count": favorite_count,
            }
        ), 200

    db.session.add(Favorite(user_id=me, post_id=post_id))
    db.session.commit()
    favorite_count = Favorite.query.filter_by(post_id=post_id).count()
    return jsonify(
        {
            "message": "Post favorited!",
            "post_id": post_id,
            "is_favorited": True,
            "is_bookmarked": True,
            "favorite_count": favorite_count,
        }
    ), 201


@bp.route("/posts/<int:post_id>/unfavorite", methods=["DELETE"])
@jwt_required()
@rate_limit("posts_unfavorite", 120, 3600, key_func=key_by_user_or_ip)
def unfavorite_post(post_id):
    me = current_user_id()
    fav = Favorite.query.filter_by(user_id=me, post_id=post_id).first()
    if not fav:
        return jsonify({"error": "Favorite not found"}), 404
    db.session.delete(fav)
    db.session.commit()
    favorite_count = Favorite.query.filter_by(post_id=post_id).count()
    return jsonify(
        {
            "message": "Post unfavorited",
            "post_id": post_id,
            "is_favorited": False,
            "is_bookmarked": False,
            "favorite_count": favorite_count,
        }
    ), 200


@bp.route("/my-favorites", methods=["GET"])
@jwt_required()
def get_my_favorites():
    me = current_user_id()
    viewer = User.query.get(me)
    favorites = (
        Favorite.query.filter_by(user_id=me)
        .order_by(Favorite.created_at.desc())
        .all()
    )
    post_ids = [f.post_id for f in favorites]
    if not post_ids:
        return jsonify([])
    posts = Post.query.filter(Post.post_id.in_(post_ids)).all()
    posts_by_id = {post.post_id: post for post in posts}
    ordered_posts = [posts_by_id[post_id] for post_id in post_ids if post_id in posts_by_id]
    allowed_chapter_ids = viewer_allowed_chapter_ids(me)
    visible = [
        p
        for p in ordered_posts
        if post_visible_to_viewer(p, me, viewer=viewer, allowed_chapter_ids=allowed_chapter_ids)
    ]
    return jsonify([serialize_post_with_viewer(p, me, set(post_ids)) for p in visible])


@bp.route("/analytics/post/<int:post_id>", methods=["GET"])
@jwt_required()
def get_post_analytics(post_id):
    me = current_user_id()
    viewer = User.query.get(me)
    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if not (post.user_id == me or is_site_admin_user(viewer)):
        return jsonify({"error": "Only the listing owner can view analytics"}), 403

    view_count = post.views or 0
    comment_count = Comment.query.filter_by(post_id=post_id).count()
    image_count = PostImage.query.filter_by(post_id=post_id).count()
    return jsonify({"post_id": post_id, "views": view_count, "comments": comment_count, "images": image_count}), 200


@bp.route("/activity/posts", methods=["GET"])
@jwt_required(optional=True)
def recent_posts():
    viewer_id = current_user_id()
    viewer = User.query.get(viewer_id) if viewer_id else None
    favorite_post_ids = None
    if viewer_id:
        favorite_post_ids = {fav.post_id for fav in Favorite.query.filter_by(user_id=viewer_id).all()}
    allowed_chapter_ids = viewer_allowed_chapter_ids(viewer_id)
    posts = Post.query.order_by(Post.created_at.desc()).limit(50).all()
    visible = [
        p
        for p in posts
        if post_visible_to_viewer(p, viewer_id, viewer=viewer, allowed_chapter_ids=allowed_chapter_ids)
    ][:20]
    return jsonify([serialize_post_summary_with_viewer(p, viewer_id, favorite_post_ids) for p in visible])


@bp.route("/activity/comments", methods=["GET"])
@jwt_required()
def recent_comments():
    me = current_user_id()
    comments = (
        Comment.query.join(Post, Post.post_id == Comment.post_id)
        .filter(Post.user_id == me)
        .order_by(Comment.created_at.desc())
        .limit(20)
        .all()
    )
    return jsonify(
        [
            {
                "comment_id": c.comment_id,
                "text": c.text,
                "post_id": c.post_id,
                "user_id": c.user_id,
                "created_at": c.created_at.isoformat(),
            }
            for c in comments
        ]
    )
