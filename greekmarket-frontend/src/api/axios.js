// src/api/axios.js
import axios from "axios";

const API = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000",
  withCredentials: true, // required for HttpOnly refresh cookie
  // timeout: 20000, // optional: prevent hanging forever
});

// Attach access token to every request
API.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let queue = [];

const AUTH_ENDPOINTS = [
  "/login",
  "/register",
  "/token/refresh",
  "/logout",
  "/password-reset/request",
  "/password-reset/status",
  "/password-reset/resend",
  "/password-reset/confirm",
];

function isAuthEndpoint(url = "") {
  return AUTH_ENDPOINTS.some((endpoint) => url === endpoint || url?.startsWith(`${endpoint}?`));
}

// Helper to resolve queued requests after refresh
function resolveQueue(error, token = null) {
  queue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token);
  });
  queue = [];
}

// Response interceptor: refresh once on 401, then retry original request
API.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error?.config;
    const status = error?.response?.status;

    // If there's no config or it's the refresh endpoint itself, just fail
    if (!original || original._isRefreshCall || isAuthEndpoint(original.url)) {
      return Promise.reject(error);
    }

    // Only handle 401 once per request
    if (status === 401 && !original._retry) {
      // If a refresh is already happening, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({ resolve, reject });
        }).then((newToken) => {
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${newToken}`;
          return API(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        // Mark this as the refresh call so we don't intercept it again
        const refreshReq = {
          url: "/token/refresh",
          method: "POST",
          withCredentials: true,
        };
        refreshReq._isRefreshCall = true;

        const { data } = await API.request(refreshReq);
        const newToken = data.access_token;

        // Save & update headers
        localStorage.setItem("token", newToken);
        resolveQueue(null, newToken);

        // Retry the original request with the new token
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return API(original);
      } catch (refreshErr) {
        // Refresh failed — clear auth and reject
        localStorage.removeItem("token");
        resolveQueue(refreshErr, null);
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default API;
