from __future__ import annotations

import hashlib
import json
import os
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage
from urllib import error as urllib_error
from urllib import request as urllib_request

from flask import current_app

from .. import db
from ..models import (
    ChapterFollow,
    ContactVerificationChallenge,
    PendingRegistration,
    School,
    SchoolMembership,
    User,
    UserChapterMembership,
    UserContactMethod,
)

VERIFICATION_METHODS = {"email", "phone"}
VERIFICATION_PURPOSES = {"signup", "profile", "password_reset"}


def _environment() -> str:
    return (current_app.config.get("ENVIRONMENT") or os.getenv("APP_ENV") or os.getenv("FLASK_ENV") or "development").lower()


def _now() -> datetime:
    return datetime.utcnow()


def _verification_code_length() -> int:
    return int(os.getenv("VERIFICATION_CODE_LENGTH", "6"))


def _verification_ttl() -> timedelta:
    minutes = int(current_app.config.get("VERIFICATION_CODE_TTL_MINUTES") or 15)
    return timedelta(minutes=minutes)


def _pending_registration_ttl() -> timedelta:
    hours = int(current_app.config.get("PENDING_REGISTRATION_TTL_HOURS") or 24)
    return timedelta(hours=hours)


def normalize_contact_value(method: str, value: str | None) -> str:
    normalized = (value or "").strip()
    if method == "email":
        return normalized.lower()
    if method == "phone":
        return "".join(ch for ch in normalized if ch.isdigit() or ch == "+")
    return normalized


def mask_contact_value(method: str, value: str | None) -> str:
    normalized = normalize_contact_value(method, value)
    if not normalized:
        return ""
    if method == "email":
        local, _, domain = normalized.partition("@")
        if not domain:
            return normalized
        prefix = local[:2] if len(local) > 2 else local[:1]
        return f"{prefix}***@{domain}"
    if method == "phone":
        digits = "".join(ch for ch in normalized if ch.isdigit())
        if len(digits) <= 4:
            return normalized
        return f"***-***-{digits[-4:]}"
    return normalized


def generate_verification_code() -> str:
    digits = max(4, _verification_code_length())
    upper = 10**digits
    return f"{secrets.randbelow(upper):0{digits}d}"


def hash_verification_code(code: str, salt: str) -> str:
    payload = f"{salt}:{code}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _smtp_enabled() -> bool:
    return bool(current_app.config.get("SMTP_HOST") and current_app.config.get("SMTP_FROM_EMAIL"))


def _phone_enabled() -> bool:
    return bool(current_app.config.get("PHONE_VERIFICATION_ENABLED") and current_app.config.get("SMS_GATEWAY_URL"))


def _send_email_code(email: str, code: str, purpose: str) -> dict:
    if not _smtp_enabled():
        if _environment() == "production":
            raise ValueError("Email verification is not configured")
        return {"delivered": False, "provider_message_id": None, "preview_code": code}

    subject = "Your Greek Market verification code"
    if purpose == "signup":
        subject = "Verify your Greek Market account"

    body = "\n".join(
        [
            f"Your Greek Market verification code is: {code}",
            "",
            "This code expires soon and can only be used once.",
            "If you did not request this code, you can ignore this email.",
        ]
    )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{current_app.config.get('SMTP_FROM_NAME')} <{current_app.config.get('SMTP_FROM_EMAIL')}>"
    message["To"] = email
    message.set_content(body)

    host = current_app.config.get("SMTP_HOST")
    port = int(current_app.config.get("SMTP_PORT") or 587)
    username = current_app.config.get("SMTP_USERNAME")
    password = current_app.config.get("SMTP_PASSWORD")
    use_tls = bool(current_app.config.get("SMTP_USE_TLS"))
    use_ssl = bool(current_app.config.get("SMTP_USE_SSL"))

    context = ssl.create_default_context()
    if use_ssl:
        client = smtplib.SMTP_SSL(host, port, context=context, timeout=15)
    else:
        client = smtplib.SMTP(host, port, timeout=15)

    with client as smtp:
        if use_tls and not use_ssl:
            smtp.starttls(context=context)
        if username and password:
            smtp.login(username, password)
        smtp.send_message(message)

    return {"delivered": True, "provider_message_id": None, "preview_code": None}


def _send_phone_code(phone_number: str, code: str, purpose: str) -> dict:
    if not _phone_enabled():
        if _environment() == "production":
            raise ValueError("Phone verification is not configured")
        return {"delivered": False, "provider_message_id": None, "preview_code": code}

    payload = {
        "to": phone_number,
        "from": current_app.config.get("SMS_FROM_NUMBER"),
        "purpose": purpose,
        "code": code,
        "message": f"Your Greek Market verification code is {code}.",
    }
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    token = current_app.config.get("SMS_GATEWAY_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib_request.Request(
        current_app.config.get("SMS_GATEWAY_URL"),
        data=data,
        headers=headers,
        method=current_app.config.get("SMS_GATEWAY_METHOD") or "POST",
    )

    with urllib_request.urlopen(req, timeout=15) as response:
        body = response.read().decode("utf-8", errors="ignore")
        provider_message_id = response.headers.get("X-Message-Id")
        if not provider_message_id and body:
            provider_message_id = body[:255]

    return {"delivered": True, "provider_message_id": provider_message_id, "preview_code": None}


def send_verification_code(method: str, contact_value: str, code: str, purpose: str) -> dict:
    if method == "email":
        return _send_email_code(contact_value, code, purpose)
    if method == "phone":
        return _send_phone_code(contact_value, code, purpose)
    raise ValueError("Unsupported verification method")


def find_active_challenge(
    *,
    purpose: str,
    contact_method: str,
    registration_id: int | None = None,
    user_id: int | None = None,
) -> ContactVerificationChallenge | None:
    query = ContactVerificationChallenge.query.filter_by(
        purpose=purpose,
        contact_method=contact_method,
        status="pending",
    )
    if registration_id is not None:
        query = query.filter_by(registration_id=registration_id)
    if user_id is not None:
        query = query.filter_by(user_id=user_id)
    return query.order_by(ContactVerificationChallenge.created_at.desc()).first()


def _validate_contact_method(method: str) -> str:
    normalized = (method or "").strip().lower()
    if normalized not in VERIFICATION_METHODS:
        raise ValueError("contact_method must be email or phone")
    return normalized


def _validate_purpose(purpose: str) -> str:
    normalized = (purpose or "").strip().lower()
    if normalized not in VERIFICATION_PURPOSES:
        raise ValueError("purpose must be signup, profile, or password_reset")
    return normalized


def create_challenge(
    *,
    purpose: str,
    contact_method: str,
    contact_value: str,
    registration_id: int | None = None,
    user_id: int | None = None,
) -> tuple[ContactVerificationChallenge, dict]:
    purpose = _validate_purpose(purpose)
    contact_method = _validate_contact_method(contact_method)
    normalized_contact = normalize_contact_value(contact_method, contact_value)
    if not normalized_contact:
        raise ValueError("contact_value is required")

    challenge = find_active_challenge(
        purpose=purpose,
        contact_method=contact_method,
        registration_id=registration_id,
        user_id=user_id,
    )
    if challenge is None:
        challenge = ContactVerificationChallenge(
            registration_id=registration_id,
            user_id=user_id,
            purpose=purpose,
            contact_method=contact_method,
            contact_value=normalized_contact,
            code_hash="",
            code_salt="",
            status="pending",
            attempts=0,
            max_attempts=5,
            expires_at=_now() + _verification_ttl(),
        )
        db.session.add(challenge)
    else:
        challenge.contact_value = normalized_contact
        challenge.status = "pending"
        challenge.attempts = 0
        challenge.expires_at = _now() + _verification_ttl()
        challenge.verified_at = None

    code = generate_verification_code()
    salt = secrets.token_urlsafe(16)
    challenge.code_salt = salt
    challenge.code_hash = hash_verification_code(code, salt)
    challenge.sent_at = _now()
    challenge.delivery_channel = contact_method
    challenge.provider_message_id = None

    delivery = send_verification_code(contact_method, normalized_contact, code, purpose)
    challenge.provider_message_id = delivery.get("provider_message_id")

    if delivery.get("preview_code"):
        # Helpful for local development when SMTP/SMS are not configured.
        delivery["preview_code"] = code

    db.session.commit()
    return challenge, delivery


def _registration_expired(registration: PendingRegistration) -> bool:
    return bool(registration.expires_at and registration.expires_at <= _now())


def _challenge_expired(challenge: ContactVerificationChallenge) -> bool:
    return bool(challenge.expires_at and challenge.expires_at <= _now())


def _finalize_user_contacts(user: User, method: str, value: str, *, primary: bool = True) -> UserContactMethod:
    existing = UserContactMethod.query.filter_by(
        user_id=user.user_id,
        contact_method=method,
        contact_value=normalize_contact_value(method, value),
    ).first()
    if existing:
        existing.verified_at = _now()
        existing.is_primary = primary or existing.is_primary
        return existing

    contact = UserContactMethod(
        user_id=user.user_id,
        contact_method=method,
        contact_value=normalize_contact_value(method, value),
        is_primary=primary,
        verified_at=_now(),
    )
    db.session.add(contact)
    return contact


def _create_user_from_registration(registration: PendingRegistration, method: str) -> User:
    school = School.query.get(registration.school_id)
    if not school:
        raise ValueError("Invalid school associated with pending registration")

    existing_email = User.query.filter_by(email=registration.email).first()
    if existing_email:
        raise ValueError("Email already exists")

    existing_handle = User.query.filter_by(handle=registration.handle).first()
    if existing_handle:
        raise ValueError("Handle already taken")

    user = User(
        first_name=registration.first_name,
        last_name=registration.last_name,
        email=registration.email,
        handle=registration.handle,
        school_id=registration.school_id,
        password_hash=registration.password_hash,
    )
    db.session.add(user)
    db.session.flush()

    verified_contact_value = registration.email if method == "email" else registration.phone_number
    _finalize_user_contacts(user, method, verified_contact_value or registration.email, primary=True)

    registration.status = "verified"
    registration.verified_at = _now()
    registration.verification_method = method
    registration.user = user
    return user


def verify_challenge(
    *,
    verification_id: int,
    code: str,
) -> tuple[ContactVerificationChallenge, User | None, PendingRegistration | None]:
    challenge = ContactVerificationChallenge.query.get(verification_id)
    if not challenge:
        raise ValueError("Verification session not found")

    if challenge.status != "pending":
        raise ValueError("Verification session is no longer active")

    if _challenge_expired(challenge):
        challenge.status = "expired"
        db.session.commit()
        raise ValueError("Verification code expired")

    challenge.attempts += 1
    if challenge.attempts > challenge.max_attempts:
        challenge.status = "revoked"
        db.session.commit()
        raise ValueError("Too many invalid attempts")

    expected = hash_verification_code((code or "").strip(), challenge.code_salt)
    if not secrets.compare_digest(expected, challenge.code_hash):
        db.session.commit()
        raise ValueError("Invalid verification code")

    challenge.status = "verified"
    challenge.verified_at = _now()

    user = None
    pending = None
    if challenge.purpose == "signup":
        pending = PendingRegistration.query.get(challenge.registration_id) if challenge.registration_id else None
        if not pending:
            db.session.commit()
            raise ValueError("Pending registration not found")
        if _registration_expired(pending):
            pending.status = "expired"
            db.session.commit()
            raise ValueError("Registration has expired")
        user = _create_user_from_registration(pending, challenge.contact_method)

    elif challenge.purpose == "profile" and challenge.user_id:
        user = User.query.get(challenge.user_id)
        if not user:
            db.session.commit()
            raise ValueError("User not found")
        if challenge.contact_method == "email":
            _finalize_user_contacts(user, "email", challenge.contact_value, primary=True)
        elif challenge.contact_method == "phone":
            _finalize_user_contacts(user, "phone", challenge.contact_value, primary=False)
    elif challenge.purpose == "password_reset" and challenge.user_id:
        user = User.query.get(challenge.user_id)
        if not user:
            db.session.commit()
            raise ValueError("User not found")

    db.session.commit()
    return challenge, user, pending


def create_pending_registration(data: dict) -> PendingRegistration:
    first_name = (data.get("first_name") or "").strip()
    last_name = (data.get("last_name") or "").strip()
    email = normalize_contact_value("email", data.get("email"))
    phone_number = normalize_contact_value("phone", data.get("phone_number"))
    handle = (data.get("handle") or "").strip()
    password_hash = data.get("password_hash") or ""
    school_id = data.get("school_id")
    preferred_method = _validate_contact_method(
        data.get("preferred_contact_method") or data.get("preferred_method") or data.get("contact_method") or "email"
    )

    if not first_name or not last_name:
        raise ValueError("first_name and last_name are required")
    if not email or not handle or not password_hash or not school_id:
        raise ValueError("Missing required fields")

    school = School.query.get(school_id)
    if not school:
        raise ValueError("Invalid school_id")

    if User.query.filter_by(email=email).first():
        raise ValueError("Email already exists")
    if User.query.filter_by(handle=handle).first():
        raise ValueError("Handle already taken")

    duplicate_filters = [
        PendingRegistration.email == email,
        PendingRegistration.handle == handle,
    ]
    if phone_number:
        duplicate_filters.append(PendingRegistration.phone_number == phone_number)

    if PendingRegistration.query.filter(
        PendingRegistration.status == "pending",
        db.or_(*duplicate_filters),
    ).first():
        raise ValueError("A verification is already pending for this email, handle, or phone number")

    existing_phone = normalize_contact_value("phone", phone_number) if phone_number else ""
    if existing_phone and UserContactMethod.query.filter_by(contact_method="phone", contact_value=existing_phone).first():
        raise ValueError("Phone number already exists")

    registration = PendingRegistration(
        first_name=first_name,
        last_name=last_name,
        email=email,
        phone_number=phone_number or None,
        handle=handle,
        password_hash=password_hash,
        school_id=school.school_id,
        preferred_method=preferred_method,
        status="pending",
        expires_at=_now() + _pending_registration_ttl(),
    )
    db.session.add(registration)
    db.session.commit()
    return registration


def ensure_registration_can_be_verified(registration: PendingRegistration) -> None:
    if not registration:
        raise ValueError("Pending registration not found")
    if registration.status != "pending":
        raise ValueError("Registration is no longer pending")
    if _registration_expired(registration):
        registration.status = "expired"
        db.session.commit()
        raise ValueError("Registration has expired")


def get_user_contact_summary(user: User) -> dict:
    methods = UserContactMethod.query.filter_by(user_id=user.user_id).all()
    verified_contacts = [
        {
            "contact_method": method.contact_method,
            "contact_value": mask_contact_value(method.contact_method, method.contact_value),
            "is_primary": bool(method.is_primary),
            "verified_at": method.verified_at.isoformat() if method.verified_at else None,
        }
        for method in methods
    ]

    email_verified = any(method.contact_method == "email" for method in methods)
    phone_verified = any(method.contact_method == "phone" for method in methods)

    return {
        "has_verified_contact": bool(verified_contacts),
        "email_verified": email_verified,
        "phone_verified": phone_verified,
        "verified_contacts": verified_contacts,
    }


def get_user_profile_completion(user: User) -> dict:
    contact_summary = get_user_contact_summary(user)
    chapter_count = UserChapterMembership.query.filter_by(user_id=user.user_id).count()
    chapter_follow_count = ChapterFollow.query.filter_by(user_id=user.user_id).count()
    school_follow_count = SchoolMembership.query.filter_by(user_id=user.user_id).count()
    steps = [
        {
            "key": "verify_contact",
            "label": "Verify email or phone",
            "completed": contact_summary["has_verified_contact"],
        },
        {
            "key": "profile_photo",
            "label": "Add a profile photo",
            "completed": bool(user.profile_picture_url),
        },
        {
            "key": "school",
            "label": "Set your school",
            "completed": bool(user.school_id or school_follow_count > 0),
        },
        {
            "key": "chapter_membership",
            "label": "Follow a chapter or join as a member",
            "completed": chapter_count > 0 or chapter_follow_count > 0,
        },
        {
            "key": "stripe",
            "label": "Connect Stripe for selling",
            "completed": bool(user.stripe_account_id),
        },
    ]
    completed = sum(1 for step in steps if step["completed"])
    total = len(steps)
    return {
        "completed_steps": completed,
        "total_steps": total,
        "completion_percent": round((completed / total) * 100) if total else 100,
        "steps": steps,
    }


def build_challenge_payload(challenge: ContactVerificationChallenge) -> dict:
    return {
        "verification_id": challenge.challenge_id,
        "purpose": challenge.purpose,
        "contact_method": challenge.contact_method,
        "contact_value": mask_contact_value(challenge.contact_method, challenge.contact_value),
        "status": challenge.status,
        "attempts_left": max(challenge.max_attempts - challenge.attempts, 0),
        "expires_at": challenge.expires_at.isoformat() if challenge.expires_at else None,
        "sent_at": challenge.sent_at.isoformat() if challenge.sent_at else None,
        "verified_at": challenge.verified_at.isoformat() if challenge.verified_at else None,
        "delivery_channel": challenge.delivery_channel,
    }


def build_pending_registration_payload(registration: PendingRegistration, challenge: ContactVerificationChallenge | None = None, delivery: dict | None = None) -> dict:
    payload = {
        "registration_id": registration.registration_id,
        "status": registration.status,
        "preferred_method": registration.preferred_method,
        "contact_value": mask_contact_value(
            registration.preferred_method,
            registration.email if registration.preferred_method == "email" else registration.phone_number,
        ),
        "expires_at": registration.expires_at.isoformat() if registration.expires_at else None,
    }
    if challenge:
        payload["verification"] = build_challenge_payload(challenge)
    if delivery and delivery.get("preview_code") and _environment() != "production":
        payload["preview_code"] = delivery["preview_code"]
    return payload


def resend_verification_code(challenge: ContactVerificationChallenge) -> dict:
    if challenge.status != "pending":
        raise ValueError("Verification session is no longer active")
    code = generate_verification_code()
    salt = secrets.token_urlsafe(16)
    challenge.code_salt = salt
    challenge.code_hash = hash_verification_code(code, salt)
    challenge.attempts = 0
    challenge.sent_at = _now()
    challenge.expires_at = _now() + _verification_ttl()
    delivery = send_verification_code(challenge.contact_method, challenge.contact_value, code, challenge.purpose)
    challenge.provider_message_id = delivery.get("provider_message_id")
    db.session.commit()
    if delivery.get("preview_code") and _environment() != "production":
        delivery["preview_code"] = code
    return delivery
