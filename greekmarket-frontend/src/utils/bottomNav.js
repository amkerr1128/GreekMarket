const BOTTOM_NAV_EVENT = "greekmarket:bottom-nav";

export function setBottomNavCollapsed(collapsed) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(BOTTOM_NAV_EVENT, {
      detail: { collapsed: Boolean(collapsed) },
    })
  );
}

export function subscribeToBottomNav(handler) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const listener = (event) => {
    handler(Boolean(event?.detail?.collapsed));
  };

  window.addEventListener(BOTTOM_NAV_EVENT, listener);
  return () => window.removeEventListener(BOTTOM_NAV_EVENT, listener);
}
