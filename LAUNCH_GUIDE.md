# GreekMarket Launch Guide

This is the production-readiness guide for the current GreekMarket repo.

## 1. Current readiness

### What is ready now
- Account creation and login
- Profile editing and profile photo uploads
- Chapter branding uploads for chapter admins
- Listing creation with multiple photos
- Browse, search, messaging, bookmarks, and purchase history
- Stripe seller onboarding entrypoint
- Stripe-hosted checkout entrypoint from listing detail
- Health endpoints for deploy checks:
  - `GET /healthz`
  - `GET /readyz`
- In-app account deletion flow

### What is not fully production-ready yet
- There is no automated end-to-end test suite for auth, checkout, uploads, and messaging.
- Stripe still needs real live-mode configuration, webhook registration, and seller onboarding in production.
- There is no native iOS app in this repo yet. This is still a web app codebase.
- App Store submission cannot happen directly from this Windows workspace because Apple distribution requires an iOS build and Xcode.

## 2. Web launch checklist

### Backend
Fill out [greekmarket-backend/.env.example](D:/FSU/GreekMarket/greekmarket-backend/.env.example) with real production values.

Required:
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

Recommended:
- `JWT_COOKIE_SECURE=true`
- `JWT_COOKIE_SAMESITE=None`
- `JWT_COOKIE_CSRF_PROTECT=true`
- `MAX_CONTENT_LENGTH=26214400`

### Frontend
Fill out [greekmarket-frontend/.env.example](D:/FSU/GreekMarket/greekmarket-frontend/.env.example):
- `VITE_API_BASE_URL=https://your-api-domain.example`

### Database
Before launch, run migrations on production:
```powershell
cd D:\FSU\GreekMarket\greekmarket-backend
flask db upgrade
```

### Stripe
- Create live Stripe API keys
- Create a live webhook endpoint pointing to `/webhook`
- Subscribe it to at least `checkout.session.completed`
- Test a full seller onboarding flow in live mode
- Test a real low-value purchase from a buyer account to a seller account

### Cloudinary
- Create a production cloud
- Add the three Cloudinary environment values
- Test user photo upload, chapter image upload, and multi-image post upload

## 3. Recommended deployment path

The fastest path from this repo to a public web launch is:
- Backend on Render web service
- Frontend on Render static site
- PostgreSQL on Render managed database

I added a starter blueprint at [render.yaml](D:/FSU/GreekMarket/render.yaml).

Backend production entrypoint:
- [greekmarket-backend/wsgi.py](D:/FSU/GreekMarket/greekmarket-backend/wsgi.py)

Backend deploy notes:
- `gunicorn` is now included in [greekmarket-backend/requirements.txt](D:/FSU/GreekMarket/greekmarket-backend/requirements.txt)
- readiness endpoint is `/readyz`

## 4. Manual QA before launch

Test these with real browser sessions:

1. New user signup
2. Login/logout
3. Profile edit and profile photo upload
4. Chapter admin image upload
5. Create listing with multiple images
6. Browse and search
7. Save and unsave a listing
8. Message seller
9. Seller Stripe onboarding
10. Buyer checkout on a real paid listing
11. Stripe webhook marks listing sold
12. Purchase appears in purchase history
13. Account deletion flow

## 5. App Store path

You are not App Store-ready from this repo alone yet.

To ship on the App Store, you still need:
- A native iOS wrapper or native app project, typically via Capacitor or a full native stack
- A Mac with Xcode to build and upload the app
- Apple Developer Program enrollment
- App Store Connect setup, screenshots, metadata, privacy answers, and review notes
- A support URL and privacy policy URL
- A stable demo account for App Review

Starter documents you can publish and then refine:
- [PRIVACY_POLICY_TEMPLATE.md](D:/FSU/GreekMarket/PRIVACY_POLICY_TEMPLATE.md)
- [SUPPORT_TEMPLATE.md](D:/FSU/GreekMarket/SUPPORT_TEMPLATE.md)

### Important product/review notes
- The app must feel more like an app than a repackaged website.
- The backend must be live during App Review.
- Since the app supports account creation, in-app account deletion must exist.

## 6. Recommended next work after this pass

Highest-value next items:
- Add automated smoke/integration tests for auth, checkout, uploads, and messaging
- Add seller listing management: edit, archive, mark sold, relist
- Add better purchase receipts and order detail pages
- Add monitoring/error reporting before promotion
- Build the iOS wrapper only after web production is stable
