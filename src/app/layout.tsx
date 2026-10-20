import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Medical LLM Physician Evaluation",
  description: "Blinded physician evaluation of clinical responses",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
