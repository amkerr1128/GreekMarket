import os

import stripe

from .. import db
from ..models import Post, Purchase, User
from .notifications import create_notification
from ..utils import to_int


def frontend_url(path: str) -> str:
    base = (os.getenv("FRONTEND_URL") or "http://localhost:5173").rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def checkout_success_url() -> str:
    return frontend_url("success?session_id={CHECKOUT_SESSION_ID}")


def checkout_cancel_url() -> str:
    return frontend_url("cancel")


def account_refresh_url() -> str:
    return frontend_url("reauth")


def account_return_url() -> str:
    return frontend_url("account")


def seller_payout_ready(seller) -> tuple[bool, str]:
    if not seller:
        return False, "Post seller not found"
    if not seller.stripe_account_id:
        return False, "Seller must have a Stripe recipient account connected."

    try:
        account = stripe.Account.retrieve(seller.stripe_account_id)
    except Exception:
        return False, "Could not verify seller payout setup"

    if not getattr(account, "charges_enabled", False):
        return False, "Seller Stripe account is not ready to receive payments"
    if not getattr(account, "details_submitted", False):
        return False, "Seller Stripe account setup is incomplete"

    return True, ""


def checkout_session_details(session: dict) -> dict:
    metadata = session.get("metadata", {}) if hasattr(session, "get") else {}
    return {
        "metadata": metadata,
        "post_id": to_int(metadata.get("post_id")),
        "buyer_id": to_int(metadata.get("buyer_id")),
        "seller_id": to_int(metadata.get("seller_id")),
        "session_id": session.get("id") if hasattr(session, "get") else None,
        "amount_total": session.get("amount_total") if hasattr(session, "get") else None,
        "payment_status": session.get("payment_status") if hasattr(session, "get") else None,
        "session_status": session.get("status") if hasattr(session, "get") else None,
    }


def find_purchase_for_checkout(post_id: int | None, buyer_id: int | None, session_id: str | None):
    if session_id:
        purchase = Purchase.query.filter_by(stripe_session_id=session_id).first()
        if purchase:
            return purchase
    if post_id and buyer_id:
        return (
            Purchase.query.filter_by(post_id=post_id, buyer_id=buyer_id)
            .order_by(Purchase.purchased_at.desc())
            .first()
        )
    return None


def record_completed_checkout(session: dict):
    details = checkout_session_details(session)
    post_id = details["post_id"]
    buyer_id = details["buyer_id"]
    session_id = details["session_id"]
    amount_total = details["amount_total"]
    payment_status = details["payment_status"]

    if not post_id or not buyer_id:
        return None
    if payment_status and payment_status != "paid":
        return find_purchase_for_checkout(post_id, buyer_id, session_id)

    existing = find_purchase_for_checkout(post_id, buyer_id, session_id)
    post = Post.query.get(post_id)
    if existing:
        changed = False
        if session_id and existing.stripe_session_id != session_id:
            existing.stripe_session_id = session_id
            changed = True
        if amount_total is not None and existing.amount is None:
            existing.amount = amount_total / 100.0
            changed = True
        if post and not post.is_sold:
            post.is_sold = True
            changed = True
        buyer = User.query.get(buyer_id)
        seller = post.user if post else None
        if existing.purchase_id:
            event_key = f"purchase:{existing.purchase_id}"
            if buyer:
                create_notification(
                    recipient_id=buyer.user_id,
                    actor_id=seller.user_id if seller else None,
                    event_type="purchase_completed",
                    event_key=f"{event_key}:buyer",
                    title="Purchase completed",
                    body=f"Your purchase for {post.title if post else 'a listing'} is complete.",
                    action_url="/purchases",
                    payload={
                        "purchase_id": existing.purchase_id,
                        "post_id": post_id,
                        "role": "buyer",
                    },
                )
            if seller:
                create_notification(
                    recipient_id=seller.user_id,
                    actor_id=buyer.user_id if buyer else None,
                    event_type="purchase_completed",
                    event_key=f"{event_key}:seller",
                    title="Listing sold",
                    body=f"Your listing {post.title if post else 'a listing'} has been purchased.",
                    action_url=f"/post/{post_id}",
                    payload={
                        "purchase_id": existing.purchase_id,
                        "post_id": post_id,
                        "role": "seller",
                    },
                )
        if changed:
            db.session.commit()
        else:
            db.session.commit()
        return existing

    if not post or post.is_sold:
        return None

    purchase = Purchase(
        post_id=post_id,
        buyer_id=buyer_id,
        stripe_session_id=session_id,
        amount=(amount_total / 100.0) if amount_total is not None else None,
    )
    db.session.add(purchase)

    post.is_sold = True
    db.session.flush()
    buyer = User.query.get(buyer_id)
    seller = post.user if post else None
    if purchase.purchase_id:
        event_key = f"purchase:{purchase.purchase_id}"
        if buyer:
            create_notification(
                recipient_id=buyer.user_id,
                actor_id=seller.user_id if seller else None,
                event_type="purchase_completed",
                event_key=f"{event_key}:buyer",
                title="Purchase completed",
                body=f"Your purchase for {post.title if post else 'a listing'} is complete.",
                action_url="/purchases",
                payload={
                    "purchase_id": purchase.purchase_id,
                    "post_id": post_id,
                    "role": "buyer",
                },
            )
        if seller:
            create_notification(
                recipient_id=seller.user_id,
                actor_id=buyer.user_id if buyer else None,
                event_type="purchase_completed",
                event_key=f"{event_key}:seller",
                title="Listing sold",
                body=f"Your listing {post.title if post else 'a listing'} has been purchased.",
                action_url=f"/post/{post_id}",
                payload={
                    "purchase_id": purchase.purchase_id,
                    "post_id": post_id,
                    "role": "seller",
                },
            )

    db.session.commit()
    return purchase
