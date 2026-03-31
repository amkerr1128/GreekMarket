import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import API from "../api/axios";
import "../styles/StripeAccountPage.css";

export default function StripeAccountPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const autoLaunchRef = useRef(false);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  const launchAccountLink = useCallback(async () => {
    try {
      setLaunching(true);
      setError("");
      const { data } = await API.post("/create-account-link");
      if (!data?.url) throw new Error("Missing Stripe account link.");
      window.location.assign(data.url);
    } catch (err) {
      if (err?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setError(err?.response?.data?.error || err?.message || "Failed to start account setup.");
    } finally {
      setLaunching(false);
    }
  }, [navigate]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        setLoading(true);
        const { data } = await API.get("/me");
        if (!active) return;
        setProfile(data);
      } catch (err) {
        if (!active) return;
        if (err?.response?.status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }
        setError(err?.response?.data?.error || "Failed to load your account.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (loading || location.pathname !== "/reauth" || autoLaunchRef.current) return;
    autoLaunchRef.current = true;
    launchAccountLink();
  }, [launchAccountLink, loading, location.pathname]);

  return (
    <div className="stripe-page">
      <section className="stripe-card card">
        <p className="eyebrow">Seller payouts</p>
        <h1>{profile?.stripe_account_id ? "Finish your Stripe setup" : "Connect your Stripe account"}</h1>
        <p className="muted">
          Use Stripe to receive payouts for sold items. You will be redirected to Stripe to
          complete or resume your account setup.
        </p>

        <div className="stripe-state">
          {loading ? <span className="stripe-pill">Loading account...</span> : null}
          {profile?.stripe_account_id ? <span className="stripe-pill success">Setup in progress</span> : null}
        </div>

        {error ? <p className="stripe-error">{error}</p> : null}

        <div className="stripe-actions">
          <button className="primary-action" disabled={loading || launching} onClick={launchAccountLink}>
            {launching ? "Opening Stripe..." : profile?.stripe_account_id ? "Continue setup" : "Connect Stripe"}
          </button>
          <Link className="secondary-action" to="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
