import "../styles/SocialCountsBar.css";

export default function SocialCountsBar({ items = [], className = "" }) {
  const visibleItems = items.filter((item) => item && item.label);

  if (!visibleItems.length) return null;

  return (
    <div className={`social-counts-bar ${className}`.trim()} role="list" aria-label="Profile statistics">
      {visibleItems.map((item) => {
        const content = (
          <>
            <strong>{item.value ?? 0}</strong>
            <span>{item.label}</span>
          </>
        );

        const className = `social-counts-item ${item.onClick ? "clickable" : ""} ${item.tone || ""}`.trim();
        if (item.onClick) {
          return (
            <button key={item.label} type="button" className={className} onClick={item.onClick}>
              {content}
            </button>
          );
        }

        return (
          <div key={item.label} className={className} role="listitem">
            {content}
          </div>
        );
      })}
    </div>
  );
}
