import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { resetPassword, isCognitoConfigured } = useAuth();
  const token = params.get("token") || "";
  const initialEmail = params.get("email") || "";
  const initialCode = params.get("code") || "";
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState(initialCode);
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await resetPassword({
        email: email.trim().toLowerCase(),
        code: code.trim(),
        token,
        newPassword,
      });
      toast.success("Password reset — sign in with your new password");
      nav("/login");
    } catch (e) { toast.error(e?.message || "Unable to reset password"); }
    finally { setSubmitting(false); }
  };

  const canSubmit = isCognitoConfigured
    ? email.trim().length > 3 && code.trim().length > 0 && newPassword.length >= 6
    : token.length > 0 && newPassword.length >= 6;

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={submit} className="w-full max-w-sm brutal-card p-8 brutal-shadow">
        <div className="mono-label mb-2">RESET PASSWORD</div>
        <h2 className="text-2xl font-semibold mb-6">Set a new password</h2>
        {!isCognitoConfigured && !token ? (
          <p className="text-sm text-[var(--ink-soft)]">
            Missing token. Request a new reset link from the login page.
          </p>
        ) : (
          <>
            {isCognitoConfigured && (
              <>
                <Label className="mono-label">Email</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 border-black rounded-none"
                  data-testid="reset-email-input"
                />
                <Label className="mono-label mt-4 block">Verification code</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="mt-2 border-black rounded-none"
                  data-testid="reset-code-input"
                />
              </>
            )}
            <Label className="mono-label">New password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="mt-2 border-black rounded-none" data-testid="reset-password-input" />
            <Button type="submit" disabled={submitting || !canSubmit}
              className="w-full mt-6 rounded-none bg-black hover:bg-[var(--accent)] text-white h-11" data-testid="reset-submit">
              {submitting ? "Resetting…" : "Reset password →"}
            </Button>
          </>
        )}
        <div className="mt-4 text-xs"><Link to="/login" className="underline">Back to login</Link></div>
      </form>
    </div>
  );
}
