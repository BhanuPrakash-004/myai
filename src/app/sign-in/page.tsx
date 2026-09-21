import { SignInForm } from "./sign-in-form";
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; reason?: string }> }) {
  const params = await searchParams;
  const returnTo = params.returnTo?.startsWith("/") && !params.returnTo.startsWith("//") && !params.returnTo.includes("\\") ? params.returnTo : "/knowledge";
  return <main className="m-auto w-full max-w-md p-6"><p className="eyebrow">MyAI / Private workspace</p><h1 className="font-display mt-3 text-3xl">Sign in to your second brain</h1>
    <p className="mt-3 text-sm text-paper-dim">Use the owner account provisioned on your server.</p>
    {params.reason === "expired" ? <p role="status" className="mt-3 text-sm text-signal">Sign in to continue where you left off.</p> : null}
    <SignInForm returnTo={returnTo} />
    <p className="mt-6 text-xs text-mist">This installation has no public signup. Account setup and password recovery are available to its server owner through the local maintenance commands.</p>
  </main>;
}
