from hashlib import sha256

from flask import jsonify, request

from .. import db
from ..services.notifications import create_notification
from ..services.rate_limit import key_by_ip, rate_limit
from ..services.recovery import (
    build_password_reset_session_payload,
    build_password_reset_request_payload,
    complete_password_reset,
    find_password_reset_challenge,
    inspect_password_reset_token,
    request_password_reset,
    resend_password_reset,
    verify_password_reset,
)
from . import bp


def _extract_contact(data: dict, *, required: bool = True) -> tuple[str, str]:
    method = (data.get("contact_method") or "").strip().lower()
    if not method and data.get("phone_number"):
        method = "phone"
    if not method and any(data.get(key) for key in ("contact_value", "email")):
        method = "email"
    if not method and not required:
        return "", ""
    if not method:
        if data.get("phone_number"):
            method = "phone"
        else:
            method = "email"
    if method not in {"email", "phone"}:
        raise ValueError("contact_method must be email or phone")

    if method == "email":
        value = (data.get("contact_value") or data.get("email") or "").strip().lower()
    else:
        value = (data.get("contact_value") or data.get("phone_number") or "").strip()
    if not value and not required:
        return method, ""
    if not value:
        raise ValueError("contact_value is required")
    return method, value


def _extract_reset_id(payload: dict) -> int | None:
    raw = payload.get("verification_id") or payload.get("reset_id") or payload.get("challenge_id")
    if raw in (None, ""):
        return None
    return int(raw)


def _recovery_contact_rate_limit_key() -> str:
    data = request.get_json(silent=True) or {}
    contact_value = (data.get("contact_value") or data.get("email") or data.get("phone_number") or "").strip()
    if not contact_value:
        return key_by_ip()
    digest = sha256(contact_value.lower().encode("utf-8")).hexdigest()[:16]
    return f"{key_by_ip()}:field:{digest}"


@bp.route("/password-reset/request", methods=["POST"])
@rate_limit("password_reset_request", 6, 3600, key_func=_recovery_contact_rate_limit_key)
def request_password_reset_route():
    data = request.get_json(silent=True) or {}
    try:
        contact_method, contact_value = _extract_contact(data)
        _, challenge, delivery = request_password_reset(
            contact_method=contact_method,
            contact_value=contact_value,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to start account recovery"}), 503

    payload = build_password_reset_request_payload(
        contact_method=contact_method,
        contact_value=contact_value,
        challenge=challenge,
        delivery=delivery,
    )
    return (
        jsonify(
            {
                "message": "If that verified contact belongs to an account, we sent a recovery code.",
                "recovery": payload,
            }
        ),
        202,
    )


@bp.route("/password-reset/resend", methods=["POST"])
@rate_limit("password_reset_resend", 5, 1800, key_func=_recovery_contact_rate_limit_key)
def resend_password_reset_route():
    data = request.get_json(silent=True) or {}
    verification_id = _extract_reset_id(data)
    try:
        contact_method, contact_value = _extract_contact(data)
        _, challenge, delivery = resend_password_reset(
            contact_method=contact_method,
            contact_value=contact_value,
            verification_id=verification_id,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to resend the recovery code"}), 503

    payload = build_password_reset_request_payload(
        contact_method=contact_method,
        contact_value=contact_value,
        challenge=challenge,
        delivery=delivery,
    )
    return (
        jsonify(
            {
                "message": "If that verified contact belongs to an account, we resent the recovery code.",
                "recovery": payload,
            }
        ),
        200,
    )


@bp.route("/password-reset/status", methods=["GET"])
@rate_limit("password_reset_status", 30, 300, key_func=key_by_ip)
def password_reset_status_route():
    params = request.args.to_dict(flat=True)
    reset_token = (params.get("token") or params.get("reset_token") or "").strip()

    try:
        if reset_token:
            user, challenge = inspect_password_reset_token(reset_token=reset_token)
            payload = build_password_reset_session_payload(
                user=user,
                challenge=challenge,
                reset_token=reset_token,
                include_email=True,
            )
            return jsonify({"reset": payload}), 200

        reset_id = _extract_reset_id(params)
        contact_method, contact_value = _extract_contact(params, required=False)
        if not reset_id and not contact_value:
            return jsonify({"error": "A reset session or verified contact is required"}), 400

        challenge = find_password_reset_challenge(
            contact_method=contact_method or "email",
            contact_value=contact_value,
            verification_id=reset_id,
        )
        if not challenge:
            return jsonify({"error": "Password reset session not found"}), 404
        if challenge.status != "pending":
            return jsonify({"error": "Password reset session is no longer active"}), 400

        payload = build_password_reset_session_payload(
            user=challenge.user,
            challenge=challenge,
            include_email=bool(contact_value),
        )
        return jsonify({"reset": payload}), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to load the recovery session"}), 500


@bp.route("/password-reset/verify", methods=["POST"])
@rate_limit("password_reset_verify", 10, 1800, key_func=key_by_ip)
def verify_password_reset_route():
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    verification_id = data.get("verification_id") or data.get("reset_id")
    if not code:
        return jsonify({"error": "code is required"}), 400

    try:
        contact_method, contact_value = _extract_contact(data)
        challenge, _, reset_token = verify_password_reset(
            contact_method=contact_method,
            contact_value=contact_value,
            code=code,
            verification_id=int(verification_id) if verification_id else None,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to verify the recovery code"}), 500

    return (
        jsonify(
            {
                "message": "Recovery code verified. You can set a new password now.",
                "reset_token": reset_token,
                "verification": {
                    "verification_id": challenge.challenge_id,
                    "contact_method": challenge.contact_method,
                    "contact_value": build_password_reset_request_payload(
                        contact_method=challenge.contact_method,
                        contact_value=challenge.contact_value,
                    )["contact_value"],
                },
            }
        ),
        200,
    )


@bp.route("/password-reset/confirm", methods=["POST"])
@rate_limit("password_reset_confirm", 8, 1800, key_func=key_by_ip)
def confirm_password_reset_route():
    data = request.get_json(silent=True) or {}
    reset_token = (data.get("reset_token") or data.get("token") or "").strip()
    new_password = data.get("password") or data.get("new_password") or ""
    password_confirmation = data.get("password_confirmation") or data.get("confirm_password") or ""
    code = (data.get("code") or "").strip()

    if password_confirmation and new_password != password_confirmation:
        return jsonify({"error": "Password confirmation does not match"}), 400

    try:
        if not reset_token:
            if not code:
                return jsonify({"error": "A reset code is required"}), 400
            verification_id = _extract_reset_id(data)
            contact_method, contact_value = _extract_contact(data)
            _, _, reset_token = verify_password_reset(
                contact_method=contact_method,
                contact_value=contact_value,
                code=code,
                verification_id=verification_id,
            )

        user, challenge = complete_password_reset(reset_token=reset_token, new_password=new_password)
        create_notification(
            recipient_id=user.user_id,
            actor_id=user.user_id,
            event_type="password_reset_completed",
            event_key=f"password-reset:{challenge.challenge_id}",
            title="Password updated",
            body="Your password was updated successfully. If this was not you, contact support immediately.",
            action_url="/login",
            payload={
                "challenge_id": challenge.challenge_id,
                "contact_method": challenge.contact_method,
            },
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to reset password"}), 500

    db.session.commit()
    return jsonify({"message": "Password updated successfully."}), 200


@bp.route("/password-reset/complete", methods=["POST"])
@rate_limit("password_reset_complete", 6, 1800, key_func=key_by_ip)
def complete_password_reset_route():
    data = request.get_json(silent=True) or {}
    reset_token = data.get("reset_token") or data.get("token") or ""
    new_password = data.get("new_password") or data.get("password") or ""
    try:
        user, challenge = complete_password_reset(reset_token=reset_token, new_password=new_password)
        create_notification(
            recipient_id=user.user_id,
            actor_id=user.user_id,
            event_type="password_reset_completed",
            event_key=f"password-reset:{challenge.challenge_id}",
            title="Password updated",
            body="Your password was updated successfully. If this was not you, contact support immediately.",
            action_url="/login",
            payload={
                "challenge_id": challenge.challenge_id,
                "contact_method": challenge.contact_method,
            },
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc) or "Unable to reset password"}), 500

    db.session.commit()
    return jsonify({"message": "Password updated successfully."}), 200
