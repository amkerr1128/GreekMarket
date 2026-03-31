export const LISTING_PLACEHOLDER = "/listing-placeholder.svg";

export function isGeneratedListingPlaceholder(src) {
  return typeof src === "string" && src.startsWith("data:image/svg+xml");
}

export function resolveListingImage(src) {
  if (!src || isGeneratedListingPlaceholder(src)) {
    return LISTING_PLACEHOLDER;
  }
  return src;
}
