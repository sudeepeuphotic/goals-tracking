import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Signup() {
  const { user, signup, confirmSignup, login, isCognitoConfigured } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (user && user !== null && user !== false) return <Navigate to="/" replace />;

  const submitSignup = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const confirmed = await signup({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      if (isCognitoConfigured) {
        if (confirmed) {
          await login(email.trim().toLowerCase(), password);
          toast.success("Account created");
          nav("/");
          return;
        }
        setAwaitingConfirmation(true);
        toast.success("Signup successful. Enter the verification code sent to your email.");
      } else {
        toast.success("Account created");
        nav("/");
      }
    } catch (err) {
      toast.error(err?.message || "Could not create account");
    } finally {
      setSubmitting(false);
    }
  };

  const submitConfirmation = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await confirmSignup({ email: email.trim().toLowerCase(), code });
      await login(email.trim().toLowerCase(), password);
      toast.success("Email verified and account signed in");
      nav("/");
    } catch (err) {
      toast.error(err?.message || "Could not confirm signup");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between p-10 brutal-border border-r-[1px] scanlines">
        <div>
          <div className="mono-label">NOSH / FOCUS-CYCLE</div>
          <h1 className="text-5xl md:text-6xl font-bold mt-6 leading-[0.95]">
            Build focus.<br/>Ship outcomes.<br/>Stay aligned.
          </h1>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 bg-[var(--bg)]">
        {!awaitingConfirmation ? (
          <form onSubmit={submitSignup} className="w-full max-w-sm brutal-card p-8 brutal-shadow">
            <div className="mono-label mb-2">SIGN UP</div>
            <h2 className="text-2xl font-semibold mb-6">Create your account</h2>
            <div className="space-y-4">
              <div>
                <Label className="mono-label">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 border-black" />
              </div>
              <div>
                <Label className="mono-label">Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 border-black" />
              </div>
              <div>
                <Label className="mono-label">Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 border-black" />
              </div>
            </div>
            <Button type="submit" disabled={submitting || !name || !email || password.length < 6}
              className="w-full mt-6 rounded-none bg-black hover:bg-[var(--accent)] text-white h-11">
              {submitting ? "Creating…" : "Create account →"}
            </Button>
            <div className="mt-4 text-xs">
              Already have an account? <Link to="/login" className="underline">Sign in</Link>
            </div>
          </form>
        ) : (
          <form onSubmit={submitConfirmation} className="w-full max-w-sm brutal-card p-8 brutal-shadow">
            <div className="mono-label mb-2">VERIFY EMAIL</div>
            <h2 className="text-2xl font-semibold mb-3">Confirm your account</h2>
            <p className="text-sm text-[var(--ink-soft)] mb-4">
              Enter the verification code sent to {email.trim().toLowerCase()}.
            </p>
            <Label className="mono-label">Verification code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-2 border-black" />
            <Button type="submit" disabled={submitting || !code.trim()}
              className="w-full mt-6 rounded-none bg-black hover:bg-[var(--accent)] text-white h-11">
              {submitting ? "Verifying…" : "Verify and continue →"}
            </Button>
            <div className="mt-4 text-xs">
              Wrong email?{" "}
              <button type="button" className="underline" onClick={() => setAwaitingConfirmation(false)}>
                Edit signup details
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
