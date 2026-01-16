// Use global pdfjs loaded via script tag to avoid webpack bundling issues
declare global {
  interface Window {
    pdfjsLib: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (params: { data: ArrayBuffer }) => { promise: Promise<PDFDocument> };
    };
  }
}

interface PDFDocument {
  numPages: number;
  getPage: (num: number) => Promise<PDFPage>;
}

interface PDFPage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
}

let pdfJsLoaded = false;
let pdfJsPromise: Promise<void> | null = null;

/**
 * Loads PDF.js library via script tag (avoids webpack bundling issues)
 */
const loadPdfJs = (): Promise<void> => {
  if (pdfJsLoaded && window.pdfjsLib) {
    return Promise.resolve();
  }

  if (pdfJsPromise) {
    return pdfJsPromise;
  }

  pdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
    script.type = 'module';
    
    script.onload = () => {
      // Wait for the module to initialize and expose pdfjsLib
      const checkLib = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
          pdfJsLoaded = true;
          resolve();
        } else {
          setTimeout(checkLib, 50);
        }
      };
      checkLib();
    };
    
    script.onerror = () => {
      pdfJsPromise = null;
      reject(new Error('Failed to load PDF.js'));
    };
    
    document.head.appendChild(script);
  });

  return pdfJsPromise;
};

/**
 * Converts a PDF file (Blob) into an array of Base64 image strings.
 * @param file - The PDF file object.
 * @param range - Optional page range (start and end, 1-based).
 * @returns Array of base64 strings (image/jpeg).
 */
export const convertPdfToImages = async (
  file: File, 
  range?: { start?: number; end?: number }
): Promise<string[]> => {
  await loadPdfJs();
  
  const pdfjsLib = window.pdfjsLib;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: string[] = [];

  const startPage = range?.start ? Math.max(1, range.start) : 1;
  const endPage = range?.end ? Math.min(range.end, pdf.numPages) : pdf.numPages;

  // Iterate through pages in the specified range
  for (let i = startPage; i <= endPage; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 }); // 1.5 scale for better text clarity
    
    // Create an off-screen canvas
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const context = canvas.getContext('2d');
    
    if (!context) {
      throw new Error('Could not get canvas context');
    }
    
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    // Convert canvas to Base64 JPEG
    // splitting removes the "data:image/jpeg;base64," prefix which Gemini sometimes doesn't want duplicated
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? ''; 
    images.push(base64);
  }

  return images;
};
