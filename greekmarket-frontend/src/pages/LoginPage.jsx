import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import API from "../api/axios";
import { getAuthErrorMessage } from "../utils/authErrors";
import { getNextSetupRoute } from "../utils/accountJourney";
import { loadPendingPasswordReset } from "../utils/pendingPasswordReset";
import { loadPendingVerification } from "../utils/pendingVerification";
import { saveAccountSession } from "../utils/savedAccounts";
import "../styles/LoginPage.css";

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const pendingReset = useMemo(() => loadPendingPasswordReset() || {}, []);

  useEffect(() => {
    if (location.state?.passwordResetSuccess) {
      setInfo("Password updated. Log in with the new password whenever you're ready.");
      if (location.state?.email) {
        setEmail(location.state.email);
      }
    }
  }, [location.state]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setSubmitting(true);

    try {
      const { data } = await API.post("/login", { email, password });
      localStorage.setItem("token", data.access_token);

      try {
        const { data: me } = await API.get("/me");
        saveAccountSession({ token: data.access_token, user: me, email });
        navigate(getNextSetupRoute(me), { replace: true });
        return;
      } catch {
        // Keep the login flow moving even if the profile hydration request fails.
      }

      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(
        getAuthErrorMessage(
          err,
          "Login failed. Please check your email and password."
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-stack">
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-brand">
            <img src="/MiniLogo.png" alt="GreekMarket" className="auth-logo" />
            <div>
              <p className="auth-brand-label">GreekMarket</p>
              <span>Campus marketplace</span>
            </div>
          </div>

          <h2>Welcome back</h2>
          <p className="auth-hint">
            Log in to browse listings, manage posts, and keep conversations moving.
          </p>

          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button type="submit" disabled={submitting}>
            {submitting ? "Logging in..." : "Log In"}
          </button>

          {error && <div className="error">{error}</div>}
          {info && <div className="auth-info">{info}</div>}

          <div className="links">
            <button
              type="button"
              onClick={() =>
                navigate("/forgot-password", {
                  state: { email },
                })
              }
            >
              Forgot Password?
            </button>
            {loadPendingVerification()?.registration_id ? (
              <Link to="/verify">Continue verification</Link>
            ) : null}
            {pendingReset?.reset_id || pendingReset?.token ? (
              <Link to="/reset-password">Continue password reset</Link>
            ) : null}
            <Link to="/signup">Create account</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
