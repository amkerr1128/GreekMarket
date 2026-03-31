from datetime import datetime

from flask import jsonify, request
from flask_jwt_extended import jwt_required

from .. import db
from ..models import Notification
from ..services.notifications import mark_notifications_read, serialize_notification, unread_notification_count
from . import bp
from .common import current_user_id


@bp.route("/notifications", methods=["GET"])
@jwt_required()
def list_notifications():
    me = current_user_id()
    mark_read = (request.args.get("mark_read") or "true").strip().lower() not in {"false", "0", "no"}

    if mark_read:
        mark_notifications_read(me)

        db.session.commit()

    notifications = (
        Notification.query.filter_by(recipient_id=me).order_by(Notification.created_at.desc()).limit(50).all()
    )
    unread_count = unread_notification_count(me)
    return jsonify(
        {
            "notifications": [serialize_notification(notification, viewer_user_id=me) for notification in notifications],
            "unread_count": unread_count,
        }
    ), 200


@bp.route("/notifications/unread-count", methods=["GET"])
@jwt_required()
def notification_unread_count():
    me = current_user_id()
    return jsonify({"unread_count": unread_notification_count(me)}), 200


@bp.route("/notifications/mark-read", methods=["POST"])
@jwt_required()
def mark_notifications_as_read():
    me = current_user_id()
    payload = request.get_json(silent=True) or {}
    notification_ids = payload.get("notification_ids")
    if notification_ids is not None and not isinstance(notification_ids, list):
        return jsonify({"error": "notification_ids must be a list"}), 400

    ids = []
    if notification_ids:
        for item in notification_ids:
            try:
                ids.append(int(item))
            except (TypeError, ValueError):
                continue

    count = mark_notifications_read(me, ids or None)

    db.session.commit()
    return jsonify({"message": "Notifications marked as read", "updated_count": count}), 200


@bp.route("/notifications/<int:notification_id>/read", methods=["POST"])
@jwt_required()
def mark_notification_as_read(notification_id):
    me = current_user_id()
    notification = Notification.query.filter_by(notification_id=notification_id, recipient_id=me).first()
    if not notification:
        return jsonify({"error": "Notification not found"}), 404
    if notification.read_at is None:
        notification.read_at = datetime.utcnow()
        db.session.commit()
    return jsonify({"message": "Notification marked as read", "notification": serialize_notification(notification, viewer_user_id=me)}), 200
