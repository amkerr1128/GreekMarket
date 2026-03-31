from sqlalchemy import or_

from .. import db
from ..models import (
    Ban,
    BlockedUser,
    ContactVerificationChallenge,
    Chapter,
    ChapterJoinRequest,
    Comment,
    Favorite,
    Message,
    MessageReaction,
    MessageReply,
    MessageReport,
    Notification,
    PinnedConversation,
    Post,
    PostImage,
    PostReport,
    ModerationReview,
    PendingRegistration,
    Purchase,
    SchoolJoinRequest,
    SchoolMembership,
    SiteAdmin,
    SupportTicket,
    User,
    UserChapterMembership,
    UserContactMethod,
    UserFollow,
    UserReport,
)


def delete_user_account(user_id: int) -> None:
    user = User.query.get(user_id)
    if not user:
        return

    post_ids = [post_id for (post_id,) in db.session.query(Post.post_id).filter_by(user_id=user_id).all()]

    if post_ids:
        PostReport.query.filter(PostReport.post_id.in_(post_ids)).delete(synchronize_session=False)
        Favorite.query.filter(Favorite.post_id.in_(post_ids)).delete(synchronize_session=False)
        Comment.query.filter(Comment.post_id.in_(post_ids)).delete(synchronize_session=False)
        Purchase.query.filter(Purchase.post_id.in_(post_ids)).delete(synchronize_session=False)
        PostImage.query.filter(PostImage.post_id.in_(post_ids)).delete(synchronize_session=False)
        Post.query.filter(Post.post_id.in_(post_ids)).delete(synchronize_session=False)

    Chapter.query.filter_by(created_by=user_id).update({"created_by": None}, synchronize_session=False)

    BlockedUser.query.filter(
        or_(BlockedUser.user_id == user_id, BlockedUser.blocked_user_id == user_id)
    ).delete(synchronize_session=False)
    UserReport.query.filter(
        or_(UserReport.user_id == user_id, UserReport.reported_user_id == user_id)
    ).delete(synchronize_session=False)
    authored_message_report_ids = [
        report_id
        for (report_id,) in db.session.query(MessageReport.report_id).filter_by(reporter_id=user_id).all()
    ]
    if authored_message_report_ids:
        ModerationReview.query.filter(
            ModerationReview.report_type == "message",
            ModerationReview.report_id.in_(authored_message_report_ids),
        ).delete(synchronize_session=False)
    MessageReport.query.filter_by(reporter_id=user_id).delete(synchronize_session=False)
    PostReport.query.filter_by(reporter_id=user_id).delete(synchronize_session=False)
    ModerationReview.query.filter_by(reviewed_by=user_id).update({"reviewed_by": None}, synchronize_session=False)
    SiteAdmin.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    SiteAdmin.query.filter_by(granted_by=user_id).update({"granted_by": None}, synchronize_session=False)
    SupportTicket.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    SupportTicket.query.filter_by(assigned_to=user_id).update({"assigned_to": None}, synchronize_session=False)
    Notification.query.filter_by(recipient_id=user_id).delete(synchronize_session=False)
    Notification.query.filter_by(actor_id=user_id).update({"actor_id": None}, synchronize_session=False)
    PendingRegistration.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    ContactVerificationChallenge.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    UserContactMethod.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    UserFollow.query.filter(
        or_(UserFollow.follower_id == user_id, UserFollow.followed_user_id == user_id)
    ).delete(synchronize_session=False)
    message_ids = [
        message_id
        for (message_id,) in db.session.query(Message.message_id)
        .filter(or_(Message.sender_id == user_id, Message.recipient_id == user_id))
        .all()
    ]
    if message_ids:
        message_report_ids = [
            report_id
            for (report_id,) in db.session.query(MessageReport.report_id)
            .filter(MessageReport.message_id.in_(message_ids))
            .all()
        ]
        if message_report_ids:
            ModerationReview.query.filter(
                ModerationReview.report_type == "message",
                ModerationReview.report_id.in_(message_report_ids),
            ).delete(synchronize_session=False)
        MessageReaction.query.filter(MessageReaction.message_id.in_(message_ids)).delete(synchronize_session=False)
        MessageReport.query.filter(MessageReport.message_id.in_(message_ids)).delete(synchronize_session=False)
        MessageReply.query.filter(
            or_(
                MessageReply.message_id.in_(message_ids),
                MessageReply.reply_to_message_id.in_(message_ids),
            )
        ).delete(synchronize_session=False)
    MessageReaction.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    Message.query.filter(or_(Message.sender_id == user_id, Message.recipient_id == user_id)).delete(
        synchronize_session=False
    )
    PinnedConversation.query.filter(
        or_(PinnedConversation.user_id == user_id, PinnedConversation.other_user_id == user_id)
    ).delete(synchronize_session=False)
    Favorite.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    Comment.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    UserChapterMembership.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    SchoolMembership.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    SchoolJoinRequest.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    ChapterJoinRequest.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    Ban.query.filter_by(user_id=user_id).delete(synchronize_session=False)
    Purchase.query.filter_by(buyer_id=user_id).delete(synchronize_session=False)

    db.session.delete(user)
    db.session.commit()
