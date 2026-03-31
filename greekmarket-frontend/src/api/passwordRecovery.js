import API from "./axios";

export function requestPasswordReset(payload) {
  return API.post("/password-reset/request", payload);
}

export function loadPasswordResetStatus(config = {}) {
  return API.get("/password-reset/status", config);
}

export function resendPasswordReset(payload) {
  return API.post("/password-reset/resend", payload);
}

export function confirmPasswordReset(payload) {
  return API.post("/password-reset/confirm", payload);
}
