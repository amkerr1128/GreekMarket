export function isNetworkFailure(error) {
  return (
    !error?.response ||
    error?.code === "ERR_NETWORK" ||
    error?.message === "Network Error"
  );
}

export function getAuthErrorMessage(error, fallbackMessage) {
  if (isNetworkFailure(error)) {
    return (
      "The app could not reach the backend. Check that the API server is running and that this page's origin is allowed by CORS. If you opened the frontend on 127.0.0.1, the backend may only allow localhost."
    );
  }

  return (
    error?.response?.data?.error ||
    error?.response?.data?.msg ||
    error?.response?.data?.message ||
    fallbackMessage
  );
}
