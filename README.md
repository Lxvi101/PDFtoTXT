# DocMind

Account-secured PDF scanning SaaS with credit-based billing, powered by
Convex + Better Auth + Gemini 2.0 Flash.

## Features

- **Account-secured scanning** with Better Auth sessions.
- **Credit-based billing** (1 credit = 1 page). New users receive **100 free credits**.
- **Convex-backed ledger** for credits, purchases, and usage.
- **Modern glass UI** with a landing page, billing cards, and activity feed.
- **Progressive page scanning** with Markdown exports and retry support.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables (see `.env.example`):

```
GEMINI_API_KEY=your_api_key_here
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
BETTER_AUTH_SECRET=your_secure_secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
CONVEX_URL=your_convex_deployment_url
```

3. Start Convex (first time will generate deployment keys):

```bash
npx convex dev
```

4. Run the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## How it Works

1. The browser uploads the PDF directly to **Vercel Blob** (avoids Vercel function payload limits).
2. The secured `/api/scan` route validates auth + credits, then queues Trigger.dev with the blob URL.
3. Trigger.dev downloads, splits, and OCRs pages with Gemini in parallel.
4. Results stream into the scanner UI with Markdown rendering, with refunds for failed pages.

## Tech Stack

- [Next.js 15](https://nextjs.org/) - React framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Convex](https://convex.dev/) - Database + server functions
- [Better Auth](https://better-auth.com/) - Authentication
- [Google Gemini API](https://ai.google.dev/) - Vision model for text extraction
- [PDF.js](https://mozilla.github.io/pdf.js/) - PDF rendering
