# PDF to Text

Extract text and tables from PDFs using Google Gemini 2.0 Flash.

## Features

- **Modern & Stunning UI**: Glassmorphism design with intuitive drag-and-drop interface.
- **Progressive Processing**: Visualizes page-by-page analysis with real-time status.
- **Concurrent Analysis**: Processes multiple pages simultaneously (up to 3) for faster results.
- **Interactive Results**:
  - Grid view of all pages with image previews.
  - Markdown rendering with table support.
  - Copy individual page content.
  - Download full document as Markdown.
- **Robust Error Handling**: Retry individual failed pages without restarting the entire process.

## Setup

1. Install dependencies:

```bash
bun install
```

2. Create a `.env.local` file with your Gemini API key:

```
GEMINI_API_KEY=your_api_key_here
```

3. Run the development server:

```bash
bun dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## How it Works

1. **PDF.js** converts each PDF page to an image on the client side.
2. Images are sent to a **Next.js API route** that calls the Gemini API.
3. Gemini extracts text and tables from each page image.
4. Results are displayed progressively as each page is processed.

## Tech Stack

- [Next.js 15](https://nextjs.org/) - React framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [PDF.js](https://mozilla.github.io/pdf.js/) - PDF rendering
- [Google Gemini API](https://ai.google.dev/) - Vision model for text extraction
- [React Markdown](https://github.com/remarkjs/react-markdown) - Markdown rendering
- [Bun](https://bun.sh/) - Runtime & Package Manager
