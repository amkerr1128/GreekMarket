from __future__ import annotations

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from flask import current_app
from werkzeug.security import generate_password_hash

from .. import db
from ..models import ContactVerificationChallenge, User, UserContactMethod
from .verification import (
    build_challenge_payload,
    create_challenge,
    mask_contact_value,
    normalize_contact_value,
    resend_verification_code,
    verify_challenge,
)

PASSWORD_RESET_PURPOSE = "password_reset"


def _serializer() -> URLSafeTimedSerializer:
    secret = current_app.config.get("JWT_SECRET_KEY") or current_app.secret_key or "greek-market-reset"
    return URLSafeTimedSerializer(secret_key=secret, salt="password-reset")


def _reset_token_ttl_seconds() -> int:
    minutes = int(current_app.config.get("PASSWORD_RESET_TOKEN_TTL_MINUTES") or 30)
    return max(5, minutes) * 60


def _find_verified_contact_user(contact_method: str, contact_value: str) -> User | None:
    normalized = normalize_contact_value(contact_method, contact_value)
    if not normalized:
        return None
    contact = UserContactMethod.query.filter_by(
        contact_method=contact_method,
        contact_value=normalized,
    ).first()
    return contact.user if contact else None


def find_password_reset_challenge(
    *,
    contact_method: str,
    contact_value: str,
    verification_id: int | None = None,
) -> ContactVerificationChallenge | None:
    normalized = normalize_contact_value(contact_method, contact_value)
    if verification_id:
        challenge = ContactVerificationChallenge.query.get(verification_id)
        if (
            challenge
            and challenge.purpose == PASSWORD_RESET_PURPOSE
            and (not contact_method or challenge.contact_method == contact_method)
            and (not normalized or challenge.contact_value == normalized)
        ):
            return challenge
        return None
    return (
        ContactVerificationChallenge.query.filter_by(
            purpose=PASSWORD_RESET_PURPOSE,
            contact_method=contact_method,
            contact_value=normalized,
            status="pending",
        )
        .order_by(ContactVerificationChallenge.created_at.desc())
        .first()
    )


def request_password_reset(*, contact_method: str, contact_value: str) -> tuple[User | None, ContactVerificationChallenge | None, dict | None]:
    user = _find_verified_contact_user(contact_method, contact_value)
    if not user:
        return None, None, None

    challenge, delivery = create_challenge(
        purpose=PASSWORD_RESET_PURPOSE,
        contact_method=contact_method,
        contact_value=contact_value,
        user_id=user.user_id,
    )
    return user, challenge, delivery


def resend_password_reset(
    *,
    contact_method: str,
    contact_value: str,
    verification_id: int | None = None,
) -> tuple[User | None, ContactVerificationChallenge | None, dict | None]:
    challenge = find_password_reset_challenge(
        contact_method=contact_method,
        contact_value=contact_value,
        verification_id=verification_id,
    )
    if challenge:
        delivery = resend_verification_code(challenge)
        return challenge.user, challenge, delivery

    return request_password_reset(contact_method=contact_method, contact_value=contact_value)


def _build_reset_token(user: User, challenge: ContactVerificationChallenge) -> str:
    return _serializer().dumps(
        {
            "user_id": user.user_id,
            "challenge_id": challenge.challenge_id,
            "contact_method": challenge.contact_method,
            "contact_value": challenge.contact_value,
        }
    )


def verify_password_reset(
    *,
    contact_method: str,
    contact_value: str,
    code: str,
    verification_id: int | None = None,
) -> tuple[ContactVerificationChallenge, User, str]:
    challenge = find_password_reset_challenge(
        contact_method=contact_method,
        contact_value=contact_value,
        verification_id=verification_id,
    )
    if not challenge:
        raise ValueError("Password reset session not found")

    challenge, user, _ = verify_challenge(verification_id=challenge.challenge_id, code=code)
    if not user:
        raise ValueError("User not found")
    reset_token = _build_reset_token(user, challenge)
    return challenge, user, reset_token


def inspect_password_reset_token(*, reset_token: str) -> tuple[User, ContactVerificationChallenge]:
    token = (reset_token or "").strip()
    if not token:
        raise ValueError("reset_token is required")

    try:
        payload = _serializer().loads(token, max_age=_reset_token_ttl_seconds())
    except SignatureExpired as exc:
        raise ValueError("Reset token expired") from exc
    except BadSignature as exc:
        raise ValueError("Invalid reset token") from exc

    user_id = payload.get("user_id")
    challenge_id = payload.get("challenge_id")
    contact_method = payload.get("contact_method")
    contact_value = payload.get("contact_value")

    challenge = ContactVerificationChallenge.query.get(challenge_id)
    if not challenge or challenge.user_id != user_id or challenge.purpose != PASSWORD_RESET_PURPOSE:
        raise ValueError("Password reset session not found")
    if challenge.contact_method != contact_method or challenge.contact_value != contact_value:
        raise ValueError("Password reset session does not match the verified contact")

    user = User.query.get(user_id)
    if not user:
        raise ValueError("User not found")

    return user, challenge


def complete_password_reset(*, reset_token: str, new_password: str) -> tuple[User, ContactVerificationChallenge]:
    if len(new_password or "") < 8:
        raise ValueError("Password must be at least 8 characters long")
    user, challenge = inspect_password_reset_token(reset_token=reset_token)
    if challenge.status != "verified":
        raise ValueError("Password reset session is no longer active")

    user.password_hash = generate_password_hash(new_password)

    ContactVerificationChallenge.query.filter_by(
        user_id=user.user_id,
        purpose=PASSWORD_RESET_PURPOSE,
    ).update({"status": "revoked"}, synchronize_session=False)
    db.session.commit()
    return user, challenge


def build_password_reset_session_payload(
    *,
    user: User | None,
    challenge: ContactVerificationChallenge,
    reset_token: str | None = None,
    include_email: bool = False,
) -> dict:
    payload = build_password_reset_request_payload(
        contact_method=challenge.contact_method,
        contact_value=challenge.contact_value,
        challenge=challenge,
    )
    payload["reset_id"] = challenge.challenge_id
    payload["challenge_id"] = challenge.challenge_id
    payload["status"] = challenge.status
    payload["expires_at"] = challenge.expires_at.isoformat() if challenge.expires_at else None
    payload["delivery_channel"] = challenge.delivery_channel or challenge.contact_method
    if include_email and user and user.email:
        payload["email"] = user.email
    if reset_token:
        payload["reset_token"] = reset_token
        payload["token"] = reset_token
    return payload


def build_password_reset_request_payload(
    *,
    contact_method: str,
    contact_value: str,
    challenge: ContactVerificationChallenge | None = None,
    delivery: dict | None = None,
) -> dict:
    payload = {
        "contact_method": contact_method,
        "contact_value": mask_contact_value(contact_method, contact_value),
    }
    if challenge:
        payload["reset_id"] = challenge.challenge_id
        payload["challenge_id"] = challenge.challenge_id
        payload["verification"] = build_challenge_payload(challenge)
        payload["expires_at"] = challenge.expires_at.isoformat() if challenge.expires_at else None
        payload["delivery_channel"] = challenge.delivery_channel or challenge.contact_method
    if delivery and delivery.get("preview_code"):
        payload["preview_code"] = delivery["preview_code"]
    return payload
