# config.py
import os
from datetime import timedelta
from dotenv import load_dotenv
load_dotenv()

def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    ENVIRONMENT = os.getenv("APP_ENV") or os.getenv("FLASK_ENV") or "development"
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'super-secret-key')
    STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
    STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY")
    SMTP_HOST = os.getenv("SMTP_HOST")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME = os.getenv("SMTP_USERNAME")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
    SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USERNAME or "no-reply@localhost")
    SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Greek Market")
    SMTP_USE_TLS = _env_bool("SMTP_USE_TLS", True)
    SMTP_USE_SSL = _env_bool("SMTP_USE_SSL", False)
    VERIFICATION_CODE_TTL_MINUTES = int(os.getenv("VERIFICATION_CODE_TTL_MINUTES", "15"))
    PENDING_REGISTRATION_TTL_HOURS = int(os.getenv("PENDING_REGISTRATION_TTL_HOURS", "24"))
    PASSWORD_RESET_TOKEN_TTL_MINUTES = int(os.getenv("PASSWORD_RESET_TOKEN_TTL_MINUTES", "30"))
    PHONE_VERIFICATION_ENABLED = _env_bool("PHONE_VERIFICATION_ENABLED", False)
    SMS_GATEWAY_URL = os.getenv("SMS_GATEWAY_URL")
    SMS_GATEWAY_METHOD = os.getenv("SMS_GATEWAY_METHOD", "POST").upper()
    SMS_GATEWAY_TOKEN = os.getenv("SMS_GATEWAY_TOKEN")
    SMS_FROM_NUMBER = os.getenv("SMS_FROM_NUMBER")
    RATE_LIMIT_ENABLED = _env_bool("RATE_LIMIT_ENABLED", True)
    RATE_LIMIT_CLEANUP_PROBABILITY = float(os.getenv("RATE_LIMIT_CLEANUP_PROBABILITY", "0.05"))
    IMAGE_UPLOAD_MAX_FILES = int(os.getenv("IMAGE_UPLOAD_MAX_FILES", "6"))
    IMAGE_UPLOAD_MAX_BYTES = int(os.getenv("IMAGE_UPLOAD_MAX_BYTES", str(5 * 1024 * 1024)))
    IMAGE_UPLOAD_ALLOWED_EXTENSIONS = [
        extension.strip().lower()
        for extension in os.getenv(
            "IMAGE_UPLOAD_ALLOWED_EXTENSIONS",
            ".jpg,.jpeg,.png,.gif,.webp,.heic,.heif",
        ).split(",")
        if extension.strip()
    ]

    # Tokens: short access, long refresh
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    # We’ll keep access token in headers, refresh in cookies
    JWT_TOKEN_LOCATION = ["headers", "cookies"]
    JWT_COOKIE_SECURE = _env_bool("JWT_COOKIE_SECURE", False)  # set true behind HTTPS
    JWT_COOKIE_SAMESITE = os.getenv("JWT_COOKIE_SAMESITE", "Lax")
    JWT_COOKIE_CSRF_PROTECT = _env_bool("JWT_COOKIE_CSRF_PROTECT", False)
    JWT_REFRESH_COOKIE_PATH = "/token/refresh"  # only send cookie for this route
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", str(25 * 1024 * 1024)))
