// Return fixed messages only: provider diagnostics may contain source text or secrets.
export const MODEL_UNAVAILABLE = 'The selected Codex model is unavailable for this ChatGPT account or CLI. Choose a supported model for Maple and test the connection again.';
const AUTH_REQUIRED = 'Provider authentication expired. Sign in to the selected provider and test the connection again.';

export function typedSessionFailure(value) {
  const failure = value?._meta?.jetbrains?.air?.sessionFailure;
  if (failure?.severity !== 'error') return null;
  const error = new Error(safeProviderError({ message: failure.title, category: failure.category }));
  error.code = 'PROVIDER_REPORTED_FAILURE';
  return error;
}

export function safeProviderError(error) {
  if (error?.code === 'PROVIDER_MODEL_UNAVAILABLE') return MODEL_UNAVAILABLE;
  if (error?.code === 'PROVIDER_REPORTED_FAILURE' && error.message === AUTH_REQUIRED) return AUTH_REQUIRED;
  const message = String(error?.message ?? '');
  if (/model[^\n]*(?:not supported|not available|unavailable|does not exist)|unsupported[^\n]*model/i.test(message)) return MODEL_UNAVAILABLE;
  if (error?.category === 'rate_limited' || /usage limit|weekly limit|rate.?limit|hit your limit|resets|quota/i.test(message)) {
    return 'Provider subscription limit reached. Retry after your allowance resets.';
  }
  if (error?.category === 'auth_required') return AUTH_REQUIRED;
  if (['PROVIDER_ISOLATION_UNSUPPORTED', 'PROVIDER_SUBSCRIPTION_DISABLED'].includes(error?.code)) return error.message;
  return 'Provider could not complete this request. Check its login, subscription allowance and availability, then retry.';
}
