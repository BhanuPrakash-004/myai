import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ownerSession } from "./server";
import { asOwner } from "../storage/access";

export async function withPageOwner<T>(work: () => Promise<T>): Promise<T> {
  const requestHeaders = await headers();
  const session = await ownerSession(requestHeaders);
  if (!session) redirect("/sign-in?reason=expired&returnTo=" + encodeURIComponent(requestHeaders.get("x-myai-return-to") || "/knowledge"));
  return asOwner(session.user.id, work);
}
