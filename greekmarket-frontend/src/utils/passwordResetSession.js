function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

export function extractPasswordResetSession(payload = {}, fallback = {}) {
  const nested =
    payload?.reset ||
    payload?.password_reset ||
    payload?.recovery ||
    payload?.challenge ||
    payload?.session ||
    {};

  return {
    reset_id: firstDefined(
      nested.reset_id,
      nested.password_reset_id,
      nested.challenge_id,
      payload.reset_id,
      payload.password_reset_id,
      fallback.reset_id
    ),
    token: firstDefined(
      nested.token,
      nested.reset_token,
      payload.token,
      payload.reset_token,
      fallback.token
    ),
    email: firstDefined(
      nested.email,
      nested.contact_value,
      payload.email,
      payload.contact_value,
      fallback.email
    ),
    contact_value: firstDefined(
      nested.contact_value,
      nested.masked_contact,
      nested.masked_email,
      payload.contact_value,
      payload.masked_contact,
      payload.masked_email,
      fallback.contact_value,
      fallback.email
    ),
    preview_code: firstDefined(
      nested.preview_code,
      payload.preview_code,
      fallback.preview_code
    ),
    expires_at: firstDefined(
      nested.expires_at,
      payload.expires_at,
      fallback.expires_at
    ),
    delivery_channel: firstDefined(
      nested.delivery_channel,
      payload.delivery_channel,
      fallback.delivery_channel,
      "email"
    ),
    message: firstDefined(payload.message, nested.message, fallback.message),
  };
}

export function hasPasswordResetSession(session = {}) {
  return Boolean(session?.reset_id || session?.token || session?.email);
}
