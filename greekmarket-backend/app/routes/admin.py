from datetime import datetime

from flask import jsonify, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_

from .. import db
from ..models import (
    Chapter,
    ChapterFollow,
    ChapterJoinRequest,
    Message,
    MessageReaction,
    MessageReply,
    MessageReport,
    ModerationReview,
    Post,
    PostReport,
    Purchase,
    SiteAdmin,
    SupportTicket,
    User,
    UserChapterMembership,
    UserReport,
)
from ..services.accounts import delete_user_account
from ..services.notifications import create_notification
from ..services.rate_limit import key_by_user_or_ip, rate_limit
from ..utils import to_int
from . import bp
from .common import (
    MAX_REPORT_REASON_LENGTH,
    MAX_SUPPORT_MESSAGE_LENGTH,
    MAX_SUPPORT_NOTE_LENGTH,
    MAX_SUPPORT_SUBJECT_LENGTH,
    configured_owner_emails,
    configured_site_admin_emails,
    current_user_id,
    is_owner_email,
    is_site_admin_user,
    serialize_chapter_search_result,
    serialize_message,
    serialize_post_summary_with_viewer,
    serialize_user,
)

VALID_REPORT_STATUSES = {"open", "in_progress", "resolved", "dismissed"}
ACTIVE_REPORT_STATUSES = {"open", "in_progress"}
VALID_SUPPORT_STATUSES = {"open", "in_progress", "resolved"}
VALID_SUPPORT_PRIORITIES = {"low", "normal", "high", "urgent"}
VALID_CHAPTER_ROLES = {"member", "admin"}
VALID_REQUEST_DECISIONS = {"approved", "rejected"}
VALID_REPORT_ACTIONS = {
    "no_action",
    "warn_user",
    "delete_message",
    "delete_post",
    "delete_account",
    "hide_post",
    "suspend_user",
    "ban_user",
}


def _current_admin_user():
    user = User.query.get(current_user_id())
    if not user:
        return None, (jsonify({"error": "User not found"}), 404)
    if not is_site_admin_user(user):
        return None, (jsonify({"error": "Only site admins can access this workspace"}), 403)
    return user, None


def _current_owner_user():
    user, error = _current_admin_user()
    if error:
        return None, error
    if not is_owner_email(user.email):
        return None, (jsonify({"error": "Only the application owner can manage site admins"}), 403)
    return user, None


def _serialize_support_ticket(ticket: SupportTicket) -> dict:
    return {
        "ticket_id": ticket.ticket_id,
        "email": ticket.email,
        "subject": ticket.subject,
        "category": ticket.category,
        "message": ticket.message,
        "status": ticket.status,
        "priority": ticket.priority,
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
        "resolved_at": ticket.resolved_at.isoformat() if ticket.resolved_at else None,
        "resolution_note": ticket.resolution_note,
        "user": serialize_user(ticket.submitter, include_private_fields=True) if ticket.submitter else None,
        "assignee": serialize_user(ticket.assignee, include_private_fields=True) if ticket.assignee else None,
    }


def _serialize_admin_user(user: User | None) -> dict | None:
    if not user:
        return None
    return serialize_user(user, include_private_fields=True)


def _serialize_review(review: ModerationReview | None) -> dict:
    if not review:
        return {
            "status": "open",
            "action_taken": None,
            "note": None,
            "reviewed_at": None,
            "reviewed_by": None,
        }
    return {
        "status": review.status,
        "action_taken": review.action_taken,
        "note": review.note,
        "reviewed_at": review.reviewed_at.isoformat() if review.reviewed_at else None,
            "reviewed_by": _serialize_admin_user(review.reviewer),
    }


def _review_map(report_type: str) -> dict[int, ModerationReview]:
    return {
        review.report_id: review
        for review in ModerationReview.query.filter_by(report_type=report_type).all()
    }


def _serialize_post_report(report: PostReport, review: ModerationReview | None) -> dict:
    return {
        "report_type": "post",
        "report_id": report.report_id,
        "reason": report.reason,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "reporter": _serialize_admin_user(report.reporter),
        "post": serialize_post_summary_with_viewer(report.post) if report.post else None,
        "review": _serialize_review(review),
    }


def _serialize_user_report(report: UserReport, review: ModerationReview | None) -> dict:
    return {
        "report_type": "user",
        "report_id": report.report_id,
        "reason": report.reason,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "reporter": _serialize_admin_user(report.reporter),
        "reported_user": _serialize_admin_user(report.reported_user),
        "review": _serialize_review(review),
    }


def _serialize_message_report(report: MessageReport, review: ModerationReview | None) -> dict:
    return {
        "report_type": "message",
        "report_id": report.report_id,
        "reason": report.reason,
        "details": report.details,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "reporter": _serialize_admin_user(report.reporter),
        "message": serialize_message(report.message) if report.message else None,
        "review": _serialize_review(review),
    }


def _chapter_member_payload(membership: UserChapterMembership) -> dict | None:
    member = User.query.get(membership.user_id)
    if not member:
        return None
    payload = _serialize_admin_user(member)
    payload["role"] = membership.role
    payload["chapter_id"] = membership.chapter_id
    return payload


def _serialize_chapter_request(join_request: ChapterJoinRequest) -> dict:
    return {
        "request_id": join_request.id,
        "chapter_id": join_request.chapter_id,
        "chapter": serialize_chapter_search_result(join_request.chapter) if join_request.chapter else None,
        "requested_role": join_request.requested_role,
        "note": join_request.note,
        "status": join_request.status,
        "created_at": join_request.created_at.isoformat() if join_request.created_at else None,
        "decided_at": join_request.decided_at.isoformat() if join_request.decided_at else None,
        "requester": _serialize_admin_user(join_request.requester),
        "reviewer": _serialize_admin_user(join_request.reviewer),
    }


@bp.route("/support/tickets", methods=["POST"])
@jwt_required(optional=True)
@rate_limit("support_create", 10, 3600, key_func=key_by_user_or_ip)
def create_support_ticket():
    user_id = current_user_id()
    user = User.query.get(user_id) if user_id else None
    payload = request.get_json(silent=True) or {}
    subject = (payload.get("subject") or "").strip()
    message = (payload.get("message") or "").strip()
    category = (payload.get("category") or "general").strip().lower()
    priority = (payload.get("priority") or "normal").strip().lower()
    email = (payload.get("email") or (user.email if user else "")).strip().lower()

    if not subject:
        return jsonify({"error": "Subject is required"}), 400
    if len(subject) > MAX_SUPPORT_SUBJECT_LENGTH:
        return jsonify({"error": "Subject is too long"}), 400
    if not message:
        return jsonify({"error": "Message is required"}), 400
    if len(message) > MAX_SUPPORT_MESSAGE_LENGTH:
        return jsonify({"error": "Message is too long"}), 400
    if not email:
        return jsonify({"error": "Email is required"}), 400
    if priority not in VALID_SUPPORT_PRIORITIES:
        priority = "normal"

    ticket = SupportTicket(
        user_id=user.user_id if user else None,
        email=email,
        subject=subject,
        category=category or "general",
        message=message,
        priority=priority,
    )
    db.session.add(ticket)
    db.session.flush()
    if user:
        create_notification(
            recipient_id=user.user_id,
            actor_id=user.user_id,
            event_type="support_ticket_submitted",
            event_key=f"support-ticket:{ticket.ticket_id}:submitted",
            title="Support request submitted",
            body="We received your support request and added it to the queue.",
            action_url="/dashboard",
            payload={
                "ticket_id": ticket.ticket_id,
                "subject": subject,
                "category": category,
            },
        )
    db.session.commit()
    return jsonify({"message": "Support request submitted.", "ticket": _serialize_support_ticket(ticket)}), 201


@bp.route("/users/<int:user_id>/report", methods=["POST"])
@jwt_required()
@rate_limit("users_report", 20, 3600, key_func=key_by_user_or_ip)
def report_user(user_id):
    me = current_user_id()
    if me == user_id:
        return jsonify({"error": "You cannot report your own account"}), 400

    reported_user = User.query.get(user_id)
    if not reported_user:
        return jsonify({"error": "User not found"}), 404

    payload = request.get_json(silent=True) or {}
    reason = (payload.get("reason") or "").strip()
    if not reason:
        return jsonify({"error": "Report reason is required"}), 400
    if len(reason) > MAX_REPORT_REASON_LENGTH:
        return jsonify({"error": "Report reason is too long"}), 400

    report = UserReport(user_id=me, reported_user_id=user_id, reason=reason)
    db.session.add(report)
    db.session.flush()
    reporter = User.query.get(me)
    create_notification(
        recipient_id=me,
        actor_id=me,
        event_type="user_report_submitted",
        event_key=f"user-report:{report.report_id}",
        title="User report submitted",
        body="Thanks for reporting this account. Our moderation team will review it.",
        action_url="/dashboard",
        payload={
            "report_id": report.report_id,
            "reported_user_id": user_id,
            "reporter_handle": reporter.handle if reporter else None,
        },
    )
    db.session.commit()
    return jsonify({"message": "User reported successfully"}), 201


@bp.route("/admin/workspace", methods=["GET"])
@jwt_required()
def admin_workspace_summary():
    admin_user, error = _current_admin_user()
    if error:
        return error

    post_reviews = _review_map("post")
    user_reviews = _review_map("user")
    message_reviews = _review_map("message")
    post_reports = PostReport.query.order_by(PostReport.created_at.desc()).all()
    user_reports = UserReport.query.order_by(UserReport.created_at.desc()).all()
    message_reports = MessageReport.query.order_by(MessageReport.created_at.desc()).all()
    support_tickets = SupportTicket.query.order_by(SupportTicket.created_at.desc()).all()
    open_post_reports = sum(
        1
        for report in post_reports
        if post_reviews.get(report.report_id, None) is None
        or post_reviews[report.report_id].status in ACTIVE_REPORT_STATUSES
    )
    open_user_reports = sum(
        1
        for report in user_reports
        if user_reviews.get(report.report_id, None) is None
        or user_reviews[report.report_id].status in ACTIVE_REPORT_STATUSES
    )
    open_message_reports = sum(
        1
        for report in message_reports
        if message_reviews.get(report.report_id, None) is None
        or message_reviews[report.report_id].status in ACTIVE_REPORT_STATUSES
    )
    open_tickets = sum(1 for ticket in support_tickets if ticket.status != "resolved")
    pending_chapter_requests = ChapterJoinRequest.query.filter_by(status="pending").count()
    configured_admin_emails = configured_owner_emails() | configured_site_admin_emails()
    site_admin_ids = {assignment.user_id for assignment in SiteAdmin.query.all()}
    if configured_admin_emails:
        site_admin_ids.update(
            user.user_id for user in User.query.filter(User.email.in_(list(configured_admin_emails))).all()
        )

    return jsonify(
        {
            "admin": _serialize_admin_user(admin_user),
            "overview": {
                "open_support_tickets": open_tickets,
                "open_post_reports": open_post_reports,
                "open_user_reports": open_user_reports,
                "open_message_reports": open_message_reports,
                "pending_chapter_requests": pending_chapter_requests,
                "total_users": User.query.count(),
                "total_posts": Post.query.count(),
                "total_chapters": Chapter.query.count(),
                "site_admins": len(site_admin_ids),
            },
        }
    ), 200


@bp.route("/admin/chapter-requests", methods=["GET"])
@jwt_required()
def get_admin_chapter_requests():
    _, error = _current_admin_user()
    if error:
        return error

    status_filter = (request.args.get("status") or "").strip().lower()
    requests_query = ChapterJoinRequest.query.order_by(ChapterJoinRequest.created_at.desc()).all()
    if status_filter:
        requests_query = [item for item in requests_query if item.status == status_filter]
    return jsonify([_serialize_chapter_request(item) for item in requests_query]), 200


@bp.route("/admin/chapter-requests/<int:request_id>", methods=["PATCH"])
@jwt_required()
@rate_limit("admin_chapter_request_review", 60, 3600, key_func=key_by_user_or_ip)
def review_admin_chapter_request(request_id):
    admin_user, error = _current_admin_user()
    if error:
        return error

    join_request = ChapterJoinRequest.query.get(request_id)
    if not join_request:
        return jsonify({"error": "Request not found"}), 404
    if join_request.status != "pending":
        return jsonify({"error": "This request has already been decided"}), 400

    payload = request.get_json(silent=True) or {}
    decision = (payload.get("status") or "").strip().lower()
    if decision not in VALID_REQUEST_DECISIONS:
        return jsonify({"error": "Status must be approved or rejected"}), 400

    membership = UserChapterMembership.query.filter_by(
        chapter_id=join_request.chapter_id,
        user_id=join_request.user_id,
    ).first()

    if decision == "approved":
        if join_request.requested_role == "member":
            if not membership:
                membership = UserChapterMembership(
                    chapter_id=join_request.chapter_id,
                    user_id=join_request.user_id,
                    role="member",
                )
                db.session.add(membership)
        elif join_request.requested_role == "admin":
            if not membership:
                return jsonify({"error": "The requester must already be a chapter member before becoming admin"}), 400
            membership.role = "admin"
        if not ChapterFollow.query.filter_by(user_id=join_request.user_id, chapter_id=join_request.chapter_id).first():
            db.session.add(ChapterFollow(user_id=join_request.user_id, chapter_id=join_request.chapter_id))

    join_request.status = decision
    join_request.reviewed_by = admin_user.user_id
    join_request.decided_at = datetime.utcnow()
    chapter = join_request.chapter
    create_notification(
        recipient_id=join_request.user_id,
        actor_id=admin_user.user_id,
        event_type="chapter_request_decision",
        event_key=f"chapter-request:{join_request.id}:{decision}",
        title=f"Chapter request {decision}",
        body=(
            f"Your request to join {chapter.name if chapter else 'the chapter'} was approved."
            if decision == "approved" and join_request.requested_role == "member"
            else (
                f"Your request to join {chapter.name if chapter else 'the chapter'} was rejected."
                if join_request.requested_role == "member"
                else (
                    f"Your request for chapter admin access to {chapter.name if chapter else 'the chapter'} was approved."
                    if decision == "approved"
                    else f"Your request for chapter admin access to {chapter.name if chapter else 'the chapter'} was rejected."
                )
            )
        ),
        action_url=f"/chapter/{join_request.chapter_id}",
        payload={
            "request_id": join_request.id,
            "chapter_id": join_request.chapter_id,
            "requested_role": join_request.requested_role,
            "status": decision,
        },
    )
    db.session.commit()
    return jsonify({"message": "Chapter request updated.", "request": _serialize_chapter_request(join_request)}), 200


@bp.route("/admin/reports", methods=["GET"])
@jwt_required()
def get_admin_reports():
    _, error = _current_admin_user()
    if error:
        return error

    status_filter = (request.args.get("status") or "").strip().lower()
    post_reviews = _review_map("post")
    user_reviews = _review_map("user")
    message_reviews = _review_map("message")
    results = []

    for report in PostReport.query.order_by(PostReport.created_at.desc()).all():
        payload = _serialize_post_report(report, post_reviews.get(report.report_id))
        review_status = (payload["review"]["status"] or "open").strip().lower()
        if status_filter:
            if review_status != status_filter:
                continue
        elif review_status not in ACTIVE_REPORT_STATUSES:
            continue
        results.append(payload)

    for report in UserReport.query.order_by(UserReport.created_at.desc()).all():
        payload = _serialize_user_report(report, user_reviews.get(report.report_id))
        review_status = (payload["review"]["status"] or "open").strip().lower()
        if status_filter:
            if review_status != status_filter:
                continue
        elif review_status not in ACTIVE_REPORT_STATUSES:
            continue
        results.append(payload)

    for report in MessageReport.query.order_by(MessageReport.created_at.desc()).all():
        payload = _serialize_message_report(report, message_reviews.get(report.report_id))
        review_status = (payload["review"]["status"] or "open").strip().lower()
        if status_filter:
            if review_status != status_filter:
                continue
        elif review_status not in ACTIVE_REPORT_STATUSES:
            continue
        results.append(payload)

    results.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return jsonify(results), 200


@bp.route("/admin/reports/<string:report_type>/<int:report_id>", methods=["PATCH"])
@jwt_required()
@rate_limit("admin_report_review", 120, 3600, key_func=key_by_user_or_ip)
def update_report_review(report_type, report_id):
    admin_user, error = _current_admin_user()
    if error:
        return error

    normalized_type = (report_type or "").strip().lower()
    if normalized_type not in {"post", "user", "message"}:
        return jsonify({"error": "Unsupported report type"}), 400

    if normalized_type == "post":
        report = PostReport.query.get(report_id)
    elif normalized_type == "message":
        report = MessageReport.query.get(report_id)
    else:
        report = UserReport.query.get(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404

    payload = request.get_json(silent=True) or {}
    status = (payload.get("status") or "in_progress").strip().lower()
    action_taken = (payload.get("action_taken") or "").strip() or None
    note = (payload.get("note") or "").strip() or None

    if status not in VALID_REPORT_STATUSES:
        return jsonify({"error": "Invalid report status"}), 400
    if action_taken and action_taken not in VALID_REPORT_ACTIONS:
        return jsonify({"error": "Invalid report action"}), 400

    review = ModerationReview.query.filter_by(report_type=normalized_type, report_id=report_id).first()
    previous_status = review.status if review else None
    if not review:
        review = ModerationReview(report_type=normalized_type, report_id=report_id)
        db.session.add(review)

    if not action_taken and status == "dismissed":
        action_taken = "no_action"

    review.status = status
    review.action_taken = action_taken
    review.note = note
    review.reviewed_by = admin_user.user_id
    review.reviewed_at = datetime.utcnow()

    if previous_status != status:
        reporter = None
        action_url = "/dashboard"
        title = "Report updated"
        body = f"Your {normalized_type} report is now {status}."
        payload_data = {"report_type": normalized_type, "report_id": report_id, "status": status}
        if normalized_type == "post" and report.post:
            action_url = f"/post/{report.post.post_id}"
            body = f"Your report for '{report.post.title}' is now {status}."
        elif normalized_type == "user" and report.reported_user:
            action_url = f"/user/{report.reported_user.user_id}"
            body = f"Your report for @{report.reported_user.handle} is now {status}."
        elif normalized_type == "message" and report.message:
            other_user_id = report.message.recipient_id if report.message.sender_id == report.reporter_id else report.message.sender_id
            action_url = f"/messages/{other_user_id}"
            body = f"Your message report is now {status}."
        reporter = report.reporter
        if reporter:
            create_notification(
                recipient_id=reporter.user_id,
                actor_id=admin_user.user_id,
                event_type="report_review_status",
                event_key=f"report:{normalized_type}:{report_id}:{status}",
                title=title,
                body=body,
                action_url=action_url,
                payload=payload_data,
            )

    db.session.commit()

    if normalized_type == "post":
        payload = _serialize_post_report(report, review)
    elif normalized_type == "message":
        payload = _serialize_message_report(report, review)
    else:
        payload = _serialize_user_report(report, review)
    return jsonify({"message": "Report review updated.", "report": payload}), 200


@bp.route("/admin/support-tickets", methods=["GET"])
@jwt_required()
def get_support_tickets():
    _, error = _current_admin_user()
    if error:
        return error

    status_filter = (request.args.get("status") or "").strip().lower()
    tickets = SupportTicket.query.order_by(SupportTicket.created_at.desc()).all()
    if status_filter:
        tickets = [ticket for ticket in tickets if ticket.status == status_filter]
    return jsonify([_serialize_support_ticket(ticket) for ticket in tickets]), 200


@bp.route("/admin/support-tickets/<int:ticket_id>", methods=["PATCH"])
@jwt_required()
@rate_limit("admin_support_update", 120, 3600, key_func=key_by_user_or_ip)
def update_support_ticket(ticket_id):
    admin_user, error = _current_admin_user()
    if error:
        return error

    ticket = SupportTicket.query.get(ticket_id)
    if not ticket:
        return jsonify({"error": "Support ticket not found"}), 404

    payload = request.get_json(silent=True) or {}
    status = (payload.get("status") or ticket.status or "open").strip().lower()
    priority = (payload.get("priority") or ticket.priority or "normal").strip().lower()
    resolution_note = (payload.get("resolution_note") or "").strip() or ticket.resolution_note
    assign_to_me = bool(payload.get("assign_to_me"))
    assigned_to = to_int(payload.get("assigned_to"))
    previous_status = ticket.status

    if status not in VALID_SUPPORT_STATUSES:
        return jsonify({"error": "Invalid support ticket status"}), 400
    if priority not in VALID_SUPPORT_PRIORITIES:
        return jsonify({"error": "Invalid support ticket priority"}), 400
    if resolution_note and len(resolution_note) > MAX_SUPPORT_NOTE_LENGTH:
        return jsonify({"error": "Resolution note is too long"}), 400

    ticket.status = status
    ticket.priority = priority
    ticket.resolution_note = resolution_note
    if assign_to_me:
        ticket.assigned_to = admin_user.user_id
    elif assigned_to is not None:
        assignee = User.query.get(assigned_to)
        if not assignee or not is_site_admin_user(assignee):
            return jsonify({"error": "Assigned user must be a site admin"}), 400
        ticket.assigned_to = assignee.user_id

    ticket.resolved_at = datetime.utcnow() if status == "resolved" else None
    db.session.commit()

    if ticket.submitter and previous_status != status:
        create_notification(
            recipient_id=ticket.submitter.user_id,
            actor_id=admin_user.user_id,
            event_type="support_ticket_status",
            event_key=f"support-ticket:{ticket.ticket_id}:{status}",
            title="Support ticket updated",
            body=f"Your support ticket '{ticket.subject}' is now {status}.",
            action_url="/dashboard",
            payload={
                "ticket_id": ticket.ticket_id,
                "status": status,
                "priority": priority,
                "category": ticket.category,
            },
        )
    return jsonify({"message": "Support ticket updated.", "ticket": _serialize_support_ticket(ticket)}), 200


@bp.route("/admin/users/search", methods=["GET"])
@jwt_required()
@rate_limit("admin_user_search", 180, 60, key_func=key_by_user_or_ip)
def admin_user_search():
    _, error = _current_admin_user()
    if error:
        return error

    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify([]), 200

    like = f"%{query}%"
    users = (
        User.query.filter(
            or_(
                User.email.ilike(like),
                User.handle.ilike(like),
                User.first_name.ilike(like),
                User.last_name.ilike(like),
            )
        )
        .order_by(User.created_at.desc())
        .limit(20)
        .all()
    )
    return jsonify([_serialize_admin_user(user) for user in users]), 200


@bp.route("/admin/site-admins", methods=["GET"])
@jwt_required()
def list_site_admins():
    _, error = _current_owner_user()
    if error:
        return error

    users_by_id: dict[int, dict] = {}

    configured_emails = configured_owner_emails() | configured_site_admin_emails()
    if configured_emails:
        for user in User.query.filter(User.email.in_(list(configured_emails))).all():
            users_by_id[user.user_id] = {
                **_serialize_admin_user(user),
                "granted_by": None,
                "source": "config" if not is_owner_email(user.email) else "owner",
            }

    for assignment in SiteAdmin.query.order_by(SiteAdmin.created_at.desc()).all():
        if not assignment.user:
            continue
        users_by_id[assignment.user.user_id] = {
            **_serialize_admin_user(assignment.user),
            "granted_by": _serialize_admin_user(assignment.granted_by_user),
            "source": "database" if not is_owner_email(assignment.user.email) else "owner",
        }

    return jsonify(list(users_by_id.values())), 200


@bp.route("/admin/site-admins", methods=["POST"])
@jwt_required()
@rate_limit("admin_site_admin_grant", 30, 3600, key_func=key_by_user_or_ip)
def add_site_admin():
    owner_user, error = _current_owner_user()
    if error:
        return error

    payload = request.get_json(silent=True) or {}
    user_id = to_int(payload.get("user_id"))
    email = (payload.get("email") or "").strip().lower()

    target = User.query.get(user_id) if user_id else None
    if not target and email:
        target = User.query.filter_by(email=email).first()
    if not target:
        return jsonify({"error": "User not found"}), 404

    if is_owner_email(target.email):
        return jsonify({"message": "This user is already an owner-level admin.", "user": _serialize_admin_user(target)}), 200

    existing = SiteAdmin.query.filter_by(user_id=target.user_id).first()
    if not existing:
        existing = SiteAdmin(user_id=target.user_id, granted_by=owner_user.user_id)
        db.session.add(existing)
        db.session.commit()

    return jsonify({"message": "Site admin granted.", "user": _serialize_admin_user(target)}), 201


@bp.route("/admin/site-admins/<int:user_id>", methods=["DELETE"])
@jwt_required()
@rate_limit("admin_site_admin_remove", 30, 3600, key_func=key_by_user_or_ip)
def remove_site_admin(user_id):
    _, error = _current_owner_user()
    if error:
        return error

    target = User.query.get(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    if is_owner_email(target.email):
        return jsonify({"error": "Owner-level admins cannot be removed here"}), 400

    assignment = SiteAdmin.query.filter_by(user_id=user_id).first()
    if not assignment:
        return jsonify({"error": "That user is not a site admin"}), 404

    db.session.delete(assignment)
    db.session.commit()
    return jsonify({"message": "Site admin removed.", "user_id": user_id}), 200


@bp.route("/admin/chapters", methods=["GET"])
@jwt_required()
def admin_chapter_directory():
    _, error = _current_admin_user()
    if error:
        return error

    memberships = UserChapterMembership.query.order_by(UserChapterMembership.chapter_id.asc()).all()
    memberships_by_chapter: dict[int, list[UserChapterMembership]] = {}
    for membership in memberships:
        memberships_by_chapter.setdefault(membership.chapter_id, []).append(membership)

    results = []
    for chapter in Chapter.query.order_by(Chapter.name.asc()).all():
        members = [
            payload
            for payload in (
                _chapter_member_payload(membership)
                for membership in memberships_by_chapter.get(chapter.chapter_id, [])
            )
            if payload
        ]
        results.append(
            {
                "chapter": serialize_chapter_search_result(chapter),
                "member_count": len(members),
                "members": members,
            }
        )

    return jsonify(results), 200


@bp.route("/admin/chapters/<int:chapter_id>/members/<int:user_id>", methods=["PATCH"])
@jwt_required()
@rate_limit("admin_chapter_member_update", 60, 3600, key_func=key_by_user_or_ip)
def update_chapter_member_role(chapter_id, user_id):
    _, error = _current_admin_user()
    if error:
        return error

    membership = UserChapterMembership.query.filter_by(chapter_id=chapter_id, user_id=user_id).first()
    if not membership:
        return jsonify({"error": "Chapter membership not found"}), 404

    payload = request.get_json(silent=True) or {}
    role = (payload.get("role") or "").strip().lower()
    if role not in VALID_CHAPTER_ROLES:
        return jsonify({"error": "Role must be either member or admin"}), 400

    if membership.role == "admin" and role != "admin":
        admin_count = UserChapterMembership.query.filter_by(chapter_id=chapter_id, role="admin").count()
        if admin_count <= 1:
            return jsonify({"error": "Each chapter must keep at least one admin"}), 400

    membership.role = role
    db.session.commit()
    member = _chapter_member_payload(membership)
    return jsonify({"message": "Chapter role updated.", "member": member}), 200


@bp.route("/admin/chapters/<int:chapter_id>/members/<int:user_id>", methods=["DELETE"])
@jwt_required()
@rate_limit("admin_chapter_member_remove", 60, 3600, key_func=key_by_user_or_ip)
def remove_chapter_member(chapter_id, user_id):
    _, error = _current_admin_user()
    if error:
        return error

    membership = UserChapterMembership.query.filter_by(chapter_id=chapter_id, user_id=user_id).first()
    if not membership:
        return jsonify({"error": "Chapter membership not found"}), 404

    if membership.role == "admin":
        admin_count = UserChapterMembership.query.filter_by(chapter_id=chapter_id, role="admin").count()
        if admin_count <= 1:
            return jsonify({"error": "Each chapter must keep at least one admin"}), 400

    db.session.delete(membership)
    db.session.commit()
    return jsonify({"message": "Member removed from chapter.", "user_id": user_id, "chapter_id": chapter_id}), 200


@bp.route("/admin/posts/<int:post_id>", methods=["DELETE"])
@jwt_required()
@rate_limit("admin_post_delete", 60, 3600, key_func=key_by_user_or_ip)
def admin_delete_post(post_id):
    _, error = _current_admin_user()
    if error:
        return error

    post = Post.query.get(post_id)
    if not post:
        return jsonify({"error": "Post not found"}), 404

    post.visibility = "hidden"
    post.is_sold = True
    db.session.commit()
    return jsonify({"message": "Post hidden by admin.", "post_id": post_id, "visibility": post.visibility}), 200


@bp.route("/admin/messages/<int:message_id>", methods=["DELETE"])
@jwt_required()
@rate_limit("admin_message_delete", 60, 3600, key_func=key_by_user_or_ip)
def admin_delete_message(message_id):
    _, error = _current_admin_user()
    if error:
        return error

    message = Message.query.get(message_id)
    if not message:
        return jsonify({"error": "Message not found"}), 404

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
    MessageReply.query.filter_by(message_id=message.message_id).delete(synchronize_session=False)
    MessageReply.query.filter_by(reply_to_message_id=message.message_id).delete(synchronize_session=False)
    MessageReport.query.filter_by(message_id=message.message_id).delete(synchronize_session=False)
    db.session.delete(message)
    db.session.commit()
    return jsonify({"message": "Message removed by admin.", "message_id": message_id}), 200


@bp.route("/admin/users/<int:user_id>", methods=["DELETE"])
@jwt_required()
@rate_limit("admin_user_delete", 30, 3600, key_func=key_by_user_or_ip)
def admin_delete_user(user_id):
    _, error = _current_admin_user()
    if error:
        return error

    target = User.query.get(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404
    if is_owner_email(target.email):
        return jsonify({"error": "Owner-level admins cannot be deleted"}), 400

    delete_user_account(user_id)
    return jsonify({"message": "User account removed by admin.", "user_id": user_id}), 200
