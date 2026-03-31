from flask import Blueprint

bp = Blueprint("main", __name__)

from . import admin, auth, chapters, health, media, messages, moderation, notifications, payments, posts, profile, recovery, schools, search, users, verification  # noqa: E402,F401
