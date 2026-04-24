import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "@/lib/api";
import { AuthenticationDetails, CognitoUser, CognitoUserAttribute, CognitoUserPool } from "amazon-cognito-identity-js";
import { clearAuthToken, setAuthToken } from "@/lib/authToken";

const AuthContext = createContext(null);
const poolData = {
  UserPoolId: process.env.REACT_APP_COGNITO_USER_POOL_ID || "",
  ClientId: process.env.REACT_APP_COGNITO_CLIENT_ID || "",
};
const isCognitoConfigured = Boolean(poolData.UserPoolId && poolData.ClientId);
const userPool = isCognitoConfigured ? new CognitoUserPool(poolData) : null;

function getCognitoUser(email) {
  if (!userPool) return null;
  return new CognitoUser({
    Username: email.trim().toLowerCase(),
    Pool: userPool,
  });
}

function authenticateWithCognito(email, password) {
  return new Promise((resolve, reject) => {
    const cognitoUser = getCognitoUser(email);
    if (!cognitoUser) {
      reject(new Error("Cognito is not configured"));
      return;
    }
    const authDetails = new AuthenticationDetails({
      Username: email.trim().toLowerCase(),
      Password: password,
    });
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
    });
  });
}

function forgotPasswordWithCognito(email) {
  return new Promise((resolve, reject) => {
    const cognitoUser = getCognitoUser(email);
    if (!cognitoUser) {
      reject(new Error("Cognito is not configured"));
      return;
    }
    cognitoUser.forgotPassword({
      onSuccess: () => resolve(true),
      onFailure: (err) => reject(err),
      inputVerificationCode: () => resolve(true),
    });
  });
}

function resetPasswordWithCognito(email, code, newPassword) {
  return new Promise((resolve, reject) => {
    const cognitoUser = getCognitoUser(email);
    if (!cognitoUser) {
      reject(new Error("Cognito is not configured"));
      return;
    }
    cognitoUser.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(true),
      onFailure: (err) => reject(err),
    });
  });
}

function signUpWithCognito({ name, email, password }) {
  return new Promise((resolve, reject) => {
    if (!userPool) {
      reject(new Error("Cognito is not configured"));
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const attributes = [
      new CognitoUserAttribute({ Name: "email", Value: normalizedEmail }),
      new CognitoUserAttribute({ Name: "name", Value: name.trim() }),
    ];
    userPool.signUp(normalizedEmail, password, attributes, [], (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result?.userConfirmed === true);
    });
  });
}

function confirmSignUpWithCognito(email, code) {
  return new Promise((resolve, reject) => {
    const cognitoUser = getCognitoUser(email);
    if (!cognitoUser) {
      reject(new Error("Cognito is not configured"));
      return;
    }
    cognitoUser.confirmRegistration(code.trim(), true, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(true);
    });
  });
}

function getCurrentSession() {
  return new Promise((resolve, reject) => {
    if (!userPool) {
      resolve(null);
      return;
    }
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) {
      resolve(null);
      return;
    }
    cognitoUser.getSession((err, session) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(session);
    });
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = not authed, object = authed
  const [error, setError] = useState("");

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (_e) {
      setUser(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bootstrapAuth = async () => {
      try {
        const session = await getCurrentSession();
        if (session && session.isValid()) {
          setAuthToken(session.getAccessToken().getJwtToken());
        } else {
          clearAuthToken();
        }
      } catch (_e) {
        clearAuthToken();
      }
      if (!cancelled) {
        await fetchMe();
      }
    };
    bootstrapAuth();
    return () => {
      cancelled = true;
    };
  }, [fetchMe]);

  const login = async (email, password) => {
    setError("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (isCognitoConfigured) {
        const session = await authenticateWithCognito(normalizedEmail, password);
        setAuthToken(session.getAccessToken().getJwtToken());
        const { data } = await api.get("/auth/me");
        setUser(data);
        return data;
      }
      const { data } = await api.post("/auth/login", { email: normalizedEmail, password });
      setUser(data);
      return data;
    } catch (e) {
      setError(formatApiError(e));
      throw e;
    }
  };

  const logout = async () => {
    if (userPool) {
      const current = userPool.getCurrentUser();
      if (current) {
        current.signOut();
      }
    }
    clearAuthToken();
    try { await api.post("/auth/logout"); } catch (_e) { /* ignore */ }
    setUser(false);
  };

  const forgotPassword = async (email) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (isCognitoConfigured) {
      await forgotPasswordWithCognito(normalizedEmail);
      return;
    }
    await api.post("/auth/forgot-password", { email: normalizedEmail });
  };

  const resetPassword = async ({ email, code, token, newPassword }) => {
    if (isCognitoConfigured) {
      await resetPasswordWithCognito(email, code, newPassword);
      return;
    }
    await api.post("/auth/reset-password", { token, new_password: newPassword });
  };

  const signup = async ({ name, email, password }) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (isCognitoConfigured) {
      return signUpWithCognito({ name, email: normalizedEmail, password });
    }
    const { data } = await api.post("/auth/register", {
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: "contributor",
    });
    setUser(data);
    return true;
  };

  const confirmSignup = async ({ email, code }) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (isCognitoConfigured) {
      await confirmSignUpWithCognito(normalizedEmail, code);
      return;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        error,
        login,
        logout,
        refresh: fetchMe,
        forgotPassword,
        resetPassword,
        signup,
        confirmSignup,
        isCognitoConfigured,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
