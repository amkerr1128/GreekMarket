import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import API from "../api/axios";
import { confirmVerification, loadVerificationStatus, resendVerification, startVerification } from "../api/verification";
import AccountCompletionCard from "../components/AccountCompletionCard";
import { getAuthErrorMessage } from "../utils/authErrors";
import { getAccountCompletionState, getNextSetupRoute } from "../utils/accountJourney";
import {
  clearPendingVerification,
  loadPendingVerification,
  savePendingVerification,
} from "../utils/pendingVerification";
import { saveAccountSession } from "../utils/savedAccounts";
import "../styles/VerificationPage.css";

const CONTACT_OPTIONS = [
  { value: "email", label: "Email", meta: "Send the code to your inbox" },
  { value: "phone", label: "Phone", meta: "Send the code by text message" },
];

function getStoredToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("token") || "";
}

export default function VerificationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);
  const [stepError, setStepError] = useState("");
  const [stepStatus, setStepStatus] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");

  const initialPending = useMemo(
    () => location.state?.pendingVerification || loadPendingVerification() || {},
    [location.state?.pendingVerification]
  );

  const [pendingState, setPendingState] = useState(initialPending);
  const [contactMethod, setContactMethod] = useState(
    String(
      initialPending.preferred_contact_method ||
        initialPending.contact_method ||
        "email"
    ).toLowerCase()
  );
  const [contactEmail, setContactEmail] = useState(initialPending.email || "");
  const [contactPhone, setContactPhone] = useState(initialPending.phone || "");
  const [verificationId, setVerificationId] = useState(
    String(initialPending.verification_id || "")
  );
  const [previewCode, setPreviewCode] = useState(initialPending.preview_code || "");
  const [contactHint, setContactHint] = useState(initialPending.contact_value || "");
  const [hasSession, setHasSession] = useState(Boolean(getStoredToken()));

  const signupMode = !hasSession && Boolean(
    pendingState.registration_id || pendingState.signup_payload?.email
  );

  const currentTarget = useMemo(() => {
    if (contactMethod === "phone") return contactPhone.trim();
    return contactEmail.trim();
  }, [contactEmail, contactMethod, contactPhone]);

  const syncPendingState = useCallback((nextValues = {}) => {
    const merged = savePendingVerification({
      ...(pendingState || {}),
      ...(nextValues || {}),
    }) || {
      ...(pendingState || {}),
      ...(nextValues || {}),
    };
    setPendingState(merged);
    return merged;
  }, [pendingState]);

  const applyVerificationPayload = useCallback((payload = {}, extra = {}) => {
    const nested = payload?.verification || {};
    const nextVerificationId = String(
      nested.verification_id || payload.verification_id || extra.verification_id || ""
    );
    const nextPreviewCode = payload.preview_code || nested.preview_code || "";
    const nextContactMethod =
      payload.preferred_method ||
      payload.contact_method ||
      nested.contact_method ||
      extra.contact_method ||
      contactMethod;
    const nextContactHint =
      payload.contact_value || nested.contact_value || extra.contact_value || contactHint;
    const nextRegistrationId =
      payload.registration_id || extra.registration_id || pendingState.registration_id || "";

    if (nextVerificationId) setVerificationId(nextVerificationId);
    if (nextPreviewCode || previewCode) setPreviewCode(nextPreviewCode);
    if (nextContactMethod) setContactMethod(String(nextContactMethod).toLowerCase());
    if (nextContactHint) setContactHint(nextContactHint);

    syncPendingState({
      ...extra,
      registration_id: nextRegistrationId,
      verification_id: nextVerificationId || verificationId,
      preview_code: nextPreviewCode || previewCode,
      preferred_contact_method: nextContactMethod,
      contact_method: nextContactMethod,
      contact_value: nextContactHint,
      expires_at: nested.expires_at || payload.expires_at || pendingState.expires_at,
      verification_status: nested.status || payload.status || pendingState.verification_status || "pending",
    });
  }, [
    contactHint,
    contactMethod,
    pendingState.expires_at,
    pendingState.registration_id,
    pendingState.verification_status,
    previewCode,
    syncPendingState,
    verificationId,
  ]);

  useEffect(() => {
    if (!hasSession && !signupMode) {
      navigate("/signup", { replace: true });
    }
  }, [hasSession, navigate, signupMode]);

  useEffect(() => {
    if (signupMode && pendingState.registration_id && (!verificationId || !contactHint)) {
      let active = true;

      (async () => {
        setLoadingPending(true);
        try {
          const { data } = await loadVerificationStatus({
            params: { registration_id: pendingState.registration_id },
          });
          if (!active) return;
          applyVerificationPayload(data?.verification, {
            registration_id: pendingState.registration_id,
          });
        } catch (error) {
          if (!active) return;
          setStepError(
            getAuthErrorMessage(
              error,
              "We could not restore your verification session. Start signup again if this keeps happening."
            )
          );
        } finally {
          if (active) setLoadingPending(false);
        }
      })();

      return () => {
        active = false;
      };
    }

    return undefined;
  }, [applyVerificationPayload, contactHint, pendingState.registration_id, signupMode, verificationId]);

  useEffect(() => {
    if (!hasSession) return undefined;

    let active = true;

    (async () => {
      setLoadingProfile(true);
      try {
        const { data } = await API.get("/me");
        if (!active) return;
        const completionState = getAccountCompletionState(data);
        if (completionState.contactComplete || !completionState.hasVerificationSignal) {
          navigate("/dashboard", { replace: true });
          return;
        }
        setProfile(data);
        saveAccountSession({
          token: getStoredToken(),
          user: data,
          email: data.email,
        });
        if (!contactEmail && data?.email) {
          setContactEmail(data.email);
        }
      } catch (error) {
        if (!active) return;
        if (error?.response?.status === 401) {
          localStorage.removeItem("token");
          setHasSession(false);
          setProfile(null);
          if (!signupMode) {
            navigate("/login", { replace: true });
          }
          return;
        }
        setStepError(getAuthErrorMessage(error, "Could not load your account details."));
      } finally {
        if (active) setLoadingProfile(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [contactEmail, hasSession, navigate, signupMode]);

  async function handleSendCode() {
    setSendingCode(true);
    setStepError("");
    setStepStatus("");

    try {
      if (signupMode) {
        if (!pendingState.registration_id) {
          throw new Error("Missing pending registration.");
        }
        const { data } = await resendVerification({
          registration_id: pendingState.registration_id,
          verification_id: verificationId || undefined,
        });
        applyVerificationPayload(data?.verification, {
          registration_id: pendingState.registration_id,
          email: pendingState.email,
          phone: pendingState.phone,
          preferred_contact_method: pendingState.preferred_contact_method || contactMethod,
        });
        setStepStatus(data?.message || "A fresh verification code is on the way.");
      } else {
        if (!currentTarget) {
          throw new Error(
            contactMethod === "phone"
              ? "Add a phone number before requesting a text code."
              : "Add an email before requesting a code."
          );
        }
        const { data } = await startVerification({
          contact_method: contactMethod,
          contact_value: currentTarget,
        });
        applyVerificationPayload(data?.verification, {
          email: contactEmail,
          phone: contactPhone,
          preferred_contact_method: contactMethod,
        });
        setStepStatus(data?.message || "Verification code sent.");
      }
    } catch (error) {
      setStepError(
        error instanceof Error && !error.response
          ? error.message
          : getAuthErrorMessage(
              error,
              "Could not send the verification code right now. Please try again."
            )
      );
    } finally {
      setSendingCode(false);
    }
  }

  async function handleConfirmCode(event) {
    event.preventDefault();
    setVerifyingCode(true);
    setStepError("");
    setStepStatus("");

    try {
      if (!verificationId) {
        throw new Error("Send a verification code first.");
      }

      const { data } = await confirmVerification({
        verification_id: Number(verificationId),
        code: verificationCode.trim(),
      });

      const nextToken = data?.access_token || getStoredToken();
      if (data?.access_token) {
        localStorage.setItem("token", data.access_token);
        setHasSession(true);
      }

      let nextUser = data?.user || null;
      if (!nextUser && (data?.access_token || hasSession)) {
        try {
          const { data: me } = await API.get("/me");
          nextUser = me;
        } catch {
          // Keep the flow moving even if the follow-up profile request fails.
        }
      }

      if (nextUser) {
        saveAccountSession({
          token: nextToken,
          user: nextUser,
          email: nextUser.email || pendingState.email,
        });
        setProfile(nextUser);
      }

      clearPendingVerification();
      setPendingState({});
      setPreviewCode("");
      setContactHint("");
      setStepStatus(data?.message || "Verification complete.");

      const nextRoute = getNextSetupRoute(nextUser || profile || {}, { forceVerification: false });
      navigate(nextRoute === "/verify" ? "/dashboard" : nextRoute, { replace: true });
    } catch (error) {
      setStepError(
        error instanceof Error && !error.response
          ? error.message
          : getAuthErrorMessage(
              error,
              "That verification code did not work. Check it and try again."
            )
      );
    } finally {
      setVerifyingCode(false);
    }
  }

  function handleChecklistAction(item) {
    switch (item.actionKey) {
      case "verify":
        document.getElementById("verification-code-input")?.focus();
        break;
      case "school":
        navigate("/onboarding");
        break;
      case "chapter":
        navigate("/search");
        break;
      case "photo":
        navigate("/dashboard");
        break;
      case "stripe":
        navigate("/account");
        break;
      default:
        navigate("/dashboard");
    }
  }

  const previewTarget = signupMode
    ? contactHint || (contactMethod === "phone" ? pendingState.phone : pendingState.email) || "your chosen contact"
    : currentTarget || contactHint || profile?.email || "your chosen contact";

  if (!signupMode && !hasSession && !loadingProfile) {
    return null;
  }

  return (
    <div className="verification-shell">
      <section className="verification-hero card">
        <div>
          <p className="eyebrow">{signupMode ? "Finish signup" : "Complete account verification"}</p>
          <h1>{signupMode ? "Verify your contact, then create the account." : "Verify your contact, then finish setup."}</h1>
          <p className="muted">
            {signupMode
              ? "Every new GreekMarket account now proves at least one real contact method before the profile is created."
              : "A verified contact keeps support, moderation, payouts, and account recovery much smoother as your profile grows."}
          </p>
        </div>

        <div className="verification-hero-steps">
          <div className={`verification-step ${signupMode ? "active" : profile?.contact_verification?.has_verified_contact ? "complete" : "active"}`}>
            <span>1</span>
            <div>
              <strong>Verify contact</strong>
              <p>Email or phone code</p>
            </div>
          </div>
          <div className={`verification-step ${!signupMode ? "active" : ""}`}>
            <span>2</span>
            <div>
              <strong>Finish onboarding</strong>
              <p>School, chapter, photo, Stripe</p>
            </div>
          </div>
        </div>
      </section>

      <div className="verification-grid">
        {signupMode ? (
          <section className="verification-card card">
            <div className="verification-card-head">
              <div>
                <p className="eyebrow">What happens next</p>
                <h2>Complete your first-time setup</h2>
                <p className="muted">
                  Once the code is accepted, your account is created and you&apos;ll be guided into school, chapter, profile, and payout setup.
                </p>
              </div>
            </div>

            <div className="verification-preview">
              <p className="verification-preview-label">New account</p>
              <strong>{pendingState.email || "Email pending"}</strong>
              <span>
                Handle: @{pendingState.signup_payload?.handle || "new-user"}{pendingState.signup_payload?.school_id ? " - School selected" : ""}
              </span>
            </div>
          </section>
        ) : (
          <AccountCompletionCard
            user={profile}
            compact
            title="Complete account verification"
            description="Use this checklist to finish everything a real buyer or seller account needs."
            onAction={handleChecklistAction}
          />
        )}

        <section className="verification-card card">
          <div className="verification-card-head">
            <div>
              <p className="eyebrow">Contact verification</p>
              <h2>{signupMode ? "Enter the code" : loadingProfile ? "Loading your account..." : "Verify a contact method"}</h2>
              <p className="muted">
                {signupMode
                  ? "Use the code we sent during signup. If you need a new one, resend it below."
                  : "Choose a contact method, send the code, and confirm it to strengthen account recovery and trust."}
              </p>
            </div>
            <span className="verification-chip">
              {contactMethod === "phone" ? "Text" : "Email"}
            </span>
          </div>

          {signupMode ? (
            <div className="verification-inline">
              <div className="verification-inline-copy">
                <strong>Code destination</strong>
                <span>{previewTarget}</span>
              </div>
              <button
                type="button"
                className="verification-secondary"
                onClick={handleSendCode}
                disabled={sendingCode || loadingPending}
              >
                {sendingCode ? "Sending..." : "Resend code"}
              </button>
            </div>
          ) : (
            <>
              <div className="verification-methods">
                {CONTACT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`verification-method ${contactMethod === option.value ? "active" : ""}`}
                    onClick={() => {
                      setContactMethod(option.value);
                      setStepError("");
                      setStepStatus("");
                    }}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.meta}</span>
                  </button>
                ))}
              </div>

              <div className="verification-contacts">
                <label className="verification-field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </label>
                <label className="verification-field">
                  <span>Phone</span>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                    placeholder="(555) 555-5555"
                    autoComplete="tel"
                  />
                </label>
              </div>

              <div className="verification-inline">
                <div className="verification-inline-copy">
                  <strong>We&apos;ll send the code to:</strong>
                  <span>{previewTarget}</span>
                </div>
                <button
                  type="button"
                  className="verification-secondary"
                  onClick={handleSendCode}
                  disabled={sendingCode || !previewTarget}
                >
                  {sendingCode ? "Sending..." : "Send code"}
                </button>
              </div>
            </>
          )}

          <form className="verification-code-form" onSubmit={handleConfirmCode}>
            <label className="verification-field">
              <span>Verification code</span>
              <input
                id="verification-code-input"
                type="text"
                inputMode="numeric"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                placeholder="Enter the code"
                autoComplete="one-time-code"
              />
            </label>

            <div className="verification-actions">
              <button
                type="submit"
                className="verification-primary"
                disabled={verifyingCode || !verificationCode.trim()}
              >
                {verifyingCode ? "Verifying..." : signupMode ? "Create account" : "Verify contact"}
              </button>
              {!signupMode ? (
                <button
                  type="button"
                  className="verification-secondary"
                  onClick={handleSendCode}
                  disabled={sendingCode || !previewTarget}
                >
                  Resend code
                </button>
              ) : null}
            </div>
          </form>

          {previewCode ? (
            <div className="verification-preview">
              <p className="verification-preview-label">Development preview code</p>
              <strong>{previewCode}</strong>
              <span>This appears only when the backend is running in a local preview mode without live delivery.</span>
            </div>
          ) : null}

          {stepStatus ? <p className="verification-status success">{stepStatus}</p> : null}
          {stepError ? <p className="verification-status error">{stepError}</p> : null}

          <div className="verification-footer">
            <Link className="verification-link" to={signupMode ? "/signup" : "/dashboard"}>
              {signupMode ? "Back to signup" : "Back to dashboard"}
            </Link>
            {!signupMode ? (
              <Link className="verification-link secondary" to="/account">
                Manage payouts
              </Link>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
