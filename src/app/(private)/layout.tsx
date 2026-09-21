import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { withPageOwner } from "@/lib/auth/page";
export const dynamic = "force-dynamic";
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  await withPageOwner(async () => undefined);
  return <><a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-ink-1 focus:p-3">Skip to content</a><Sidebar /><div className="flex flex-1 flex-col overflow-hidden min-w-0"><Header /><main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto bg-ink-0">{children}</main></div></>;
}
