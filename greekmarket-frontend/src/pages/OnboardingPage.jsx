import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../api/axios";
import { isNetworkFailure } from "../utils/authErrors";
import { getNextSetupRoute } from "../utils/accountJourney";
import "../styles/OnboardingPage.css";

export default function OnboardingPage() {
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(0);
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  async function loadSchools() {
    setLoading(true);
    setErr("");
    try {
      const { data } = await API.get("/schools");
      setSchools(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(
        isNetworkFailure(e)
          ? "School list could not be loaded right now. The backend may be offline or blocked by CORS."
          : e?.response?.data?.error || "Failed to load schools."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadSchools();
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter((school) => {
      const name = String(school.name || "").toLowerCase();
      const domain = String(school.domain || "").toLowerCase();
      return name.includes(q) || domain.includes(q);
    });
  }, [query, schools]);

  async function join(schoolId) {
    try {
      setJoining(schoolId);
      await API.post(`/schools/${schoolId}/select`);
      try {
        const { data } = await API.get("/me");
        navigate(getNextSetupRoute(data), { replace: true });
      } catch {
        navigate("/dashboard", { replace: true });
      }
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to join school.");
      setJoining(0);
    }
  }

  return (
    <div className="onboard-wrap">
      <h1>Choose your school</h1>
      <p className="onboard-sub">You&apos;ll use this to see school posts and create your own.</p>

      <div className="onboard-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search schools by name or domain..."
          aria-label="Search schools"
        />
      </div>

      {err ? (
        <div className="onboard-error">
          <strong>We could not load schools right now.</strong>
          <span>{err}</span>
          <div className="onboard-inline-actions">
            <button type="button" className="btn-secondary" onClick={loadSchools}>
              Retry
            </button>
            <Link className="btn-secondary onboard-link-btn" to="/browse">
              Browse first
            </Link>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="onboard-loading">Loading schools...</div>
      ) : filtered.length === 0 ? (
        <div className="onboard-empty">
          <strong>No schools match "{query}".</strong>
          <span>Clear the search or browse first while you confirm the exact school name.</span>
          <div className="onboard-inline-actions">
            <button type="button" className="btn-secondary" onClick={() => setQuery("")}>
              Clear search
            </button>
            <Link className="btn-secondary onboard-link-btn" to="/browse">
              Browse first
            </Link>
          </div>
        </div>
      ) : (
        <ul className="onboard-list">
          {filtered.map((school) => (
            <li key={school.id} className="onboard-item">
              <div className="onboard-meta">
                <div className="onboard-name">{school.name}</div>
                <div className="onboard-domain">{school.domain}</div>
              </div>
              <div className="onboard-actions">
                <button className="btn-secondary" type="button" onClick={() => navigate(`/school/${school.id}`)}>
                  Open
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  disabled={joining === school.id}
                  onClick={() => join(school.id)}
                >
                  {joining === school.id ? "Saving..." : "Set primary"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
