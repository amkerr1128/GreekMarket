from flask import jsonify, request
from flask_jwt_extended import jwt_required

from . import bp
from ..services.media import upload_image_files
from ..services.rate_limit import key_by_user_or_ip, rate_limit


@bp.route("/upload-image", methods=["POST"])
@jwt_required()
@rate_limit("media_upload", 40, 3600, key_func=key_by_user_or_ip)
def upload_image():
    image_files = request.files.getlist("images") or request.files.getlist("images[]")
    if not image_files and "image" in request.files:
        image_files = [request.files["image"]]

    if not image_files:
        return jsonify({"error": "No image file provided"}), 400

    try:
        urls = upload_image_files(image_files, folder="greekmarket/posts")
        if not urls:
            return jsonify({"error": "No valid image files provided"}), 400
        return jsonify({"url": urls[0], "urls": urls}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
