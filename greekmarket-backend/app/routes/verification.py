from flask import jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    jwt_required,
    set_refresh_cookies,
)
from werkzeug.security import generate_password_hash

from .. import db
from ..models import ContactVerificationChallenge, PendingRegistration, User
from ..services.verification import (
    build_challenge_payload,
    build_pending_registration_payload,
    create_challenge,
    create_pending_registration,
    ensure_registration_can_be_verified,
    resend_verification_code,
    verify_challenge,
)
from ..services.notifications import create_notification
from ..services.rate_limit import key_by_ip, key_by_ip_and_field, key_by_user_and_field, key_by_user_or_ip, rate_limit
from . import bp
from .common import MAX_HANDLE_LENGTH, current_user_id, serialize_user


def _issue_login_response(user: User):
    access_token = create_access_token(identity=str(user.user_id))
    refresh_token = create_refresh_token(identity=str(user.user_id))
    resp = jsonify(
        access_token=access_token,
        user=serialize_user(user, include_verification_details=True, include_private_fields=True),
    )
    set_refresh_cookies(resp, refresh_token)
    return resp, 200


@bp.route("/register", methods=["POST"])
@rate_limit("verification_register", 6, 3600, key_func=lambda: key_by_ip_and_field("email"))
def start_registration():
    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    if not password:
        return jsonify({"error": "Missing required fields"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long"}), 400
    email = (data.get("email") or "").strip().lower()
    handle = (data.get("handle") or "").strip()
    if email and len(email) > 255:
        return jsonify({"error": "Email is too long"}), 400
    if handle and len(handle) > MAX_HANDLE_LENGTH:
        return jsonify({"error": "Handle is too long"}), 400

    preferred_method = (
        data.get("preferred_contact_method")
        or data.get("preferred_method")
        or data.get("contact_method")
        or "email"
    ).strip().lower()
    phone_number = (data.get("phone_number") or "").strip()
    if preferred_method == "phone" and not phone_number:
        return jsonify({"error": "Phone number is required when phone verification is selected"}), 400

    try:
        pending = create_pending_registration(
            {
                "first_name": data.get("first_name"),
                "last_name": data.get("last_name"),
                "email": data.get("email"),
                "phone_number": phone_number or None,
                "handle": data.get("handle"),
                "password_hash": generate_password_hash(password),
                "school_id": data.get("school_id"),
                "preferred_method": preferred_method,
            }
        )
        contact_value = pending.email if pending.preferred_method == "email" else pending.phone_number
        challenge, delivery = create_challenge(
            purpose="signup",
            contact_method=pending.preferred_method,
            contact_value=contact_value,
            registration_id=pending.registration_id,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to start verification"}), 503

    payload = build_pending_registration_payload(pending, challenge, delivery)
    message = "Verification code sent. Complete verification to create your account."
    if payload.get("preview_code"):
        message = "Verification code generated for development preview."
    return jsonify({"message": message, "verification": payload}), 202


@bp.route("/register/confirm", methods=["POST"])
def confirm_registration():
    return confirm_verification()


@bp.route("/verification/start", methods=["POST"])
@jwt_required()
@rate_limit("verification_start", 5, 1800, key_func=lambda: key_by_user_and_field("contact_value"))
def start_profile_verification():
    user_id = current_user_id()
    user = User.query.get(user_id) if user_id else None
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True) or {}
    contact_method = (data.get("contact_method") or "email").strip().lower()
    contact_value = (data.get("contact_value") or "").strip()
    if contact_method == "email":
        contact_value = contact_value or user.email
    elif contact_method == "phone":
        if not contact_value:
            return jsonify({"error": "contact_value is required for phone verification"}), 400
    else:
        return jsonify({"error": "contact_method must be email or phone"}), 400

    try:
        challenge, delivery = create_challenge(
            purpose="profile",
            contact_method=contact_method,
            contact_value=contact_value,
            user_id=user.user_id,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to start verification"}), 503

    payload = build_challenge_payload(challenge)
    if delivery.get("preview_code"):
        payload["preview_code"] = delivery["preview_code"]
    return jsonify({"message": "Verification code sent.", "verification": payload}), 202


@bp.route("/verification/confirm", methods=["POST"])
@rate_limit("verification_confirm", 10, 1800, key_func=key_by_ip)
def confirm_verification():
    data = request.get_json(silent=True) or {}
    verification_id = data.get("verification_id")
    code = (data.get("code") or "").strip()
    if not verification_id or not code:
        return jsonify({"error": "Missing verification_id or code"}), 400

    try:
        challenge, user, pending = verify_challenge(verification_id=int(verification_id), code=code)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to complete verification"}), 500

    verification_payload = build_challenge_payload(challenge)
    if pending:
        access_token = create_access_token(identity=str(user.user_id))
        refresh_token = create_refresh_token(identity=str(user.user_id))
        create_notification(
            recipient_id=user.user_id,
            actor_id=user.user_id,
            event_type="verification_completed",
            event_key=f"verification:{challenge.challenge_id}",
            title="Account verified",
            body="Your account verification is complete. Finish setup from your dashboard when you're ready.",
            action_url="/dashboard",
            payload={
                "verification_id": challenge.challenge_id,
                "pending_registration_id": pending.registration_id,
            },
        )
        db.session.commit()
        response = jsonify(
            message="Account created and verified.",
            verification=verification_payload,
            pending_registration_id=pending.registration_id,
            user=serialize_user(user, include_verification_details=True, include_private_fields=True),
            access_token=access_token,
        )
        set_refresh_cookies(response, refresh_token)
        return response, 200

    if user:
        create_notification(
            recipient_id=user.user_id,
            actor_id=user.user_id,
            event_type="verification_completed",
            event_key=f"verification:{challenge.challenge_id}",
            title="Contact verified",
            body="Your contact method is verified. You can keep finishing setup from your dashboard.",
            action_url="/dashboard",
            payload={
                "verification_id": challenge.challenge_id,
            },
        )
        db.session.commit()
        return jsonify(
            {
                "message": "Contact verified.",
                "verification": verification_payload,
                "user": serialize_user(user, include_verification_details=True, include_private_fields=True),
            }
        ), 200

    return jsonify({"message": "Verification completed.", "verification": verification_payload}), 200


@bp.route("/verification/status", methods=["GET"])
@jwt_required(optional=True)
def verification_status():
    registration_id = request.args.get("registration_id", type=int)
    verification_id = request.args.get("verification_id", type=int)

    if verification_id:
        challenge = ContactVerificationChallenge.query.get(verification_id)
        if not challenge:
            return jsonify({"error": "Verification session not found"}), 404
        payload = build_challenge_payload(challenge)
        if challenge.registration:
            payload["registration"] = build_pending_registration_payload(challenge.registration)
        return jsonify({"verification": payload}), 200

    if registration_id:
        registration = PendingRegistration.query.get(registration_id)
        if not registration:
            return jsonify({"error": "Pending registration not found"}), 404
        challenge = None
        if registration.registration_id:
            challenge = ContactVerificationChallenge.query.filter_by(
                registration_id=registration.registration_id,
                purpose="signup",
                status="pending",
            ).order_by(ContactVerificationChallenge.created_at.desc()).first()
        payload = build_pending_registration_payload(registration, challenge)
        return jsonify({"verification": payload}), 200

    user_id = current_user_id()
    if not user_id:
        return jsonify({"error": "No active session"}), 401
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"user": serialize_user(user, include_verification_details=True, include_private_fields=True)}), 200


@bp.route("/verification/resend", methods=["POST"])
@jwt_required(optional=True)
@rate_limit("verification_resend", 5, 1800, key_func=key_by_user_or_ip)
def resend_verification():
    data = request.get_json(silent=True) or {}
    verification_id = data.get("verification_id")
    registration_id = data.get("registration_id")

    challenge = None
    registration = None
    if verification_id:
        challenge = ContactVerificationChallenge.query.get(int(verification_id))
        if challenge and challenge.registration_id:
            registration = PendingRegistration.query.get(challenge.registration_id)
    elif registration_id:
        registration = PendingRegistration.query.get(int(registration_id))
        if not registration:
            return jsonify({"error": "Pending registration not found"}), 404
        try:
            ensure_registration_can_be_verified(registration)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        challenge = ContactVerificationChallenge.query.filter_by(
            registration_id=int(registration_id),
            purpose="signup",
            status="pending",
        ).order_by(ContactVerificationChallenge.created_at.desc()).first()

        if not challenge:
            try:
                challenge, delivery = create_challenge(
                    purpose="signup",
                    contact_method=registration.preferred_method,
                    contact_value=registration.email if registration.preferred_method == "email" else registration.phone_number,
                    registration_id=registration.registration_id,
                )
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400
            except Exception as exc:
                return jsonify({"error": str(exc) or "Unable to resend verification"}), 503

            payload = build_challenge_payload(challenge)
            if delivery.get("preview_code"):
                payload["preview_code"] = delivery["preview_code"]
            return jsonify({"message": "Verification code resent.", "verification": payload}), 200
    elif current_user_id():
        user = User.query.get(current_user_id())
        if not user:
            return jsonify({"error": "User not found"}), 404
        contact_method = (data.get("contact_method") or "email").strip().lower()
        contact_value = (data.get("contact_value") or "").strip() or user.email
        try:
            challenge, delivery = create_challenge(
                purpose="profile",
                contact_method=contact_method,
                contact_value=contact_value,
                user_id=user.user_id,
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            return jsonify({"error": str(exc) or "Unable to resend verification"}), 503

        payload = build_challenge_payload(challenge)
        if delivery.get("preview_code"):
            payload["preview_code"] = delivery["preview_code"]
        return jsonify({"message": "Verification code resent.", "verification": payload}), 200

    if not challenge:
        return jsonify({"error": "verification_id or registration_id is required"}), 400

    if registration:
        try:
            ensure_registration_can_be_verified(registration)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    try:
        delivery = resend_verification_code(challenge)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to resend verification"}), 503

    payload = build_challenge_payload(challenge)
    if delivery.get("preview_code"):
        payload["preview_code"] = delivery["preview_code"]
    return jsonify({"message": "Verification code resent.", "verification": payload}), 200
