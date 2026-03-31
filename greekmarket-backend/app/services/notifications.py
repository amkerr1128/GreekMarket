from datetime import datetime

from .. import db
from ..models import Notification, User
from ..routes.common import serialize_user, user_following_state


def create_notification(
    *,
    recipient_id: int | None,
    event_type: str,
    title: str,
    body: str,
    action_url: str | None = None,
    actor_id: int | None = None,
    payload: dict | None = None,
    event_key: str | None = None,
) -> tuple[Notification | None, bool]:
    if not recipient_id:
        return None, False

    recipient = User.query.get(recipient_id)
    if not recipient:
        return None, False

    normalized_type = (event_type or "").strip()
    normalized_title = (title or "").strip()
    normalized_body = (body or "").strip()
    normalized_key = (event_key or "").strip() or None

    if not normalized_type or not normalized_title or not normalized_body:
        raise ValueError("Notification type, title, and body are required")

    if normalized_key is not None:
        existing = Notification.query.filter_by(
            recipient_id=recipient_id,
            event_type=normalized_type,
            event_key=normalized_key,
        ).first()
        if existing:
            return existing, False

    notification = Notification(
        recipient_id=recipient_id,
        actor_id=actor_id,
        event_type=normalized_type,
        event_key=normalized_key,
        title=normalized_title,
        body=normalized_body,
        action_url=(action_url or "").strip() or None,
        payload=payload or {},
    )
    db.session.add(notification)
    db.session.flush()
    return notification, True


def mark_notifications_read(recipient_id: int, notification_ids: list[int] | None = None) -> int:
    query = Notification.query.filter_by(recipient_id=recipient_id, read_at=None)
    if notification_ids:
        query = query.filter(Notification.notification_id.in_(notification_ids))

    count = 0
    for notification in query.all():
        notification.read_at = datetime.utcnow()
        count += 1
    return count


def unread_notification_count(recipient_id: int) -> int:
    return Notification.query.filter_by(recipient_id=recipient_id, read_at=None).count()


def serialize_notification(notification: Notification, viewer_user_id: int | None = None) -> dict:
    payload = dict(notification.payload or {})
    if notification.event_type == "user_follow" and notification.actor_id:
        payload.setdefault("follower_user_id", notification.actor_id)
        payload["viewer_is_following_actor"] = user_following_state(viewer_user_id, notification.actor_id)
    return {
        "notification_id": notification.notification_id,
        "recipient_id": notification.recipient_id,
        "actor_id": notification.actor_id,
        "event_type": notification.event_type,
        "event_key": notification.event_key,
        "title": notification.title,
        "body": notification.body,
        "action_url": notification.action_url,
        "payload": payload,
        "created_at": notification.created_at.isoformat() if notification.created_at else None,
        "read_at": notification.read_at.isoformat() if notification.read_at else None,
        "is_read": notification.read_at is not None,
        "actor": serialize_user(notification.actor, viewer_user_id=viewer_user_id, include_follow_metadata=True) if notification.actor else None,
    }
