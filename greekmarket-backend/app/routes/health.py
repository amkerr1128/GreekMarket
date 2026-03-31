import os

from flask import jsonify
from sqlalchemy import text

from .. import db

from . import bp


@bp.route("/")
def home():
    return jsonify({"message": "Welcome to GreekMarket API!"})


@bp.route("/healthz")
def healthz():
    return jsonify({"status": "ok"}), 200


@bp.route("/readyz")
def readyz():
    ready = {
        "status": "ok",
        "database": "ok",
        "stripe_configured": bool(os.getenv("STRIPE_SECRET_KEY")),
        "stripe_webhook_configured": bool(os.getenv("STRIPE_WEBHOOK_SECRET")),
        "cloudinary_configured": all(
            [
                os.getenv("CLOUDINARY_CLOUD_NAME"),
                os.getenv("CLOUDINARY_API_KEY"),
                os.getenv("CLOUDINARY_API_SECRET"),
            ]
        ),
    }
    try:
        db.session.execute(text("SELECT 1"))
    except Exception as exc:
        ready["status"] = "degraded"
        ready["database"] = "error"
        ready["error"] = str(exc)
        return jsonify(ready), 503

    return jsonify(ready), 200
