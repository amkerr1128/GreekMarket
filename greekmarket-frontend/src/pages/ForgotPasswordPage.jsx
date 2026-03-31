import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { requestPasswordReset } from "../api/passwordRecovery";
import { getAuthErrorMessage } from "../utils/authErrors";
import {
  loadPendingPasswordReset,
  savePendingPasswordReset,
} from "../utils/pendingPasswordReset";
import { extractPasswordResetSession } from "../utils/passwordResetSession";
import "../styles/RecoveryPage.css";

export default function ForgotPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pendingReset = useMemo(() => loadPendingPasswordReset() || {}, []);
  const [email, setEmail] = useState(
    location.state?.email || pendingReset.email || ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const { data } = await requestPasswordReset({ email: email.trim() });
      const nextSession = savePendingPasswordReset(
        extractPasswordResetSession(data, { email: email.trim() })
      );

      navigate("/reset-password", {
        replace: true,
        state: { pendingReset: nextSession },
      });
    } catch (err) {
      setError(
        getAuthErrorMessage(
          err,
          "We could not start the password reset right now. Double-check the email and try again."
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="recovery-stack">
        <section className="recovery-card card">
          <div className="auth-brand">
            <img src="/MiniLogo.png" alt="GreekMarket" className="auth-logo" />
            <div>
              <p className="auth-brand-label">GreekMarket</p>
              <span>Account recovery</span>
            </div>
          </div>

          <p className="recovery-eyebrow">Recover access</p>
          <h1 className="recovery-title">Reset your password without waiting on support.</h1>
          <p className="recovery-copy">
            Enter the email attached to your account. We&apos;ll send the next
            step there so you can create a new password and get back in quickly.
          </p>

          <div className="recovery-journey">
            <div className="recovery-journey-step active">
              <span>1</span>
              <div>
                <strong>Request reset</strong>
                <p>Tell us which email to use.</p>
              </div>
            </div>
            <div className="recovery-journey-step">
              <span>2</span>
              <div>
                <strong>Confirm the code</strong>
                <p>Use the email link or reset code we send.</p>
              </div>
            </div>
            <div className="recovery-journey-step">
              <span>3</span>
              <div>
                <strong>Choose a new password</strong>
                <p>Save it and head straight back to login.</p>
              </div>
            </div>
          </div>

          <form className="recovery-form" onSubmit={handleSubmit}>
            <label className="recovery-field">
              <span>Account email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>

            <button type="submit" className="primary-btn" disabled={submitting}>
              {submitting ? "Sending reset instructions..." : "Send reset instructions"}
            </button>
          </form>

          {error ? <p className="recovery-status error">{error}</p> : null}

          <div className="recovery-note">
            <strong>What happens next?</strong>
            <span>
              If the email matches an account, you&apos;ll land on the reset screen next
              and can finish everything there. If you already started earlier, you can
              continue from the link below.
            </span>
          </div>

          <div className="recovery-links">
            <Link to="/login">Back to login</Link>
            {pendingReset?.reset_id || pendingReset?.token ? (
              <Link to="/reset-password">Continue reset</Link>
            ) : (
              <Link to="/signup">Create account</Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
