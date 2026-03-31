# Production Backend Checklist

Required environment variables:
- `APP_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `FRONTEND_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Recommended production settings:
- `JWT_COOKIE_SECURE=true`
- `JWT_COOKIE_SAMESITE=None`
- `JWT_COOKIE_CSRF_PROTECT=true`
- `MAX_CONTENT_LENGTH=26214400`

Entrypoint:
- Use `wsgi:app` for Gunicorn or a similar WSGI server.

Health checks:
- `GET /healthz`
- `GET /readyz`

Payments:
- Sellers must complete Stripe Express onboarding before checkout.
- Checkout uses destination charges and records purchases from the Stripe webhook.
