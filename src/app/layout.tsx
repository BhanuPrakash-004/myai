import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"MyAI — Personal Second Brain",description:"Private, self-hosted personal knowledge."};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="en" className="dark h-full antialiased"><body className="h-full bg-ink-0 text-paper flex overflow-hidden">{children}</body></html>;
}
