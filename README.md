# PageSentry

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

1. **PDF.js** converts each PDF page to an image on the client side.
2. The secured `/api/analyze` route checks auth + credits, then calls Gemini.
3. Credits are deducted per successful page and usage is stored in Convex.
4. Results stream into the scanner UI with Markdown rendering.

## Tech Stack

- [Next.js 15](https://nextjs.org/) - React framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Convex](https://convex.dev/) - Database + server functions
- [Better Auth](https://better-auth.com/) - Authentication
- [Google Gemini API](https://ai.google.dev/) - Vision model for text extraction
- [PDF.js](https://mozilla.github.io/pdf.js/) - PDF rendering
