from flask import jsonify, request
from flask_jwt_extended import jwt_required
from flask_jwt_extended import unset_jwt_cookies
from werkzeug.security import check_password_hash

from .. import db
from ..models import Chapter, School, User, UserChapterMembership
from ..services.accounts import delete_user_account
from ..services.media import upload_image_files
from . import bp
from .common import current_user_id, serialize_user


@bp.route("/me", methods=["GET"])
@jwt_required()
def get_profile():
    user_id = current_user_id()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    membership = UserChapterMembership.query.filter_by(user_id=user.user_id).first()
    chapter_name = chapter_id = chapter_role = chapter_profile_picture_url = None
    if membership:
        chapter = Chapter.query.get(membership.chapter_id)
        if chapter:
            chapter_name = chapter.name
            chapter_id = chapter.chapter_id
            chapter_role = membership.role
            chapter_profile_picture_url = chapter.profile_picture_url

    return jsonify(
        {
            **serialize_user(
                user,
                include_verification_details=True,
                viewer_user_id=user_id,
                include_follow_metadata=True,
                include_private_fields=True,
            ),
            "chapter": {
                "chapter_id": chapter_id,
                "name": chapter_name,
                "role": chapter_role,
                "profile_picture_url": chapter_profile_picture_url,
            }
            if chapter_id
            else None,
            "chapter_id": chapter_id,
            "chapter_name": chapter_name,
            "chapter_role": chapter_role,
            "chapter_profile_picture_url": chapter_profile_picture_url,
            "can_manage_chapter_branding": bool(chapter_id and str(chapter_role).lower() == "admin"),
        }
    )


@bp.route("/me", methods=["PUT"])
@jwt_required()
def update_profile():
    """
    Update the logged-in user profile.
    Supports safe fields like first_name, last_name, handle, school_id, and profile_picture_url.
    """
    user_id = current_user_id()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True) or request.form.to_dict(flat=True)
    updated_fields = set()

    if "first_name" in data:
        first_name = (data.get("first_name") or "").strip()
        if not first_name:
            return jsonify({"error": "first_name cannot be empty"}), 400
        user.first_name = first_name
        updated_fields.add("first_name")

    if "last_name" in data:
        last_name = (data.get("last_name") or "").strip()
        if not last_name:
            return jsonify({"error": "last_name cannot be empty"}), 400
        user.last_name = last_name
        updated_fields.add("last_name")

    if "handle" in data:
        handle = (data.get("handle") or "").strip()
        if not handle:
            return jsonify({"error": "handle cannot be empty"}), 400
        existing = User.query.filter(User.handle == handle, User.user_id != user.user_id).first()
        if existing:
            return jsonify({"error": "Handle already taken"}), 409
        user.handle = handle
        updated_fields.add("handle")

    if "school_id" in data:
        school_id = data.get("school_id")
        if school_id in ("", None):
            user.school_id = None
        else:
            school = School.query.get(school_id)
            if not school:
                return jsonify({"error": "Invalid school_id"}), 400
            user.school_id = school.school_id
        updated_fields.add("school_id")

    if "profile_picture_url" in data:
        profile_picture_url = (data.get("profile_picture_url") or "").strip()
        user.profile_picture_url = profile_picture_url or None
        updated_fields.add("profile_picture_url")

    db.session.commit()
    response = serialize_user(
        user,
        include_verification_details=True,
        viewer_user_id=user_id,
        include_follow_metadata=True,
        include_private_fields=True,
    )
    response["message"] = "Profile updated."
    response["updated_fields"] = sorted(updated_fields)
    return jsonify(response), 200


@bp.route("/me", methods=["DELETE"])
@jwt_required()
def delete_profile():
    user_id = current_user_id()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    password = payload.get("password") or ""
    if not password:
        return jsonify({"error": "Password is required to delete your account"}), 400
    if not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Incorrect password"}), 401

    delete_user_account(user.user_id)
    response = jsonify({"message": "Your account has been deleted."})
    unset_jwt_cookies(response)
    return response, 200


@bp.route("/me/profile-picture", methods=["POST", "PUT"])
@jwt_required()
def update_profile_picture():
    user_id = current_user_id()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    image_url = (request.form.get("profile_picture_url") or payload.get("profile_picture_url") or None)

    if "image" in request.files or request.files.getlist("images") or request.files.getlist("images[]"):
        files = request.files.getlist("images") or request.files.getlist("images[]") or [request.files["image"]]
        uploaded = upload_image_files(files, folder="greekmarket/users")
        image_url = uploaded[0] if uploaded else None

    if image_url is None:
        return jsonify({"error": "No profile image provided"}), 400

    user.profile_picture_url = image_url or None
    db.session.commit()
    return jsonify({"message": "Profile picture updated.", "user": serialize_user(user, include_private_fields=True)}), 200


@bp.route("/me/profile-picture", methods=["DELETE"])
@jwt_required()
def clear_profile_picture():
    user_id = current_user_id()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    user.profile_picture_url = None
    db.session.commit()
    return jsonify({"message": "Profile picture cleared.", "user": serialize_user(user, include_private_fields=True)}), 200
