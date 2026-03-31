import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "./icons";
import { resolveReturnTarget } from "../utils/returnNavigation";
import "../styles/ReturnButton.css";

export default function ReturnButton({ fallbackTo = "/browse", className = "", label = "Return" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const target = resolveReturnTarget(location, fallbackTo);
  const hasExplicitTarget = typeof location?.state?.returnTo === "string" && location.state.returnTo.trim();

  function handleReturn() {
    if (hasExplicitTarget) {
      navigate(target);
      return;
    }

    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate(fallbackTo);
  }

  return (
    <button type="button" className={`return-button ${className}`.trim()} onClick={handleReturn}>
      <ArrowLeftIcon className="return-button-icon" />
      <span>{label}</span>
    </button>
  );
}
