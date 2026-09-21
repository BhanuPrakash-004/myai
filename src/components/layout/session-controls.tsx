"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SessionControls() {
  const router = useRouter();
  const [expired, setExpired] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const expire = () => setExpired(true);
    window.addEventListener("myai:session-expired", expire);
    return () => window.removeEventListener("myai:session-expired", expire);
  }, []);
  async function signOut() {
    const response = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (response.ok) { router.replace("/sign-in"); router.refresh(); }
    else setMessage("Could not sign out. Please retry.");
  }
  async function resume() {
    const response = await fetch("/api/auth/get-session", { cache: "no-store" });
    if (response.ok && (await response.json())?.session) { setExpired(false); setMessage(""); }
    else setMessage("Sign in first, then continue here.");
  }
  return <>
    <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
    {message && !expired ? <span role="alert">{message}</span> : null}
    {expired ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6" role="dialog" aria-modal="true" aria-labelledby="session-expired-title">
      <div className="max-w-md rounded-lg border border-line bg-ink-1 p-6 text-paper">
        <h2 id="session-expired-title" className="font-display text-xl">Your session expired</h2>
        <p className="my-4 text-sm text-paper-dim">Your open draft is still here. Sign in in a new tab, then return to continue.</p>
        <a href="/sign-in" target="_blank" rel="noopener noreferrer" className="text-signal underline">Sign in</a>
        <Button className="ml-4" onClick={resume}>Continue here</Button>
        {message ? <p role="alert" className="mt-3 text-sm">{message}</p> : null}
      </div>
    </div> : null}
  </>;
}
