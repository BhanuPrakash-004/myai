"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function SignInForm({ returnTo }: { returnTo: string }) {
  const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      if (!response.ok) { setError(response.status === 429 ? "Too many attempts. Try again in one minute." : "Sign-in failed. Check your email and password."); return; }
      const destination = new URL(returnTo, window.location.origin);
      window.location.assign(destination.origin === window.location.origin ? destination.pathname + destination.search : "/knowledge");
    } catch { setError("Could not reach the server. Please retry."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="mt-6 space-y-4">
    <label className="block text-sm">Email<Input className="mt-1" name="email" type="email" autoComplete="username" required maxLength={254} /></label>
    <label className="block text-sm">Password<Input className="mt-1" name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
    {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
    <Button type="submit" disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
  </form>;
}
