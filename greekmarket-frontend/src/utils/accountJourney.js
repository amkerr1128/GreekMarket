function isDefined(value) {
  return value !== undefined && value !== null && value !== "";
}

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (!isDefined(value)) return false;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (["true", "yes", "y", "1", "verified", "complete", "completed", "done", "approved", "accepted"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "n", "0", "pending", "incomplete", "unverified", "draft", "disabled"].includes(normalized)) {
      return false;
    }
  }

  return Boolean(value);
}

function firstDefined(...values) {
  return values.find((value) => isDefined(value));
}

function toLabel(value) {
  if (!isDefined(value)) return "";
  return String(value).trim();
}

function getCompletionStep(completion, key) {
  const steps = Array.isArray(completion?.steps) ? completion.steps : [];
  return steps.find((step) => step?.key === key) || null;
}

function buildSignalObject(user = {}, fallback = {}) {
  const sourceUser = user && typeof user === "object" ? user : {};
  const sourceFallback = fallback && typeof fallback === "object" ? fallback : {};

  const verification =
    sourceUser.contact_verification ||
    sourceUser.verification ||
    sourceUser.account_verification ||
    sourceUser.verification_state ||
    sourceFallback.verification ||
    {};

  const completion =
    sourceUser.profile_completion ||
    sourceUser.account_completion ||
    sourceUser.onboarding_progress ||
    sourceFallback.completion ||
    {};

  const contactMethod = (
    firstDefined(
      verification.preferred_contact_method,
      verification.verified_contacts?.[0]?.contact_method,
      sourceUser.preferred_contact_method,
      sourceUser.verification_method,
      sourceFallback.preferred_contact_method,
      "email"
    ) || "email"
  )
    .toString()
    .toLowerCase();

  const contactValue = firstDefined(
    verification.contact_value,
    verification.target,
    verification.verified_contacts?.[0]?.contact_value,
    sourceUser.verification_contact,
    sourceUser.email,
    sourceFallback.email,
    sourceUser.phone,
    sourceFallback.phone
  );

  const contactComplete = coerceBoolean(
    firstDefined(
      verification.has_verified_contact,
      verification.contact_verified,
      verification.verified,
      verification.complete,
      verification.completed,
      sourceUser.contact_verified,
      sourceUser.verified_contact,
      sourceUser.email_verified,
      sourceUser.phone_verified,
      sourceUser.is_verified,
      sourceUser.email_verified_at,
      sourceUser.phone_verified_at,
      sourceFallback.contact_verified
    )
  );

  const schoolComplete = coerceBoolean(
    firstDefined(
      getCompletionStep(completion, "school")?.completed,
      completion.school?.complete,
      sourceUser.school_id,
      sourceUser.school_name,
      sourceFallback.school_complete
    )
  );

  const chapterComplete = coerceBoolean(
    firstDefined(
      getCompletionStep(completion, "chapter_membership")?.completed,
      completion.chapter?.complete,
      sourceUser.chapter_id,
      sourceUser.chapter_name,
      sourceFallback.chapter_complete
    )
  );

  const photoComplete = coerceBoolean(
    firstDefined(
      getCompletionStep(completion, "profile_photo")?.completed,
      completion.profile_photo?.complete,
      sourceUser.has_profile_picture,
      sourceUser.profile_picture_url,
      sourceUser.avatar_url,
      sourceFallback.photo_complete
    )
  );

  const stripeComplete = coerceBoolean(
    firstDefined(
      getCompletionStep(completion, "stripe")?.completed,
      completion.stripe?.complete,
      sourceUser.stripe_account_id,
      sourceUser.stripe_connected,
      sourceFallback.stripe_complete
    )
  );

  const verificationSignals = [
    verification.has_verified_contact,
    verification.status,
    verification.contact_status,
    verification.contact_verified,
    verification.verified,
    verification.complete,
    verification.completed,
    verification.verification_id,
    verification.challenge_id,
    verification.contact_value,
    verification.target,
    verification.preferred_contact_method,
    verification.verified_contacts?.length,
    sourceUser.email_verified,
    sourceUser.phone_verified,
    sourceUser.contact_verified,
    sourceUser.verified_contact,
    sourceUser.requires_verification,
    sourceUser.needs_verification,
    sourceUser.email_verified_at,
    sourceUser.phone_verified_at,
    sourceUser.verification_status,
    sourceUser.contact_verification_status,
    sourceUser.email_verification_status,
    sourceUser.phone_verification_status,
  ];

  const hasVerificationSignal = verificationSignals.some(isDefined);

  const items = [
    {
      key: "contact",
      label: "Verify email or phone",
      detail: contactComplete
        ? `Your ${contactMethod} contact is verified.`
        : hasVerificationSignal
          ? `Finish verifying the ${contactMethod} contact tied to this account.`
          : "Verification status will appear here as soon as the backend returns it.",
      complete: contactComplete,
      actionLabel: contactComplete ? "Review" : "Verify now",
      actionKey: "verify",
      tone: contactComplete ? "complete" : "primary",
    },
    {
      key: "school",
      label: "Choose a school",
      detail: schoolComplete
        ? `You're linked to ${toLabel(sourceUser.school_name)}.`
        : "Join your school so the feed and search surfaces have the right context.",
      complete: schoolComplete,
      actionLabel: schoolComplete ? "Review school" : "Pick school",
      actionKey: "school",
      tone: schoolComplete ? "complete" : "secondary",
    },
    {
      key: "chapter",
      label: "Join your chapter/community",
      detail: chapterComplete
        ? `Connected to ${toLabel(sourceUser.chapter_name)}.`
        : "Connect to a chapter so your storefront and moderation tools stay in sync.",
      complete: chapterComplete,
      actionLabel: chapterComplete ? "Review chapter" : "Find chapter",
      actionKey: "chapter",
      tone: chapterComplete ? "complete" : "secondary",
    },
    {
      key: "photo",
      label: "Add a profile photo",
      detail: photoComplete
        ? "Your profile already has a clean visual identity."
        : "A profile photo helps buyers trust your storefront right away.",
      complete: photoComplete,
      actionLabel: photoComplete ? "Change photo" : "Upload photo",
      actionKey: "photo",
      tone: photoComplete ? "complete" : "secondary",
    },
    {
      key: "stripe",
      label: "Connect Stripe",
      detail: stripeComplete
        ? "Seller payouts are connected."
        : "Connect Stripe to finish seller payout setup and accept payments.",
      complete: stripeComplete,
      actionLabel: stripeComplete ? "Manage Stripe" : "Connect Stripe",
      actionKey: "stripe",
      tone: stripeComplete ? "complete" : "secondary",
    },
  ];

  const completeCount = items.filter((item) => item.complete).length;
  const totalCount = items.length;
  const progress = totalCount ? Math.round((completeCount / totalCount) * 100) : 0;
  const nextIncomplete = items.find((item) => !item.complete) || items[0];

  return {
    verification,
    completion,
    contactMethod,
    contactValue,
    contactComplete,
    schoolComplete,
    chapterComplete,
    photoComplete,
    stripeComplete,
    hasVerificationSignal,
    items,
    completeCount,
    totalCount,
    progress,
    nextIncomplete,
  };
}

export function getAccountCompletionState(user = {}, fallback = {}) {
  return buildSignalObject(user, fallback);
}

export function getNextSetupRoute(user = {}, options = {}) {
  const state = getAccountCompletionState(user, options);
  if (options.forceVerification || (state.hasVerificationSignal && !state.contactComplete)) {
    return "/verify";
  }
  if (!state.schoolComplete) {
    return "/onboarding";
  }
  return "/dashboard";
}
