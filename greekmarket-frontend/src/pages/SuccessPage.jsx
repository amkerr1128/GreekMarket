import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import API from "../api/axios";
import { useNotifications } from "../context/NotificationsContext";
import { isNetworkFailure } from "../utils/authErrors";
import "../styles/TransactionPage.css";

export default function SuccessPage() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [verifying, setVerifying] = useState(Boolean(sessionId));
  const [verificationError, setVerificationError] = useState("");
  const [checkoutResult, setCheckoutResult] = useState(null);
  const purchaseNotificationSent = useRef(false);
  const { pushNotification, refreshNotifications, remoteAvailable } = useNotifications();

  useEffect(() => {
    if (!sessionId) {
      setVerifying(false);
      return undefined;
    }

    let active = true;
    let attempt = 0;
    let timerId = null;

    async function confirmCheckout() {
      attempt += 1;
      try {
        const { data } = await API.get("/checkout-session-status", {
          params: { session_id: sessionId },
        });
        if (!active) return;

        setCheckoutResult(data);

        const confirmed = Boolean(data?.is_paid && (data?.is_sold || data?.purchase_id));
        if (confirmed) {
          if (!purchaseNotificationSent.current) {
            purchaseNotificationSent.current = true;
            if (remoteAvailable) {
              refreshNotifications();
            } else {
              pushNotification({
                type: "purchase",
                title: "Purchase completed",
                body: data?.listing_title || "Your order is confirmed and the listing was marked sold.",
                targetUrl: data?.post_id ? `/post/${data.post_id}` : "/purchases",
                sourceKey: `purchase:${sessionId || data?.purchase_id || Date.now()}`,
              });
            }
          }
          setVerificationError("");
          setVerifying(false);
          return;
        }

        if (attempt < 5 && (data?.payment_status === "paid" || data?.session_status === "complete")) {
          timerId = window.setTimeout(confirmCheckout, 1500);
          return;
        }

        setVerificationError(
          data?.payment_status === "paid"
            ? "Payment was received and we are finishing the order now. It should appear in your purchases shortly."
            : "Stripe is still finalizing this payment. Check your purchases again in a moment."
        );
        setVerifying(false);
      } catch (error) {
        if (!active) return;
        setVerificationError(
          isNetworkFailure(error)
            ? "We could not confirm the order with the server right now. Your payment may still finalize in a moment."
            : error?.response?.data?.error || "We could not confirm this checkout yet."
        );
        setVerifying(false);
      }
    }

    confirmCheckout();

    return () => {
      active = false;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [pushNotification, refreshNotifications, remoteAvailable, sessionId]);

  const amountLabel =
    typeof checkoutResult?.amount === "number" ? `$${Number(checkoutResult.amount).toFixed(2)}` : null;

  return (
    <div className="transaction-page">
      <div className="transaction-card card">
        <p className="eyebrow">Payment</p>
        <h1>{verifying ? "Finalizing your purchase" : "Payment successful"}</h1>
        <p className="muted">
          {verifying
            ? "We are confirming the Stripe payment and locking the listing so it shows as sold."
            : "Your purchase was completed and the listing is being synced into your order history."}
        </p>
        {checkoutResult ? (
          <div className={`transaction-status ${checkoutResult?.is_paid ? "success" : "pending"}`}>
            <strong>{checkoutResult?.listing_title || "Purchase details"}</strong>
            <span>
              {checkoutResult?.is_sold
                ? "Listing marked sold automatically."
                : "Listing status is still syncing."}
            </span>
            {amountLabel ? <span>Charged: {amountLabel}</span> : null}
          </div>
        ) : null}
        {verificationError ? <p className="transaction-warning">{verificationError}</p> : null}
        {sessionId ? <p className="transaction-note">Confirmation: {sessionId}</p> : null}
        <div className="transaction-actions">
          <Link className="primary-action" to="/purchases">
            View purchases
          </Link>
          {checkoutResult?.post_id ? (
            <Link className="secondary-action" to={`/post/${checkoutResult.post_id}`}>
              View listing
            </Link>
          ) : null}
          <Link className="secondary-action" to="/browse">
            Back to browse
          </Link>
        </div>
      </div>
    </div>
  );
}
