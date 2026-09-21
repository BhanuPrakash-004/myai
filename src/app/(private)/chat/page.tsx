import { ChatPanel } from "@/components/knowledge/chat-panel";
import { z } from "zod";
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ session?: string; message?: string }> }) {
 const { session, message } = await searchParams;
 return <ChatPanel initialSessionId={z.uuid().safeParse(session).success ? session : undefined} initialMessageId={z.uuid().safeParse(message).success ? message : undefined} />;
}
