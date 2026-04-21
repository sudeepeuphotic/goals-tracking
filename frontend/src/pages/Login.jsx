import { useState } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@noshrobotics.co");
  const [password, setPassword] = useState("admin123");
  const [submitting, setSubmitting] = useState(false);
  const [fpOpen, setFpOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState("");

  if (user && user !== null && user !== false) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      nav("/");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const submitForgot = async () => {
    try {
      await api.post("/auth/forgot-password", { email: fpEmail });
      toast.success("If that email exists, a reset link was logged to the server console.");
      setFpOpen(false);
      setFpEmail("");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between p-10 brutal-border border-r-[1px] scanlines">
        <div>
          <div className="mono-label">NOSH / FOCUS-CYCLE</div>
          <h1 className="text-5xl md:text-6xl font-bold mt-6 leading-[0.95]">
            Three months.<br/>One direction.<br/>Zero fluff.
          </h1>
          <p className="mt-8 max-w-md text-[15px] text-[var(--ink-soft)]">
            An execution system for teams that ship. Track objectives, weekly pulse,
            honest reflections, and sharp team feedback — in less than three minutes a week.
          </p>
        </div>
        <div className="mono-label">v1 / JWT · MongoDB · FastAPI · GEMINI_3_FLASH</div>
      </div>

      <div className="flex items-center justify-center p-8 bg-[var(--bg)]">
        <form onSubmit={onSubmit} className="w-full max-w-sm brutal-card p-8 brutal-shadow" data-testid="login-form">
          <div className="mono-label mb-2">SIGN IN</div>
          <h2 className="text-2xl font-semibold mb-6">Welcome back</h2>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email" className="mono-label">Email</Label>
              <Input id="email" data-testid="login-email-input" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 border-black" />
            </div>
            <div>
              <Label htmlFor="password" className="mono-label">Password</Label>
              <Input id="password" type="password" data-testid="login-password-input" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 border-black" />
            </div>
          </div>
          <Button type="submit" data-testid="login-submit-button" disabled={submitting}
            className="w-full mt-6 rounded-none bg-black hover:bg-[var(--accent)] text-white h-11">
            {submitting ? "Signing in…" : "Sign in →"}
          </Button>

          <div className="mt-3 text-right text-xs">
            <Dialog open={fpOpen} onOpenChange={setFpOpen}>
              <DialogTrigger asChild>
                <button type="button" className="underline text-[var(--ink-soft)]" data-testid="forgot-password-link">Forgot password?</button>
              </DialogTrigger>
              <DialogContent className="rounded-none border border-black">
                <DialogHeader><DialogTitle>Reset password</DialogTitle></DialogHeader>
                <div className="text-sm text-[var(--ink-soft)]">Enter your email. We'll log a reset link to the server console (dev mode).</div>
                <Input className="rounded-none border-black mt-2" value={fpEmail} onChange={e => setFpEmail(e.target.value)} data-testid="forgot-email" />
                <DialogFooter><Button className="rounded-none bg-black text-white" onClick={submitForgot} data-testid="forgot-submit">Send reset link</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="mt-6 text-xs text-[var(--ink-soft)] space-y-1 font-mono">
            <div>admin@noshrobotics.co / admin123</div>
            <div>manager@noshrobotics.co / password123</div>
            <div>dri@noshrobotics.co / password123</div>
            <div>alice@noshrobotics.co / password123</div>
          </div>
        </form>
      </div>
    </div>
  );
}
