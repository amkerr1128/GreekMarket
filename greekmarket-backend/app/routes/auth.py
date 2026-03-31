from flask import jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    jwt_required,
    set_refresh_cookies,
    unset_jwt_cookies,
)
from werkzeug.security import check_password_hash

from ..models import User
from ..services.rate_limit import key_by_ip_and_field, key_by_user_or_ip, rate_limit
from . import bp
from .common import current_user_id


@bp.route("/login", methods=["POST"])
@rate_limit("auth_login", 10, 300, key_func=lambda: key_by_ip_and_field("email"))
def login_user():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Missing email or password"}), 400
    if len(email) > 255:
        return jsonify({"error": "Email is too long"}), 400

    user = User.query.filter_by(email=email).first()

    if user and check_password_hash(user.password_hash, password):
        access_token = create_access_token(identity=str(user.user_id))
        refresh_token = create_refresh_token(identity=str(user.user_id))
        resp = jsonify(access_token=access_token)
        set_refresh_cookies(resp, refresh_token)
        return resp, 200

    return jsonify({"error": "Invalid credentials"}), 401


@bp.route("/token/refresh", methods=["POST"])
@jwt_required(refresh=True)
@rate_limit("auth_refresh", 30, 300, key_func=key_by_user_or_ip)
def refresh_access_token():
    user_id = current_user_id()
    new_access = create_access_token(identity=str(user_id))
    return jsonify(access_token=new_access), 200


@bp.route("/logout", methods=["POST"])
def logout():
    resp = jsonify({"message": "Logged out"})
    unset_jwt_cookies(resp)
    return resp, 200
