import os

from flask import jsonify, request
from flask_jwt_extended import jwt_required

import stripe

from .. import db
from ..models import Post, Purchase, User
from ..services.rate_limit import key_by_user_or_ip, rate_limit
from ..utils import to_int
from . import bp
from .common import (
    current_user_id,
    post_visible_to_viewer,
    serialize_user,
    user_has_verified_contact,
    viewer_allowed_chapter_ids,
)
from ..services.payments import (
    account_refresh_url,
    account_return_url,
    checkout_session_details,
    checkout_cancel_url,
    checkout_success_url,
    find_purchase_for_checkout,
    record_completed_checkout,
    seller_payout_ready,
)

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")


@bp.route("/create-checkout-session", methods=["POST"])
@jwt_required()
@rate_limit("payments_checkout", 40, 3600, key_func=key_by_user_or_ip)
def create_checkout_session():
    data = request.get_json() or {}
    post_id = to_int(data.get("post_id"))

    me = current_user_id()
    buyer = User.query.get(me)
    post = Post.query.get(post_id) if post_id else None
    seller = post.user if post else None

    if not buyer:
        return jsonify({"error": "User not found"}), 404
    if not post:
        return jsonify({"error": "Post not found"}), 404
    if not post_visible_to_viewer(post, me, viewer=buyer, allowed_chapter_ids=viewer_allowed_chapter_ids(me)):
        return jsonify({"error": "Post not found"}), 404
    if not user_has_verified_contact(buyer):
        return jsonify({"error": "Verify your email or phone before making a purchase"}), 403
    if not stripe.api_key:
        return jsonify({"error": "Stripe is not configured"}), 503
    if post.is_sold:
        return jsonify({"error": "This post is already sold"}), 400
    if post.user_id == me:
        return jsonify({"error": "You cannot buy your own post"}), 400
    if not seller:
        return jsonify({"error": "Post seller not found"}), 404
    payout_ready, payout_error = seller_payout_ready(seller)
    if not payout_ready:
        return jsonify({"error": payout_error}), 400

    unit_price = post.price
    if unit_price is None:
        unit_price = data.get("price")
    if unit_price in (None, ""):
        return jsonify({"error": "Post price is missing"}), 400

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            customer_email=buyer.email if buyer else None,
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {"name": post.title},
                        "unit_amount": int(float(unit_price) * 100),
                    },
                    "quantity": 1,
                }
            ],
            mode="payment",
            payment_intent_data={
                "transfer_data": {"destination": seller.stripe_account_id},
            },
            success_url=checkout_success_url(),
            cancel_url=checkout_cancel_url(),
            metadata={
                "post_id": str(post_id),
                "buyer_id": str(me),
                "seller_id": str(seller.user_id),
            },
        )
        return jsonify({"checkout_url": session.url})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/create-account-link", methods=["POST"])
@jwt_required()
@rate_limit("payments_account_link", 30, 3600, key_func=key_by_user_or_ip)
def create_account_link():
    if not stripe.api_key:
        return jsonify({"error": "Stripe is not configured"}), 503

    me = current_user_id()
    user = User.query.get(me)
    if not user:
        return jsonify({"error": "User not found"}), 404

    if not user.stripe_account_id:
        account = stripe.Account.create(type="express")
        user.stripe_account_id = account.id
        db.session.commit()
    else:
        account = stripe.Account.retrieve(user.stripe_account_id)

    link = stripe.AccountLink.create(
        account=account.id,
        refresh_url=account_refresh_url(),
        return_url=account_return_url(),
        type="account_onboarding",
    )
    return jsonify({"url": link.url})


@bp.route("/webhook", methods=["POST"])
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get("Stripe-Signature")
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    if not webhook_secret:
        return jsonify({"error": "Stripe webhook is not configured"}), 503

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except ValueError:
        return jsonify({"error": "Invalid payload"}), 400
    except stripe.error.SignatureVerificationError:
        return jsonify({"error": "Invalid signature"}), 400

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        record_completed_checkout(session)

    return jsonify({"status": "success"}), 200


@bp.route("/checkout-session-status", methods=["GET"])
@jwt_required()
@rate_limit("payments_session_status", 120, 600, key_func=key_by_user_or_ip)
def checkout_session_status():
    if not stripe.api_key:
        return jsonify({"error": "Stripe is not configured"}), 503

    session_id = (request.args.get("session_id") or "").strip()
    if not session_id:
        return jsonify({"error": "Missing session_id"}), 400

    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.InvalidRequestError:
        return jsonify({"error": "Checkout session not found"}), 404
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    details = checkout_session_details(session)
    buyer_id = details["buyer_id"]
    post_id = details["post_id"]
    me = current_user_id()

    if buyer_id is None:
        return jsonify({"error": "Checkout session is missing buyer metadata"}), 400
    if buyer_id != me:
        return jsonify({"error": "This checkout session does not belong to the current user"}), 403

    purchase = record_completed_checkout(session)
    if not purchase:
        purchase = find_purchase_for_checkout(post_id, buyer_id, session_id)

    post = Post.query.get(post_id) if post_id else None
    amount = purchase.amount if purchase and purchase.amount is not None else None
    if amount is None and details["amount_total"] is not None:
        amount = details["amount_total"] / 100.0

    return jsonify(
        {
            "session_id": session_id,
            "session_status": details["session_status"],
            "payment_status": details["payment_status"],
            "is_paid": details["payment_status"] == "paid",
            "post_id": post.post_id if post else post_id,
            "listing_title": post.title if post else None,
            "is_sold": bool(post.is_sold) if post else False,
            "purchase_id": purchase.purchase_id if purchase else None,
            "amount": amount,
            "purchased_at": purchase.purchased_at.isoformat() if purchase else None,
        }
    ), 200


@bp.route("/my-purchases", methods=["GET"])
@jwt_required()
def get_my_purchases():
    me = current_user_id()
    purchases = Purchase.query.filter_by(buyer_id=me).order_by(Purchase.purchased_at.desc()).all()
    results = []
    for purchase in purchases:
        post = purchase.post
        if not post:
            continue
        seller = post.user
        results.append(
            {
                "purchase_id": purchase.purchase_id,
                "post_id": post.post_id,
                "title": post.title,
                "price": post.price,
                "image_url": post.images[0].url if post.images else None,
                "purchased_at": purchase.purchased_at.isoformat(),
                "seller": serialize_user(seller) if seller else None,
            }
        )
    return jsonify(results), 200
