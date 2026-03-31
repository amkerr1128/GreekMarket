import API from "./axios";

const START_PATHS = [
  "/verification/start",
  "/verification/send",
  "/auth/verification/start",
];

const RESEND_PATHS = [
  "/verification/resend",
  "/verification/start",
  "/verification/send",
];

const CONFIRM_PATHS = [
  "/verification/confirm",
  "/verification/complete",
  "/auth/verification/confirm",
];

const STATUS_PATHS = [
  "/verification/status",
  "/verification",
  "/account/verification",
];

async function requestWithFallback(paths, method, payload = undefined, config = {}) {
  let lastError = null;

  for (const path of paths) {
    try {
      if (method === "get") {
        return await API.get(path, config);
      }
      if (method === "put") {
        return await API.put(path, payload, config);
      }
      return await API.post(path, payload, config);
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      if (status !== 404 && status !== 405) {
        throw error;
      }
    }
  }

  throw lastError;
}

export function startVerification(payload = {}, config = {}) {
  return requestWithFallback(START_PATHS, "post", payload, config);
}

export function resendVerification(payload = {}, config = {}) {
  return requestWithFallback(RESEND_PATHS, "post", payload, config);
}

export function confirmVerification(payload = {}, config = {}) {
  return requestWithFallback(CONFIRM_PATHS, "post", payload, config);
}

export function loadVerificationStatus(config = {}) {
  return requestWithFallback(STATUS_PATHS, "get", undefined, config);
}

