from datetime import datetime

from sqlalchemy.orm import synonym

from . import db


# --------------------------
# Core entities
# --------------------------
class School(db.Model):
    __tablename__ = "schools"
    school_id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    domain = db.Column(db.String(255), unique=True, nullable=False)

    users = db.relationship("User", backref="school", lazy=True)
    chapters = db.relationship("Chapter", backref="school", lazy=True)
    posts = db.relationship("Post", backref="school", lazy=True)


class User(db.Model):
    __tablename__ = "users"
    user_id = db.Column(db.Integer, primary_key=True)

    # NOTE: these were non-nullable in your original schema
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)

    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.Text, nullable=False)
    profile_picture_url = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    school_id = db.Column(db.Integer, db.ForeignKey("schools.school_id"), nullable=True)

    # Relationships
    memberships = db.relationship("UserChapterMembership", backref="user", lazy=True)
    posts = db.relationship("Post", backref="user", lazy=True)
    comments = db.relationship("Comment", backref="user", lazy=True)
    favorites = db.relationship("Favorite", backref="user", lazy=True)

    handle = db.Column(db.String(50), unique=True, nullable=False)
    stripe_account_id = db.Column(db.String(128), nullable=True)


class PendingRegistration(db.Model):
    __tablename__ = "pending_registrations"
    registration_id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(255), nullable=False, index=True)
    phone_number = db.Column(db.String(32), nullable=True)
    handle = db.Column(db.String(50), nullable=False, index=True)
    password_hash = db.Column(db.Text, nullable=False)
    school_id = db.Column(db.Integer, db.ForeignKey("schools.school_id"), nullable=False)
    preferred_method = db.Column(db.String(20), nullable=False, default="email")  # email | phone
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending | verified | expired | cancelled
    verification_method = db.Column(db.String(20), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
    verified_at = db.Column(db.DateTime, nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=True)

    school = db.relationship("School", lazy=True)
    user = db.relationship("User", foreign_keys=[user_id], lazy=True)


class ContactVerificationChallenge(db.Model):
    __tablename__ = "contact_verification_challenges"
    challenge_id = db.Column(db.Integer, primary_key=True)
    registration_id = db.Column(db.Integer, db.ForeignKey("pending_registrations.registration_id"), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=True)
    purpose = db.Column(db.String(20), nullable=False)  # signup | profile
    contact_method = db.Column(db.String(20), nullable=False)  # email | phone
    contact_value = db.Column(db.String(255), nullable=False)
    code_hash = db.Column(db.String(255), nullable=False)
    code_salt = db.Column(db.String(64), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending | verified | expired | revoked
    attempts = db.Column(db.Integer, nullable=False, default=0)
    max_attempts = db.Column(db.Integer, nullable=False, default=5)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    sent_at = db.Column(db.DateTime, nullable=True)
    expires_at = db.Column(db.DateTime, nullable=False)
    verified_at = db.Column(db.DateTime, nullable=True)
    delivery_channel = db.Column(db.String(20), nullable=True)
    provider_message_id = db.Column(db.String(255), nullable=True)

    registration = db.relationship("PendingRegistration", foreign_keys=[registration_id], lazy=True)
    user = db.relationship("User", foreign_keys=[user_id], lazy=True)


class UserContactMethod(db.Model):
    __tablename__ = "user_contact_methods"
    contact_method_id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    contact_method = db.Column(db.String(20), nullable=False)  # email | phone
    contact_value = db.Column(db.String(255), nullable=False)
    is_primary = db.Column(db.Boolean, default=False)
    verified_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship("User", backref="contact_methods", lazy=True)

    __table_args__ = (
        db.UniqueConstraint("user_id", "contact_method", "contact_value", name="uq_user_contact_method_value"),
    )


class Chapter(db.Model):
    __tablename__ = "chapters"
    chapter_id = db.Column(db.Integer, primary_key=True)
    school_id = db.Column(db.Integer, db.ForeignKey("schools.school_id"), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    nickname = db.Column(db.String(50))
    type = db.Column(db.String(20), nullable=False)
    verified = db.Column(db.Boolean, default=False)
    profile_picture_url = db.Column(db.Text)
    created_by = db.Column(db.Integer, db.ForeignKey("users.user_id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    memberships = db.relationship("UserChapterMembership", backref="chapter", lazy=True)
    posts = db.relationship("Post", backref="chapter", lazy=True)


# --------------------------
# Memberships & Requests
# --------------------------
class UserChapterMembership(db.Model):
    __tablename__ = "user_chapter_memberships"
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), primary_key=True)
    chapter_id = db.Column(db.Integer, db.ForeignKey("chapters.chapter_id"), primary_key=True)
    role = db.Column(db.String(20), nullable=False)  # member | admin
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)


class SchoolMembership(db.Model):
    """
    Optional: if you’re letting users “join” schools explicitly
    (role can be member/mod/admin if you add school-level admins later)
    """
    __tablename__ = "school_memberships"
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), primary_key=True)
    school_id = db.Column(db.Integer, db.ForeignKey("schools.school_id"), primary_key=True)
    role = db.Column(db.String(20), nullable=False, default="member")
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)


class UserFollow(db.Model):
    __tablename__ = "user_follows"
    follower_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), primary_key=True)
    followed_user_id = db.Column("followed_id", db.Integer, db.ForeignKey("users.user_id"), primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    follower = db.relationship("User", foreign_keys=[follower_id], lazy=True)
    followed = db.relationship("User", foreign_keys=[followed_user_id], lazy=True)
    followed_id = synonym("followed_user_id")


class ChapterFollow(db.Model):
    __tablename__ = "chapter_follows"
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), primary_key=True)
    chapter_id = db.Column(db.Integer, db.ForeignKey("chapters.chapter_id"), primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class SchoolJoinRequest(db.Model):
    __tablename__ = "school_join_requests"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    school_id = db.Column(db.Integer, db.ForeignKey("schools.school_id"), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending|approved|rejected
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    decided_at = db.Column(db.DateTime)


class ChapterJoinRequest(db.Model):
    __tablename__ = "chapter_join_requests"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    chapter_id = db.Column(db.Integer, db.ForeignKey("chapters.chapter_id"), nullable=False)
    requested_role = db.Column(db.String(20), nullable=False, default="member")  # member|admin
    note = db.Column(db.Text)
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending|approved|rejected
    reviewed_by = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    decided_at = db.Column(db.DateTime)

    requester = db.relationship("User", foreign_keys=[user_id], lazy=True)
    chapter = db.relationship("Chapter", foreign_keys=[chapter_id], lazy=True)
    reviewer = db.relationship("User", foreign_keys=[reviewed_by], lazy=True)


class Ban(db.Model):
    """
    Optional: basic ban model if you want to enforce bans at school/chapter.
    """
    __tablename__ = "bans"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    scope = db.Column(db.String(20), nullable=False, default="school")  # school|chapter
    school_id = db.Column(db.Integer, db.ForeignKey("schools.school_id"))
    chapter_id = db.Column(db.Integer, db.ForeignKey("chapters.chapter_id"))
    reason = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime)


# --------------------------
# Posts & related
# --------------------------
class Post(db.Model):
    __tablename__ = "posts"
    post_id = db.Column(db.Integer, primary_key=True)

    chapter_id = db.Column(db.Integer, db.ForeignKey("chapters.chapter_id"), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    school_id = db.Column(db.Integer, db.ForeignKey("schools.school_id"), nullable=False)

    type = db.Column(db.String(20), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text)

    price = db.Column(db.Numeric(10, 2))
    views = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    comments = db.relationship("Comment", backref="post", lazy=True)
    images = db.relationship("PostImage", backref="post", cascade="all, delete-orphan", lazy=True)
    favorites = db.relationship("Favorite", backref="post", lazy=True)

    is_sold = db.Column(db.Boolean, default=False)
    visibility = db.Column(db.String(20), nullable=False, default="public")


class PostImage(db.Model):
    __tablename__ = "post_images"
    image_id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.post_id"), nullable=False)
    url = db.Column(db.Text, nullable=False)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)


class Comment(db.Model):
    __tablename__ = "comments"
    comment_id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.post_id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Favorite(db.Model):
    __tablename__ = "favorites"
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.post_id"), primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# --------------------------
# Direct messages
# --------------------------
class Message(db.Model):
    __tablename__ = "messages"
    message_id = db.Column(db.Integer, primary_key=True)

    sender_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    recipient_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)

    text = db.Column(db.Text, nullable=False)
    image_url = db.Column(db.Text)

    sent_at = db.Column(db.DateTime, default=datetime.utcnow)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)  # kept for backward compatibility
    read = db.Column(db.Boolean, default=False)

    sender = db.relationship("User", foreign_keys=[sender_id], backref="sent_messages", lazy=True)
    recipient = db.relationship("User", foreign_keys=[recipient_id], backref="received_messages", lazy=True)


class MessageReply(db.Model):
    __tablename__ = "message_replies"
    message_id = db.Column(db.Integer, db.ForeignKey("messages.message_id"), primary_key=True)
    reply_to_message_id = db.Column(db.Integer, db.ForeignKey("messages.message_id"), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    message = db.relationship("Message", foreign_keys=[message_id], lazy=True)
    reply_to = db.relationship("Message", foreign_keys=[reply_to_message_id], lazy=True)


class MessageReaction(db.Model):
    __tablename__ = "message_reactions"
    reaction_id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("messages.message_id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    emoji = db.Column(db.String(16), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    message = db.relationship("Message", backref="reactions", lazy=True)
    user = db.relationship("User", lazy=True)

    __table_args__ = (db.UniqueConstraint("message_id", "user_id", name="uq_message_reactions_message_user"),)


class PinnedConversation(db.Model):
    __tablename__ = "pinned_conversations"
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), primary_key=True)
    other_user_id = db.Column(db.Integer, primary_key=True)
    pinned_at = db.Column(db.DateTime, default=datetime.utcnow)


# --------------------------
# Notifications
# --------------------------
class Notification(db.Model):
    __tablename__ = "notifications"
    notification_id = db.Column(db.Integer, primary_key=True)
    recipient_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    actor_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=True)
    event_type = db.Column(db.String(50), nullable=False)
    event_key = db.Column(db.String(255), nullable=True)
    title = db.Column(db.String(255), nullable=False)
    body = db.Column(db.Text, nullable=False)
    action_url = db.Column(db.Text, nullable=True)
    payload = db.Column(db.JSON, nullable=False, default=dict)
    read_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    recipient = db.relationship("User", foreign_keys=[recipient_id], lazy=True)
    actor = db.relationship("User", foreign_keys=[actor_id], lazy=True)

    __table_args__ = (
        db.UniqueConstraint("recipient_id", "event_type", "event_key", name="uq_notifications_recipient_event"),
    )


class RateLimitBucket(db.Model):
    __tablename__ = "rate_limit_buckets"
    bucket_key = db.Column(db.String(255), primary_key=True)
    scope = db.Column(db.String(100), nullable=False, index=True)
    identifier = db.Column(db.String(255), nullable=False)
    window_start = db.Column(db.Integer, nullable=False, index=True)
    request_count = db.Column(db.Integer, nullable=False, default=0)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# --------------------------
# Reports / Blocks
# --------------------------
class PostReport(db.Model):
    __tablename__ = "post_reports"
    report_id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.post_id"), nullable=False)
    reporter_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    reason = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    post = db.relationship("Post", backref="reports")
    reporter = db.relationship("User", backref="post_reports")


class UserReport(db.Model):
    __tablename__ = "user_reports"
    report_id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)           # who is reporting
    reported_user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)  # who is being reported
    reason = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    reporter = db.relationship("User", foreign_keys=[user_id], backref="user_reports_made")
    reported_user = db.relationship("User", foreign_keys=[reported_user_id], backref="user_reports_received")


class MessageReport(db.Model):
    __tablename__ = "message_reports"
    report_id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("messages.message_id"), nullable=False)
    reporter_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)
    reason = db.Column(db.String(255), nullable=False)
    details = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    message = db.relationship("Message", backref="reports", lazy=True)
    reporter = db.relationship("User", backref="message_reports", lazy=True)


class BlockedUser(db.Model):
    __tablename__ = "blocked_users"
    block_id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)        # the blocker
    blocked_user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)  # being blocked
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (db.UniqueConstraint("user_id", "blocked_user_id", name="uq_blocked_pair"),)


# --------------------------
# Admin / Support
# --------------------------
class SiteAdmin(db.Model):
    __tablename__ = "site_admins"
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), primary_key=True)
    granted_by = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship("User", foreign_keys=[user_id], lazy=True)
    granted_by_user = db.relationship("User", foreign_keys=[granted_by], lazy=True)


class ModerationReview(db.Model):
    __tablename__ = "moderation_reviews"
    review_id = db.Column(db.Integer, primary_key=True)
    report_type = db.Column(db.String(20), nullable=False)  # post | user
    report_id = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="open")  # open | in_progress | resolved | dismissed
    action_taken = db.Column(db.String(50))
    note = db.Column(db.Text)
    reviewed_by = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=True)
    reviewed_at = db.Column(db.DateTime, default=datetime.utcnow)

    reviewer = db.relationship("User", foreign_keys=[reviewed_by], lazy=True)

    __table_args__ = (db.UniqueConstraint("report_type", "report_id", name="uq_moderation_review_report"),)


class SupportTicket(db.Model):
    __tablename__ = "support_tickets"
    ticket_id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=True)
    email = db.Column(db.String(255), nullable=False)
    subject = db.Column(db.String(255), nullable=False)
    category = db.Column(db.String(50), nullable=False, default="general")
    message = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="open")  # open | in_progress | resolved
    priority = db.Column(db.String(20), nullable=False, default="normal")  # low | normal | high | urgent
    assigned_to = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=True)
    resolution_note = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    resolved_at = db.Column(db.DateTime, nullable=True)

    submitter = db.relationship("User", foreign_keys=[user_id], lazy=True)
    assignee = db.relationship("User", foreign_keys=[assigned_to], lazy=True)


# --------------------------
# Payments / Purchases
# --------------------------
class Purchase(db.Model):
    __tablename__ = "purchases"
    purchase_id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.post_id"), nullable=False)
    buyer_id = db.Column(db.Integer, db.ForeignKey("users.user_id"), nullable=False)

    # Make these nullable to avoid integrity errors until you populate them
    stripe_session_id = db.Column(db.String(255), unique=True, nullable=True)
    amount = db.Column(db.Float, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    purchased_at = db.Column(db.DateTime, default=datetime.utcnow)

    post = db.relationship("Post", backref="purchases", lazy=True)
    buyer = db.relationship("User", backref="purchases", lazy=True)
