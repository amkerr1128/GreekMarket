import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  confirmPasswordReset,
  loadPasswordResetStatus,
  resendPasswordReset,
} from "../api/passwordRecovery";
import { getAuthErrorMessage } from "../utils/authErrors";
import {
  clearPendingPasswordReset,
  loadPendingPasswordReset,
  savePendingPasswordReset,
} from "../utils/pendingPasswordReset";
import {
  extractPasswordResetSession,
  hasPasswordResetSession,
} from "../utils/passwordResetSession";
import "../styles/RecoveryPage.css";

function getInitialSession(locationState, searchParams) {
  const stored = loadPendingPasswordReset() || {};
  return extractPasswordResetSession(locationState?.pendingReset || {}, {
    ...stored,
    reset_id: searchParams.get("reset_id") || stored.reset_id,
    token: searchParams.get("token") || stored.token,
    email: searchParams.get("email") || stored.email,
  });
}

export default function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSession = useMemo(
    () => getInitialSession(location.state, searchParams),
    [location.state, searchParams]
  );

  const [session, setSession] = useState(initialSession);
  const [email, setEmail] = useState(initialSession.email || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const usingSecureLink = Boolean(session.token);

  const syncSession = useCallback((nextValues = {}) => {
    const nextSession = savePendingPasswordReset(
      extractPasswordResetSession(nextValues, session)
    );
    setSession(nextSession || extractPasswordResetSession(nextValues, session));
    return nextSession;
  }, [session]);

  useEffect(() => {
    if (!session.reset_id && !session.token) {
      return undefined;
    }

    if (session.contact_value || session.preview_code) {
      return undefined;
    }

    let active = true;

    (async () => {
      setLoadingStatus(true);
      try {
        const { data } = await loadPasswordResetStatus({
          params: {
            reset_id: session.reset_id,
            token: session.token,
            email: session.email,
          },
        });

        if (!active) return;
        const nextSession = syncSession(data);
        if (nextSession?.email && !email) {
          setEmail(nextSession.email);
        }
      } catch (err) {
        if (!active) return;
        setError(
          getAuthErrorMessage(
            err,
            "We could not restore this reset session. Start over if the code or link may have expired."
          )
        );
      } finally {
        if (active) setLoadingStatus(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [email, session.contact_value, session.email, session.preview_code, session.reset_id, session.token, syncSession]);

  async function handleResend() {
    setResending(true);
    setError("");
    setStatus("");

    try {
      if (!email.trim() && !session.email) {
        throw new Error("Add the account email before requesting another reset code.");
      }

      const { data } = await resendPasswordReset({
        reset_id: session.reset_id,
        token: session.token,
        email: email.trim() || session.email,
      });
      const nextSession = syncSession(data);
      setEmail(nextSession?.email || email);
      setStatus(
        data?.message || "A fresh password reset code is on the way."
      );
    } catch (err) {
      setError(
        err instanceof Error && !err.response
          ? err.message
          : getAuthErrorMessage(
              err,
              "We could not resend the reset instructions right now."
            )
      );
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (password.length < 8) {
      setError("Use at least 8 characters so the new password is strong enough.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The new password and confirmation do not match yet.");
      return;
    }

    if (!usingSecureLink && !code.trim()) {
      setError("Enter the reset code from your email before saving the new password.");
      return;
    }

    setSubmitting(true);

    try {
      const { data } = await confirmPasswordReset({
        reset_id: session.reset_id,
        token: session.token,
        email: email.trim() || session.email,
        code: code.trim(),
        password,
        password_confirmation: confirmPassword,
      });

      clearPendingPasswordReset();
      setStatus(data?.message || "Password updated. You can log in with the new password now.");
      navigate("/login", {
        replace: true,
        state: {
          passwordResetSuccess: true,
          email: email.trim() || session.email,
        },
      });
    } catch (err) {
      setError(
        getAuthErrorMessage(
          err,
          "That reset code or link could not be used. Request a fresh reset and try again."
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
              <span>Password reset</span>
            </div>
          </div>

          <p className="recovery-eyebrow">Finish recovery</p>
          <h1 className="recovery-title">Create a new password and get back in.</h1>
          <p className="recovery-copy">
            Use the reset code or secure link we sent, choose a new password, and head
            straight back to login. If the session expires, request a fresh one below.
          </p>

          <div className="recovery-split">
            <div className="recovery-note">
              <strong>{usingSecureLink ? "Secure link detected" : "Reset destination"}</strong>
              <span>
                {usingSecureLink
                  ? "You opened this page from a secure reset link. You can set a new password right away."
                  : session.contact_value || email || "The account email will appear here once the reset session starts."}
              </span>
            </div>

            <div className="recovery-note">
              <strong>Need a new code?</strong>
              <span>
                If the email never arrived or the code expired, resend it here instead of starting over from scratch.
              </span>
            </div>
          </div>

          {!hasPasswordResetSession(session) ? (
            <div className="recovery-empty">
              <strong>Start by requesting a reset.</strong>
              <p>
                There isn&apos;t an active password reset session on this device right now.
                Go back, enter your account email, and we&apos;ll guide you through the rest.
              </p>
              <div className="recovery-links">
                <Link to="/forgot-password">Request password reset</Link>
                <Link to="/login">Back to login</Link>
              </div>
            </div>
          ) : (
            <>
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

                {!usingSecureLink ? (
                  <label className="recovery-field">
                    <span>Reset code</span>
                    <input
                      type="text"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Enter the code from your email"
                      required={!usingSecureLink}
                    />
                  </label>
                ) : null}

                <div className="recovery-password-grid">
                  <label className="recovery-field">
                    <span>New password</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      required
                    />
                  </label>

                  <label className="recovery-field">
                    <span>Confirm password</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Repeat the new password"
                      required
                    />
                  </label>
                </div>

                <div className="recovery-actions">
                  <button type="submit" className="primary-btn" disabled={submitting || loadingStatus}>
                    {submitting ? "Updating password..." : "Save new password"}
                  </button>
                  <button type="button" onClick={handleResend} disabled={resending}>
                    {resending ? "Sending new code..." : "Resend reset code"}
                  </button>
                </div>
              </form>

              {session.preview_code ? (
                <div className="recovery-note recovery-preview">
                  <strong>Development preview code</strong>
                  <span>{session.preview_code}</span>
                </div>
              ) : null}
            </>
          )}

          {status ? <p className="recovery-status success">{status}</p> : null}
          {error ? <p className="recovery-status error">{error}</p> : null}

          <div className="recovery-links">
            <Link to="/forgot-password">Start over</Link>
            <Link to="/login">Back to login</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
