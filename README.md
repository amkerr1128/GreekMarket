# GreekMarket

GreekMarket is a campus-focused resale marketplace for Greek life communities. This repo contains the full web product: a React/Vite frontend and a Flask/PostgreSQL backend with messaging, moderation, notifications, Stripe checkout, account verification, and admin tooling.

## Repo structure

- `greekmarket-frontend/` - React 19 + Vite client application
- `greekmarket-backend/` - Flask API, models, migrations, auth, uploads, payments, and admin routes
- `render.yaml` - Render deployment blueprint for the frontend, backend, and Postgres
- `LAUNCH_GUIDE.md` - launch checklist and production setup notes
- `PRIVACY_POLICY_TEMPLATE.md` - starter privacy policy content
- `SUPPORT_TEMPLATE.md` - starter support/help content

## Core product areas

- Account signup, login, verification, and recovery
- Profiles for users, schools, and chapters
- Listings, saved posts, search, and recent searches
- Direct messages, notifications, and moderation/reporting
- Admin workspace for support, reports, and chapter access control
- Stripe seller onboarding and buyer checkout
- Cloudinary-backed media uploads for profiles, chapters, and listings

## Local development

### Frontend

```powershell
cd greekmarket-frontend
npm install
npm run dev
```

### Backend

```powershell
cd greekmarket-backend
pip install -r requirements.txt
flask db upgrade
python run.py
```

## Deployment

The intended deployment target is Render:

- `greekmarket-api` as a Python web service
- `greekmarket-web` as a static site
- Render Postgres for the primary database

The backend production entrypoint is:

- `greekmarket-backend/wsgi.py`

The health endpoints are:

- `GET /healthz`
- `GET /readyz`

See:

- [`LAUNCH_GUIDE.md`](./LAUNCH_GUIDE.md)
- [`render.yaml`](./render.yaml)
- [`greekmarket-backend/PRODUCTION.md`](./greekmarket-backend/PRODUCTION.md)

## Production configuration

You will need real values for:

- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `FRONTEND_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `VITE_API_BASE_URL`

Use the checked-in examples as templates:

- [`greekmarket-backend/.env.example`](./greekmarket-backend/.env.example)
- [`greekmarket-frontend/.env.example`](./greekmarket-frontend/.env.example)

## Notes

- This repo is the web app codebase. It is not yet a native iOS project.
- Stripe webhook delivery should point to the backend service at `/webhook`.
- Do not commit live secrets or local `.env` files to source control.
