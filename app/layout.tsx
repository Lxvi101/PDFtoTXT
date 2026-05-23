import type { Metadata } from 'next';
import './globals.css';
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { getToken } from "@/lib/auth-server";

export const metadata: Metadata = {
  metadataBase: new URL('https://docmind.paperize.store'),
  title: 'DocMind - Secure PDF Scanning SaaS',
  description: 'Account-secured PDF scanning with credit-based billing and Gemini 2.0 Flash extraction.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = await getToken();
  
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Syncopate:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ConvexClientProvider initialToken={token}>
            {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
