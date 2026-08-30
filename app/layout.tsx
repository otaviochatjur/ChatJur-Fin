import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "Chat Jurídico Financeiro",
  description: "Gestão financeira, parceiros, comerciais externos e links de pagamento do Chat Jurídico.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className="antialiased">{children}<Toaster position="top-right" /></body></html>;
}
