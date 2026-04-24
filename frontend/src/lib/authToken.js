const STORAGE_KEY = "nosh_cognito_access_token";

export function getAuthToken() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch (_e) {
    return "";
  }
}

export function setAuthToken(token) {
  try {
    if (!token) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, token);
  } catch (_e) {
    // ignore storage errors in private mode
  }
}

export function clearAuthToken() {
  setAuthToken("");
}
