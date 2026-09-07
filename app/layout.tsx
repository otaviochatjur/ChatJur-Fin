import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TallyEmbedLoader } from "@/components/tally-embed-loader";
import { PointerEventsGuard } from "@/components/pointer-events-guard";

export const metadata: Metadata = {
  title: "Chat Jurídico Financeiro",
  description: "Gestão financeira, Chat Jurídico Connect e comercial do Chat Jurídico.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
        {children}
        <Toaster position="top-right" />
        <TallyEmbedLoader />
        <PointerEventsGuard />
        </ThemeProvider>
      </body>
    </html>
  );
}
