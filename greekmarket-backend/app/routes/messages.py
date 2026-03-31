from flask import jsonify, request
from flask_jwt_extended import jwt_required

from .. import db
from ..models import Message, MessageReaction, MessageReply, MessageReport, ModerationReview, PinnedConversation, User
from ..services.rate_limit import key_by_user_or_ip, rate_limit
from ..utils import to_int
from ..services.notifications import create_notification
from . import bp
from .common import MAX_MESSAGE_LENGTH, MAX_REPORT_REASON_LENGTH, current_user_id, is_blocked, serialize_message, serialize_user


def _message_visible_to_user(message_id: int, user_id: int) -> Message | None:
    message = Message.query.get(message_id)
    if not message:
        return None
    if user_id not in {message.sender_id, message.recipient_id}:
        return None
    if is_blocked(message.sender_id, message.recipient_id):
        return None
    return message


@bp.route("/messages/send", methods=["POST"])
@jwt_required()
@rate_limit("messages_send", 90, 300, key_func=key_by_user_or_ip)
def send_message():
    sender_id = current_user_id()
    data = request.get_json() or {}

    recipient_id = to_int(data.get("recipient_id"))
    reply_to_message_id = to_int(data.get("reply_to_message_id"))
    text = (data.get("text") or "").strip()
    image_url = data.get("image_url")

    if not recipient_id or not text:
        return jsonify({"error": "Missing recipient_id or text"}), 400
    if sender_id == recipient_id:
        return jsonify({"error": "You cannot message your own account"}), 400
    if len(text) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": f"Messages must be {MAX_MESSAGE_LENGTH} characters or fewer"}), 400
    recipient = User.query.get(recipient_id)
    if not recipient:
        return jsonify({"error": "Recipient not found"}), 404
    if is_blocked(sender_id, recipient_id):
        return jsonify({"error": "Cannot message this user"}), 403

    reply_target = None
    if reply_to_message_id:
        reply_target = Message.query.get(reply_to_message_id)
        if not reply_target:
            return jsonify({"error": "The message you are replying to could not be found"}), 404
        participants = {reply_target.sender_id, reply_target.recipient_id}
        if participants != {sender_id, recipient_id}:
            return jsonify({"error": "You can only reply to messages in this conversation"}), 400

    msg = Message(sender_id=sender_id, recipient_id=recipient_id, text=text, image_url=image_url)
    db.session.add(msg)
    db.session.flush()
    if reply_target:
        db.session.add(MessageReply(message_id=msg.message_id, reply_to_message_id=reply_target.message_id))
    sender = User.query.get(sender_id)
    conversation_url = f"/messages/{sender_id}"
    create_notification(
        recipient_id=recipient_id,
        actor_id=sender_id,
        event_type="message_received",
        event_key=f"message:{msg.message_id}",
        title="New message",
        body=f"You received a new message from {sender.handle if sender else 'a user'}.",
        action_url=conversation_url,
        payload={
            "message_id": msg.message_id,
            "conversation_user_id": sender_id,
            "sender_handle": sender.handle if sender else None,
            "sender_name": serialize_user(sender)["display_name"] if sender else None,
        },
    )
    db.session.commit()
    db.session.refresh(msg)
    return jsonify(
        {
            "message": "Message sent!",
            "data": serialize_message(msg, sender_id),
        }
    ), 201


@bp.route("/messages/conversation/<int:user_id>", methods=["GET"])
@jwt_required()
def get_conversation(user_id):
    me = current_user_id()
    if is_blocked(me, user_id):
        return jsonify({"error": "You cannot view this conversation"}), 403

    messages = Message.query.filter(
        db.or_(
            db.and_(Message.sender_id == me, Message.recipient_id == user_id),
            db.and_(Message.sender_id == user_id, Message.recipient_id == me),
        )
    ).order_by(Message.sent_at.asc()).all()

    return jsonify([serialize_message(m, me) for m in messages])


@bp.route("/messages/<int:message_id>/react", methods=["POST"])
@jwt_required()
@rate_limit("messages_react", 120, 300, key_func=key_by_user_or_ip)
def react_to_message(message_id):
    me = current_user_id()
    message = _message_visible_to_user(message_id, me)
    if not message:
        return jsonify({"error": "Message not found"}), 404

    data = request.get_json(silent=True) or {}
    emoji = (data.get("emoji") or "").strip()
    if not emoji or len(emoji) > 16:
        return jsonify({"error": "A valid emoji is required"}), 400

    existing = MessageReaction.query.filter_by(message_id=message.message_id, user_id=me).first()
    if existing and existing.emoji == emoji:
        db.session.delete(existing)
        db.session.commit()
        action = "removed"
    else:
        if not existing:
            existing = MessageReaction(message_id=message.message_id, user_id=me, emoji=emoji)
            db.session.add(existing)
        else:
            existing.emoji = emoji
        db.session.commit()
        action = "saved"

    refreshed = Message.query.get(message.message_id)
    return jsonify(
        {
            "message": f"Reaction {action}.",
            "data": serialize_message(refreshed, me),
        }
    ), 200


@bp.route("/messages/<int:message_id>/report", methods=["POST"])
@jwt_required()
@rate_limit("messages_report", 20, 3600, key_func=key_by_user_or_ip)
def report_message(message_id):
    me = current_user_id()
    message = _message_visible_to_user(message_id, me)
    if not message:
        return jsonify({"error": "Message not found"}), 404

    if message.sender_id == me:
        return jsonify({"error": "You cannot report your own message"}), 400

    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip()
    details = (data.get("details") or "").strip() or None
    if not reason:
        return jsonify({"error": "A report reason is required"}), 400
    if len(reason) > MAX_REPORT_REASON_LENGTH:
        return jsonify({"error": "Report reason is too long"}), 400

    report = MessageReport(message_id=message.message_id, reporter_id=me, reason=reason, details=details)
    db.session.add(report)
    reporter = User.query.get(me)
    other_user_id = message.recipient_id if message.sender_id == me else message.sender_id
    other_user = User.query.get(other_user_id)
    create_notification(
        recipient_id=me,
        actor_id=other_user_id,
        event_type="message_report_submitted",
        event_key=f"message-report:{message.message_id}:{me}",
        title="Message report submitted",
        body="Thanks for reporting this message. Our moderation team will review it.",
        action_url="/dashboard",
        payload={
            "message_id": message.message_id,
            "reporter_handle": reporter.handle if reporter else None,
            "other_user_id": other_user_id,
            "other_user_handle": other_user.handle if other_user else None,
        },
    )
    db.session.commit()
    return jsonify({"message": "Message reported successfully."}), 201


@bp.route("/messages/inbox", methods=["GET"])
@jwt_required()
def inbox():
    me = current_user_id()

    pinned_users = {p.other_user_id for p in PinnedConversation.query.filter_by(user_id=me).all()}
    messages = Message.query.filter(
        db.or_(Message.sender_id == me, Message.recipient_id == me)
    ).order_by(Message.sent_at.desc()).all()

    conversations = {}
    for msg in messages:
        other = msg.recipient_id if msg.sender_id == me else msg.sender_id
        if is_blocked(me, other):
            continue

        key = tuple(sorted([me, other]))
        if key not in conversations:
            unread = Message.query.filter_by(sender_id=other, recipient_id=me, read=False).count()
            conversations[key] = {
                "user_id": other,
                "last_message": msg.text,
                "timestamp": msg.sent_at.isoformat(),
                "unread_count": unread,
                "pinned": other in pinned_users,
            }

    sorted_convos = sorted(
        conversations.values(),
        key=lambda c: (not c["pinned"], c["timestamp"]),
        reverse=True,
    )
    enriched = []
    for convo in sorted_convos:
        other = User.query.get(convo["user_id"])
        other_data = serialize_user(other) if other else None
        enriched.append(
            {
                **convo,
                "other_user": other_data,
                "other_user_handle": other_data["handle"] if other_data else None,
                "other_user_name": other_data["display_name"] if other_data else None,
                "other_user_avatar_url": other_data["avatar_url"] if other_data else None,
                "last_message_preview": convo["last_message"],
            }
        )
    return jsonify(enriched)


@bp.route("/messages/<int:with_user_id>/read", methods=["POST"])
@jwt_required()
def mark_messages_as_read(with_user_id):
    me = current_user_id()
    messages = Message.query.filter_by(sender_id=with_user_id, recipient_id=me, read=False).all()
    for m in messages:
        m.read = True
    db.session.commit()
    return jsonify({"message": "Messages marked as read"}), 200


@bp.route("/messages/delete/<int:message_id>", methods=["DELETE"])
@jwt_required()
def delete_message(message_id):
    me = current_user_id()
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"error": "Message not found"}), 404
    if message.sender_id != me:
        return jsonify({"error": "You can only delete your own messages"}), 403
    report_ids = [
        report_id
        for (report_id,) in db.session.query(MessageReport.report_id).filter_by(message_id=message.message_id).all()
    ]
    if report_ids:
        ModerationReview.query.filter(
            ModerationReview.report_type == "message",
            ModerationReview.report_id.in_(report_ids),
        ).delete(synchronize_session=False)
    MessageReaction.query.filter_by(message_id=message.message_id).delete(synchronize_session=False)
    MessageReport.query.filter_by(message_id=message.message_id).delete(synchronize_session=False)
    MessageReply.query.filter_by(message_id=message.message_id).delete(synchronize_session=False)
    MessageReply.query.filter_by(reply_to_message_id=message.message_id).delete(synchronize_session=False)
    db.session.delete(message)
    db.session.commit()
    return jsonify({"message": "Message deleted"}), 200


@bp.route("/messages/<int:message_id>/edit", methods=["PUT"])
@jwt_required()
@rate_limit("messages_edit", 60, 300, key_func=key_by_user_or_ip)
def edit_message(message_id):
    me = current_user_id()
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"error": "Message not found"}), 404
    if message.sender_id != me:
        return jsonify({"error": "You can only edit your own messages"}), 403

    data = request.get_json() or {}
    new_text = (data.get("text") or "").strip()
    if not new_text:
        return jsonify({"error": "New message text required"}), 400
    if len(new_text) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": f"Messages must be {MAX_MESSAGE_LENGTH} characters or fewer"}), 400

    message.text = new_text
    db.session.commit()
    return jsonify({"message": "Message updated"}), 200


@bp.route("/messages/unread-count", methods=["GET"])
@jwt_required()
def unread_message_count():
    me = current_user_id()
    count = Message.query.filter_by(recipient_id=me, read=False).count()
    return jsonify({"unread_count": count}), 200


@bp.route("/messages/inbox/search", methods=["GET"])
@jwt_required()
def search_inbox():
    me = current_user_id()
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return jsonify({"error": "Missing search query"}), 400

    messages = Message.query.filter(
        db.or_(Message.sender_id == me, Message.recipient_id == me)
    ).order_by(Message.sent_at.desc()).all()

    results, seen = [], set()
    for msg in messages:
        other = msg.recipient_id if msg.sender_id == me else msg.sender_id
        key = tuple(sorted([me, other]))
        if key in seen:
            continue

        other_user = User.query.get(other)
        if not other_user:
            continue
        match = (
            (q in (msg.text or "").lower())
            or (q in (other_user.first_name or "").lower())
            or (q in (other_user.last_name or "").lower())
            or (q in (other_user.handle or "").lower())
        )
        if match:
            seen.add(key)
            other_data = serialize_user(other_user) if other_user else None
            results.append(
                {
                    "user_id": other,
                    "handle": other_user.handle,
                    "display_name": other_data["display_name"] if other_data else None,
                    "avatar_url": other_data["avatar_url"] if other_data else None,
                    "user": other_data,
                    "last_message": msg.text,
                    "timestamp": msg.sent_at.isoformat(),
                    "unread": (not msg.read and msg.recipient_id == me),
                }
            )
    return jsonify(results)


@bp.route("/messages/pin/<int:other_user_id>", methods=["POST"])
@jwt_required()
def pin_conversation(other_user_id):
    me = current_user_id()
    if me == other_user_id:
        return jsonify({"error": "Cannot pin conversation with yourself"}), 400

    existing_count = PinnedConversation.query.filter_by(user_id=me).count()
    if existing_count >= 3:
        return jsonify({"error": "You can only pin up to 3 conversations"}), 403

    if PinnedConversation.query.filter_by(user_id=me, other_user_id=other_user_id).first():
        return jsonify({"message": "Already pinned"}), 200

    db.session.add(PinnedConversation(user_id=me, other_user_id=other_user_id))
    db.session.commit()
    return jsonify({"message": "Conversation pinned"}), 201


@bp.route("/messages/unpin/<int:other_user_id>", methods=["DELETE"])
@jwt_required()
def unpin_conversation(other_user_id):
    me = current_user_id()
    pin = PinnedConversation.query.filter_by(user_id=me, other_user_id=other_user_id).first()
    if not pin:
        return jsonify({"error": "Pin not found"}), 404
    db.session.delete(pin)
    db.session.commit()
    return jsonify({"message": "Conversation unpinned"}), 200
