import time
from datetime import datetime, timedelta
from functools import wraps
from hashlib import sha256
from random import random

from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from .. import db
from ..models import RateLimitBucket
from ..utils import to_int


def _now() -> datetime:
    return datetime.utcnow()


def _client_ip() -> str:
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.headers.get("X-Real-IP") or request.remote_addr or "unknown"


def _safe_json() -> dict:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def _safe_identity() -> int | None:
    try:
        verify_jwt_in_request(optional=True)
    except Exception:
        return None
    return to_int(get_jwt_identity())


def key_by_ip() -> str:
    return f"ip:{_client_ip()}"


def key_by_user_or_ip() -> str:
    user_id = _safe_identity()
    if user_id:
        return f"user:{user_id}"
    return key_by_ip()


def key_by_ip_and_field(field_name: str) -> str:
    value = (_safe_json().get(field_name) or "").strip().lower()
    if not value:
        return key_by_ip()
    digest = sha256(value.encode("utf-8")).hexdigest()[:16]
    return f"{key_by_ip()}:field:{digest}"


def key_by_user_and_field(field_name: str) -> str:
    user_id = _safe_identity()
    prefix = f"user:{user_id}" if user_id else key_by_ip()
    value = (_safe_json().get(field_name) or "").strip().lower()
    if not value:
        return prefix
    digest = sha256(value.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}:field:{digest}"


def _cleanup_expired_buckets() -> None:
    cleanup_probability = float(current_app.config.get("RATE_LIMIT_CLEANUP_PROBABILITY") or 0.05)
    if random() > cleanup_probability:
        return
    RateLimitBucket.query.filter(RateLimitBucket.expires_at < _now()).delete(synchronize_session=False)
    db.session.commit()


def _consume_limit(scope: str, identifier: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    current_timestamp = int(time.time())
    window_start = current_timestamp - (current_timestamp % window_seconds)
    retry_after = max(window_seconds - (current_timestamp - window_start), 1)
    bucket_key = f"{scope}:{identifier}:{window_start}"
    bucket = RateLimitBucket.query.get(bucket_key)
    if bucket is None:
        bucket = RateLimitBucket(
            bucket_key=bucket_key,
            scope=scope,
            identifier=identifier,
            window_start=window_start,
            request_count=1,
            expires_at=_now() + timedelta(seconds=window_seconds * 2),
        )
        db.session.add(bucket)
        db.session.commit()
        _cleanup_expired_buckets()
        return True, retry_after

    if bucket.request_count >= limit:
        return False, retry_after

    bucket.request_count += 1
    bucket.updated_at = _now()
    db.session.commit()
    _cleanup_expired_buckets()
    return True, retry_after


def rate_limit(scope: str, limit: int, window_seconds: int, key_func=None):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not current_app.config.get("RATE_LIMIT_ENABLED", True):
                return fn(*args, **kwargs)

            identifier = (key_func() if callable(key_func) else None) or key_by_ip()
            allowed, retry_after = _consume_limit(scope, identifier, limit, window_seconds)
            if allowed:
                return fn(*args, **kwargs)

            response = jsonify(
                {
                    "error": "Too many requests. Please wait a moment and try again.",
                    "retry_after_seconds": retry_after,
                    "scope": scope,
                }
            )
            response.status_code = 429
            response.headers["Retry-After"] = str(retry_after)
            return response

        return wrapper

    return decorator
