import { Link } from "react-router-dom";
import "../styles/TransactionPage.css";

export default function CancelPage() {
  return (
    <div className="transaction-page">
      <div className="transaction-card card">
        <p className="eyebrow">Payment</p>
        <h1>Payment canceled</h1>
        <p className="muted">
          Nothing was charged. You can go back to the listing and try again whenever you are
          ready.
        </p>
        <div className="transaction-actions">
          <Link className="primary-action" to="/browse">
            Back to browse
          </Link>
          <Link className="secondary-action" to="/purchases">
            View purchases
          </Link>
        </div>
      </div>
    </div>
  );
}
