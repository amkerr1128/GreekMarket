import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import API from "../api/axios";
import FancySelect from "../components/FancySelect";
import { getAuthErrorMessage, isNetworkFailure } from "../utils/authErrors";
import { savePendingVerification } from "../utils/pendingVerification";
import "../styles/SignupPage.css";

function SignUpPage() {
  const [schools, setSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [schoolLoadError, setSchoolLoadError] = useState("");
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    handle: "",
    email: "",
    phone: "",
    password: "",
    school_id: "",
  });
  const [verificationMethod, setVerificationMethod] = useState("email");
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const schoolOptions = useMemo(
    () =>
      schools.map((school) => ({
        value: String(school.id),
        label: school.name,
        meta: school.domain || "Campus community",
      })),
    [schools]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      setLoadingSchools(true);
      setSchoolLoadError("");

      try {
        const { data } = await API.get("/schools");
        if (!active) return;
        setSchools(data || []);
        setForm((current) => {
          if (current.school_id || !data?.length) return current;
          return { ...current, school_id: String(data[0].id) };
        });
      } catch (err) {
        if (!active) return;
        const message = isNetworkFailure(err)
          ? "School list could not be loaded. The backend may be offline or blocked by CORS."
          : err?.response?.data?.error || "Failed to load schools.";
        setSchoolLoadError(message);
        setSchools([]);
      } finally {
        if (active) setLoadingSchools(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const onChange = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const onSubmit = async (event) => {
    event.preventDefault();
    setErrorMsg("");

    if (loadingSchools) {
      setErrorMsg("Wait for schools to finish loading before signing up.");
      return;
    }

    if (schoolLoadError) {
      setErrorMsg(schoolLoadError);
      return;
    }

    if (!form.school_id) {
      setErrorMsg("Please choose a school before signing up.");
      return;
    }

    if (verificationMethod === "phone" && !form.phone.trim()) {
      setErrorMsg("Add a phone number if you want to verify by text.");
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await API.post("/register", {
        first_name: form.first_name,
        last_name: form.last_name,
        handle: form.handle,
        email: form.email,
        phone_number: form.phone,
        password: form.password,
        school_id: Number(form.school_id),
        preferred_contact_method: verificationMethod,
      });
      const verification = data?.verification || {};
      const verificationDetails = verification?.verification || {};

      savePendingVerification({
        registration_id: verification.registration_id,
        verification_id: verificationDetails.verification_id,
        email: form.email,
        phone: form.phone,
        contact_method: verification.preferred_method || verificationMethod,
        preferred_contact_method: verification.preferred_method || verificationMethod,
        contact_value: verification.contact_value,
        expires_at: verification.expires_at,
        preview_code: verification.preview_code || verificationDetails.preview_code || "",
        delivery_channel: verificationDetails.delivery_channel || verification.preferred_method || verificationMethod,
        verification_status: verificationDetails.status || verification.status || "pending",
        signup_payload: {
          first_name: form.first_name,
          last_name: form.last_name,
          handle: form.handle,
          email: form.email,
          phone: form.phone,
          school_id: Number(form.school_id),
          preferred_contact_method: verificationMethod,
        },
      });

      navigate("/verify", {
        replace: true,
        state: {
          pendingVerification: {
            registration_id: verification.registration_id,
            verification_id: verificationDetails.verification_id,
            email: form.email,
            phone: form.phone,
            contact_method: verification.preferred_method || verificationMethod,
            preferred_contact_method: verification.preferred_method || verificationMethod,
            contact_value: verification.contact_value,
            expires_at: verification.expires_at,
            preview_code: verification.preview_code || verificationDetails.preview_code || "",
            delivery_channel: verificationDetails.delivery_channel || verification.preferred_method || verificationMethod,
          },
        },
      });
    } catch (err) {
      setErrorMsg(
        getAuthErrorMessage(
          err,
          "Signup failed. Try a different email or handle."
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const formBlocked = loadingSchools || !!schoolLoadError || !schools.length;

  return (
    <div className="signup-shell">
      <div className="signup-stack">
        <div className="signup-container card">
          <div className="signup-brand">
            <img src="/MiniLogo.png" alt="GreekMarket" className="signup-logo" />
            <div>
              <p className="signup-brand-label">GreekMarket</p>
              <span>Campus marketplace</span>
            </div>
          </div>

          <h2>Create your account</h2>
          <p className="signup-hint">
            Join your school community, list items quickly, and keep everything in one clean place.
          </p>

          <div className="signup-journey">
            <div className="signup-journey-step active">
              <span>1</span>
              <div>
                <strong>Create account</strong>
                <p>Pick your name, handle, and school.</p>
              </div>
            </div>
            <div className="signup-journey-step">
              <span>2</span>
              <div>
                <strong>Verify contact</strong>
                <p>Confirm email or phone before onboarding.</p>
              </div>
            </div>
            <div className="signup-journey-step">
              <span>3</span>
              <div>
                <strong>Finish setup</strong>
                <p>Add your profile photo, school, and Stripe.</p>
              </div>
            </div>
          </div>

          <form onSubmit={onSubmit} className="signup-form">
            <input
              name="first_name"
              placeholder="First Name"
              required
              value={form.first_name}
              onChange={onChange}
            />
            <input
              name="last_name"
              placeholder="Last Name"
              required
              value={form.last_name}
              onChange={onChange}
            />
            <input
              name="handle"
              placeholder="Handle (username)"
              required
              value={form.handle}
              onChange={onChange}
            />
            <input
              type="email"
              name="email"
              placeholder="Email"
              required
              value={form.email}
              onChange={onChange}
            />
            <input
              type="tel"
              name="phone"
              placeholder="Phone number (optional)"
              value={form.phone}
              onChange={onChange}
            />
            <div className="signup-contact-preference">
              <div className="signup-contact-label">
                <span>Preferred verification</span>
                <p>We&apos;ll use this first when sending your code.</p>
              </div>
              <div className="signup-contact-options" role="radiogroup" aria-label="Preferred verification method">
                <button
                  type="button"
                  className={`signup-contact-option ${verificationMethod === "email" ? "active" : ""}`}
                  onClick={() => setVerificationMethod("email")}
                >
                  Email
                </button>
                <button
                  type="button"
                  className={`signup-contact-option ${verificationMethod === "phone" ? "active" : ""}`}
                  onClick={() => setVerificationMethod("phone")}
                >
                  Phone
                </button>
              </div>
            </div>
            <input
              type="password"
              name="password"
              placeholder="Password"
              required
              value={form.password}
              onChange={onChange}
            />

            <FancySelect
              value={form.school_id}
              onChange={(schoolId) => setForm({ ...form, school_id: schoolId })}
              disabled={formBlocked}
              ariaLabel="Choose your school"
              placeholder={loadingSchools ? "Loading schools..." : "Choose your school"}
              options={schoolOptions}
            />

            <button
              type="submit"
              className="signup-submit"
              disabled={submitting || formBlocked || !form.school_id}
            >
              {submitting ? "Starting verification..." : "Continue to verification"}
            </button>
          </form>

          {loadingSchools && !schoolLoadError && (
            <p className="signup-status">Loading schools...</p>
          )}
          {location.state?.accountDeleted ? (
            <p className="signup-status">Your account was deleted successfully.</p>
          ) : null}
          {schoolLoadError && <p className="signup-error">{schoolLoadError}</p>}
          {errorMsg && <p className="signup-error">{errorMsg}</p>}
          <p className="signup-footnote">
            At least one verified contact is required before your account is finalized.
          </p>

          <p className="signup-footer">
            Already have an account?{" "}
            <button type="button" onClick={() => navigate("/login")} className="signup-link">
              Log In
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default SignUpPage;
