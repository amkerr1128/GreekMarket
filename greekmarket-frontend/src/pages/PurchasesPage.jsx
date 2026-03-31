import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import API from "../api/axios";
import Avatar from "../components/Avatar";
import { isNetworkFailure } from "../utils/authErrors";
import { LISTING_PLACEHOLDER, resolveListingImage } from "../utils/listingImages";
import "../styles/PurchasesPage.css";

function PurchasesPage() {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const fetchPurchases = async () => {
      try {
        setError("");
        const response = await API.get("/my-purchases");
        if (!active) return;
        setPurchases(response.data || []);
      } catch (err) {
        if (!active) return;
        setPurchases([]);
        setError(
          isNetworkFailure(err)
            ? "Your purchase history could not be loaded right now. The backend may be offline or blocked by CORS."
            : err?.response?.data?.error || "Failed to load purchases."
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchPurchases();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (loading) {
    return (
      <div className="purchases-page">
        <div className="purchases-hero card">
          <p className="eyebrow">Purchases</p>
          <h1>Loading purchases...</h1>
          <p className="muted">Pulling in your recent transactions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="purchases-page">
      <section className="purchases-hero card">
        <div>
          <p className="eyebrow">Purchases</p>
          <h1>Your purchases</h1>
          <p className="muted">A clean view of what you've bought and from whom.</p>
        </div>
        <Link className="pill-link" to="/browse">
          Browse more
        </Link>
      </section>

      {error ? (
        <div className="purchases-alert card">
          <strong>We could not load your purchase history</strong>
          <p>{error}</p>
          <p>Retry first. If the problem keeps happening, browse listings normally and come back once the connection stabilizes.</p>
        </div>
      ) : null}
      {error ? (
        <div className="purchases-error-actions">
          <button type="button" className="pill-link primary" onClick={() => setReloadKey((current) => current + 1)}>
            Retry purchases
          </button>
          <Link className="pill-link" to="/browse">
            Browse listings
          </Link>
        </div>
      ) : null}

      {purchases.length === 0 ? (
        <div className="purchases-empty card">
          <h3>You have not purchased anything yet.</h3>
          <p>When you buy something through a listing, the order will appear here automatically with the seller and purchase date.</p>
          <div className="purchases-error-actions">
            <Link className="pill-link primary" to="/browse">
              Browse listings
            </Link>
            <Link className="pill-link" to="/messages">
              Open messages
            </Link>
          </div>
        </div>
      ) : (
        <div className="purchase-list">
          {purchases.map((purchase) => (
            <Link
              key={purchase.purchase_id}
              className="purchase-card card"
              to={`/post/${purchase.post_id}`}
            >
              <div className="purchase-media">
                <img
                  src={resolveListingImage(purchase.image_url)}
                  alt={purchase.title}
                  onError={(event) => {
                    const image = event.currentTarget;
                    if (image.dataset.fallbackApplied === "true") return;
                    image.dataset.fallbackApplied = "true";
                    image.src = LISTING_PLACEHOLDER;
                  }}
                />
              </div>
              <div className="purchase-info">
                <div className="purchase-topline">
                  <h3>{purchase.title}</h3>
                  <span className="purchase-price">${Number(purchase.price || 0).toFixed(2)}</span>
                </div>
                <div className="purchase-seller">
                  <Avatar
                    size="sm"
                    user={{
                      first_name: purchase.seller?.first_name,
                      last_name: purchase.seller?.last_name,
                      handle: purchase.seller?.handle,
                      profile_picture_url: purchase.seller?.profile_picture_url,
                    }}
                  />
                  <div>
                    <div className="seller-name">
                      {purchase.seller?.first_name || purchase.seller?.last_name
                        ? `${purchase.seller?.first_name || ""} ${purchase.seller?.last_name || ""}`.trim()
                        : "Seller"}
                    </div>
                    <div className="muted">
                      {purchase.seller?.handle ? `@${purchase.seller.handle}` : "Handle unavailable"}
                    </div>
                  </div>
                </div>
                <p className="purchase-date">
                  Purchased on {new Date(purchase.purchased_at).toLocaleDateString()}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default PurchasesPage;
