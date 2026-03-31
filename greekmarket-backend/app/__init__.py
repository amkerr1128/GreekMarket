from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from config import Config
from dotenv import load_dotenv
from flask_cors import CORS
from sqlalchemy import inspect, text
from urllib.parse import urlparse
load_dotenv()
import cloudinary
import os

db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()


def _normalize_origin(value: str | None) -> str | None:
    if not value:
        return None

    parsed = urlparse(value)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return value.rstrip("/")


def _local_dev_variants(origin: str) -> set[str]:
    parsed = urlparse(origin)
    if parsed.hostname not in {"localhost", "127.0.0.1"}:
        return {origin}

    port = f":{parsed.port}" if parsed.port else ""
    scheme = parsed.scheme or "http"
    return {
        f"{scheme}://localhost{port}",
        f"{scheme}://127.0.0.1{port}",
    }


def build_cors_origins() -> list[str]:
    origins: set[str] = set()

    frontend_url = os.getenv("FRONTEND_URL") or Config.FRONTEND_URL
    normalized = _normalize_origin(frontend_url)
    if normalized:
        origins.add(normalized)
        origins.update(_local_dev_variants(normalized))

    origins.update({"http://localhost:5173", "http://127.0.0.1:5173"})
    return sorted(origins)


def _validate_production_env() -> None:
    environment = (os.getenv("APP_ENV") or os.getenv("FLASK_ENV") or "development").lower()
    if environment != "production":
        return

    required = [
        "DATABASE_URL",
        "JWT_SECRET_KEY",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
    ]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Missing required production env vars: {', '.join(missing)}")

    email_verification_ready = bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_FROM_EMAIL"))
    phone_verification_ready = bool(
        (os.getenv("PHONE_VERIFICATION_ENABLED") or "").strip().lower() in {"1", "true", "yes", "on"}
        and os.getenv("SMS_GATEWAY_URL")
    )
    if not (email_verification_ready or phone_verification_ready):
        raise RuntimeError(
            "Production requires either SMTP email verification or SMS verification to be configured"
        )


def _ensure_column_exists(table_name: str, column_name: str, ddl: str) -> bool:
    inspector = inspect(db.engine)
    existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
    if column_name in existing_columns:
        return False

    with db.engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {ddl}"))
    return True


def _backfill_legacy_schema() -> None:
    migrated = []

    if _ensure_column_exists(
        "chapter_join_requests",
        "requested_role",
        "requested_role VARCHAR(20) NOT NULL DEFAULT 'member'",
    ):
        migrated.append("chapter_join_requests.requested_role")

    if _ensure_column_exists(
        "chapter_join_requests",
        "note",
        "note TEXT",
    ):
        migrated.append("chapter_join_requests.note")

    if _ensure_column_exists(
        "chapter_join_requests",
        "reviewed_by",
        "reviewed_by INTEGER",
    ):
        migrated.append("chapter_join_requests.reviewed_by")

    if migrated:
        print(f"Backfilled legacy schema columns: {', '.join(migrated)}")


def create_app():
    _validate_production_env()

    app = Flask(__name__)
    app.config.from_object(Config)
    CORS(
        app,
        origins=build_cors_origins(),
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    )

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if (app.config.get("ENVIRONMENT") or "").lower() == "production":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    from app.routes import bp as main_bp
    app.register_blueprint(main_bp)

    with app.app_context():
        db.create_all()
        _backfill_legacy_schema()

    return app

from .models import *

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET")
)
