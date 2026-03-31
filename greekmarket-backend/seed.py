# seed.py
from app import create_app, db
from app.models import Chapter, Post, PostImage, School, User
from sqlalchemy import and_
from werkzeug.security import generate_password_hash

"""
Safe idempotent seed:
- Upserts Florida State University (fsu.edu)
- Adds common fraternity/sorority chapters (no duplicates)
- (Optional) creates a default user and associates them to FSU via user.school_id
  so your /me and School page have data to render.

Run:  python seed.py
"""

# ---- Settings you can tweak ----
CREATE_DEFAULT_USER = True
DEFAULT_USER = {
    "first_name": "Austin",
    "last_name": "Kerr",
    "email": "austin@example.com",
    "handle": "temp_handle_1",
    "password": "changeme123",  # change after seeding
}

FRATERNITIES = [
    "Sigma Phi Epsilon (Sigep)",
    "Pi Kappa Alpha (Pike)",
    "Theta Chi",
    "Kappa Alpha",
    "Kappa Sigma",
    "Delta Chi",
    "Beta Theta Pi (Beta)",
    "Sigma Chi",
    "Phi Gamma Delta (FIJI)",
]

SORORITIES = [
    "Alpha Delta Pi (ADPi)",
    "Delta Delta Delta (Tridelt)",
    "Zeta Tau Alpha (Zeta)",
    "Delta Gamma (DG)",
    "Kappa Alpha Theta (Theta)",
    "Chi Omega (Chi O)",
    "Sigma Delta Tau (Sig Delt)",
    "Kappa Kappa Gamma",
    "Alpha Gamma Delta",
    "Alpha Chi Omega",
    "Delta Zeta",
    "Phi Mu",
    "Alpha Phi",
]
# --------------------------------


def get_or_create_school(name: str, domain: str) -> School:
    school = School.query.filter_by(domain=domain).first()
    if school:
        # update the name if needed (domain is the unique key)
        if school.name != name:
            school.name = name
            db.session.commit()
        return school

    school = School(name=name, domain=domain)
    db.session.add(school)
    db.session.commit()
    return school


def ensure_chapter(name: str, type_: str, school_id: int) -> Chapter:
    # dedupe by (lower(name), type, school_id)
    existing = Chapter.query.filter(
        and_(Chapter.school_id == school_id, Chapter.type == type_, Chapter.name.ilike(name))
    ).first()
    if existing:
        return existing

    chapter = Chapter(name=name, type=type_, school_id=school_id, verified=True)
    db.session.add(chapter)
    return chapter


def get_or_create_user(user_info: dict, school_id: int) -> User:
    user = User.query.filter_by(email=user_info["email"]).first()
    if user:
        # make sure they’re attached to the school
        if user.school_id != school_id:
            user.school_id = school_id
        if not user.handle:
            user.handle = user_info["handle"]
        db.session.commit()
        return user

    user = User(
        first_name=user_info["first_name"],
        last_name=user_info["last_name"],
        email=user_info["email"],
        handle=user_info["handle"],
        school_id=school_id,
        password_hash=generate_password_hash(user_info["password"]),
    )
    db.session.add(user)
    db.session.commit()
    return user


def ensure_preview_profile_pictures() -> None:
    from app.routes.common import build_placeholder_avatar_url

    users = User.query.order_by(User.user_id.asc()).all()
    updated = 0
    for user in users:
        if not user.profile_picture_url:
            display_name = f"{user.first_name} {user.last_name}".strip() or user.handle
            user.profile_picture_url = build_placeholder_avatar_url(display_name)
            updated += 1
    if updated:
        db.session.commit()
    print(f"🖼️ Profile pictures ensured for {updated} users.")


def ensure_preview_post_images() -> None:
    from app.routes.common import build_placeholder_post_image_url

    posts = Post.query.order_by(Post.post_id.asc()).all()
    added = 0
    for post in posts:
        if post.images:
            continue
        db.session.add(PostImage(post_id=post.post_id, url=build_placeholder_post_image_url(post.title)))
        added += 1
    if added:
        db.session.commit()
    print(f"🖼️ Post images ensured for {added} posts.")


def main():
    app = create_app()
    with app.app_context():
        print("🔧 Seeding database…")

        # 1) Upsert the school
        fsu = get_or_create_school("Florida State University", "fsu.edu")
        print(f"✅ School ready: {fsu.name} (id={fsu.school_id}, domain={fsu.domain})")

        # 2) Chapters (idempotent)
        added = 0
        for name in FRATERNITIES:
            ensure_chapter(name, "Fraternity", fsu.school_id)
            added += 1
        for name in SORORITIES:
            ensure_chapter(name, "Sorority", fsu.school_id)
            added += 1
        db.session.commit()
        print(f"✅ Chapters ensured (attempted {added}, duplicates skipped).")

        # 3) Optional: default user so pages have data
        if CREATE_DEFAULT_USER:
            user = get_or_create_user(DEFAULT_USER, fsu.school_id)
            print(f"✅ Default user ready: {user.email} (id={user.user_id}, handle=@{user.handle})")

        # 4) Preview-friendly assets for seeded data
        ensure_preview_profile_pictures()
        ensure_preview_post_images()

        # 5) Summary
        total_chapters = Chapter.query.filter_by(school_id=fsu.school_id).count()
        print(f"📊 Summary → school_id={fsu.school_id}, chapters={total_chapters}")

        print("🎉 Seeding complete.")


if __name__ == "__main__":
    main()
