import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PageSentry - Secure PDF Scanning SaaS',
  description: 'Account-secured PDF scanning with credit-based billing and Gemini 2.0 Flash extraction.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
