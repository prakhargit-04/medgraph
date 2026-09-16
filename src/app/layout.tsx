import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TopNavigationBar, LeftSidebar } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "MedGraph - Clinical Medication Safety Intelligence",
  description: "MedGraph turns a fragmented medication list into an evidence-grounded safety graph.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col font-sans select-none overflow-x-hidden text-slate-900 bg-slate-50 dark:bg-slate-950 dark:text-slate-100 custom-bg-gradient transition-colors duration-300">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TopNavigationBar />
          <div className="flex-1 flex w-full max-w-[1780px] mx-auto overflow-hidden">
            <LeftSidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
              {children}
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
