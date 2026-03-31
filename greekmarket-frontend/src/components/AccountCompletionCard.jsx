import { useMemo } from "react";
import { CheckIcon } from "./icons";
import { getAccountCompletionState } from "../utils/accountJourney";
import "../styles/AccountCompletionCard.css";

export default function AccountCompletionCard({
  user,
  onAction,
  className = "",
  title = "Complete account verification",
  description = "Finish these steps so your account is ready for real buying, selling, and support.",
  compact = false,
}) {
  const state = useMemo(() => getAccountCompletionState(user), [user]);
  const isComplete = state.completeCount === state.totalCount;
  const primaryAction = isComplete
    ? {
        key: "review_setup",
        actionKey: "review_setup",
        actionLabel: "Manage setup",
      }
    : state.nextIncomplete || state.items[0];

  if (isComplete) {
    return (
      <section className={`completion-card completion-banner card ${className}`.trim()}>
        <div className="completion-banner-mark" aria-hidden="true">
          <CheckIcon className="completion-check" />
        </div>
        <div className="completion-banner-copy">
          <p className="eyebrow">Verified account</p>
          <p className="completion-banner-text">
            Your profile is fully set up for buying, selling, support, and payouts.
          </p>
        </div>
        <div className="completion-banner-actions">
          <span className="completion-chip complete">Verified</span>
          <button type="button" className="completion-action secondary" onClick={() => onAction?.(primaryAction)}>
            {primaryAction.actionLabel}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={`completion-card card ${compact ? "compact" : ""} ${className}`.trim()}>
      <div className="completion-head">
        <div>
          <p className="eyebrow">Account checklist</p>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
        <div className="completion-summary">
          <strong>
            {state.completeCount}/{state.totalCount}
          </strong>
          <span>steps complete</span>
        </div>
      </div>

      <div className="completion-progress" aria-hidden="true">
        <span style={{ width: `${state.progress}%` }} />
      </div>

      <div className="completion-list">
        {state.items.map((item, index) => (
          <div key={item.key} className={`completion-row ${item.complete ? "complete" : ""}`}>
            <div className="completion-mark" aria-hidden="true">
              {item.complete ? <CheckIcon className="completion-check" /> : <span>{index + 1}</span>}
            </div>
            <div className="completion-copy">
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            <div className="completion-actions">
              {item.complete ? (
                <span className="completion-chip complete">Done</span>
              ) : (
                <button
                  type="button"
                  className={`completion-action ${item.tone || "secondary"}`}
                  onClick={() => onAction?.(item)}
                >
                  {item.actionLabel}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="completion-footer">
        <div className="completion-footer-copy">
          <strong>Keep going to unlock the rest of the marketplace.</strong>
          <span>The next step is highlighted above so you always know where to go.</span>
        </div>
        <button type="button" className="completion-primary" onClick={() => onAction?.(primaryAction)}>
          {primaryAction?.actionLabel || "Continue setup"}
        </button>
      </div>
    </section>
  );
}
