'use client';

import { useState, useCallback, useRef, useEffect, type DragEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { convertPdfToImages } from '@/lib/pdfUtils';

// --- Types ---

type PageStatus = 'pending' | 'processing' | 'success' | 'error';

interface PageData {
  pageNumber: number;
  status: PageStatus;
  content: string;
  image: string; // Base64 image
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

interface ScannerProps {
  availableCredits: number | null;
  onCreditsUpdate?: (credits: number) => void;
}

// Pricing constants (per 1M tokens)
const PRICING = {
  INPUT_PER_1M: 0.50,
  OUTPUT_PER_1M: 3.00,
};

const calculateCost = (inputTokens: number, outputTokens: number) => {
  const inputCost = (inputTokens / 1_000_000) * PRICING.INPUT_PER_1M;
  const outputCost = (outputTokens / 1_000_000) * PRICING.OUTPUT_PER_1M;
  return inputCost + outputCost;
};

// --- Components ---

const Icons = {
  Upload: () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  File: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Refresh: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
  Copy: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Download: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  Alert: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Stop: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <rect x="9" y="9" width="6" height="6" />
    </svg>
  ),
};

// --- Main Page Component ---

export default function Scanner({ availableCredits, onCreditsUpdate }: ScannerProps) {
  const [pages, setPages] = useState<PageData[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [globalStatus, setGlobalStatus] = useState<'idle' | 'converting' | 'processing' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [pageRange, setPageRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [creditWarning, setCreditWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stopProcessingRef = useRef(false);
  const creditLabel = availableCredits === null ? '—' : availableCredits;

  const totalCost = pages.reduce((acc, page) => acc + (page.usage?.cost || 0), 0);

  // Process a single page
  const processPage = async (page: PageData, retries = 2) => {
    try {
      setPages(prev => prev.map(p => p.pageNumber === page.pageNumber ? { ...p, status: 'processing' } : p));

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: page.image, pageNumber: page.pageNumber }),
      });

      const data = await response.json();

      if (response.status === 401) {
        stopProcessingRef.current = true;
        setCreditWarning('Your session expired. Please sign in again.');
        setPages(prev => prev.map(p => p.pageNumber === page.pageNumber ? { ...p, status: 'error', content: 'Session expired.' } : p));
        return;
      }

      if (response.status === 402) {
        stopProcessingRef.current = true;
        setCreditWarning('You are out of credits. Buy more to continue scanning.');
        setPages(prev => prev.map(p => p.pageNumber === page.pageNumber ? { ...p, status: 'error', content: 'Insufficient credits.' } : p));
        if (typeof data?.creditsRemaining === 'number') {
          onCreditsUpdate?.(data.creditsRemaining);
        }
        return;
      }
      
      if (response.status === 429 && retries > 0) {
        const delay = (4 - retries) * 2000;
        console.warn(`Rate limited (429) on page ${page.pageNumber}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay)); 
        return processPage(page, retries - 1);
      }

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to process');
      }

      // Calculate Cost
      const inputTokens = data.usage?.promptTokenCount || 0;
      const outputTokens = data.usage?.candidatesTokenCount || 0;
      const cost = calculateCost(inputTokens, outputTokens);

      setPages(prev => prev.map(p => p.pageNumber === page.pageNumber ? { 
        ...p, 
        status: 'success', 
        content: data.text,
        usage: {
            inputTokens,
            outputTokens,
            cost
        }
      } : p));

      if (typeof data?.creditsRemaining === 'number') {
        onCreditsUpdate?.(data.creditsRemaining);
      }
    } catch (error) {
      console.error(`Error processing page ${page.pageNumber}:`, error);
      setPages(prev => prev.map(p => p.pageNumber === page.pageNumber ? { ...p, status: 'error', content: 'Failed to analyze page.' } : p));
    }
  };

  // Process queue with concurrency limit
  const processQueue = async (initialPages: PageData[]) => {
    stopProcessingRef.current = false;
    setGlobalStatus('processing');
    const concurrency = 1; // Process 1 page at a time to avoid rate limits
    const queue = [...initialPages];
    const processing = new Set<Promise<void>>();

    while (queue.length > 0 || processing.size > 0) {
      if (stopProcessingRef.current) break;

      // Update progress
      const completed = initialPages.length - (queue.length + processing.size); 
      
      while (processing.size < concurrency && queue.length > 0) {
        if (stopProcessingRef.current) break;
        
        const page = queue.shift();
        if (page) {
          const promise = processPage(page).then(async () => {
            // Add a small delay between requests to be nice to the API
            if (!stopProcessingRef.current) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            processing.delete(promise);
          });
          processing.add(promise);
        }
      }

      if (processing.size > 0) {
        await Promise.race(processing);
      }
    }

    setGlobalStatus('done');
  };

  const stopProcessing = () => {
    stopProcessingRef.current = true;
  };

  const retryFailedPages = () => {
    const failedPages = pages.filter(p => p.status === 'error');
    if (failedPages.length > 0) {
      processQueue(failedPages);
    }
  };

  // Effect to update progress bar based on completed pages
  useEffect(() => {
    if (pages.length === 0) return;
    const completedCount = pages.filter(p => p.status === 'success' || p.status === 'error').length;
    setProgress(Math.round((completedCount / pages.length) * 100));
  }, [pages]);

  const handleFileUpload = async (file: File) => {
    if (availableCredits === null) {
      alert('Loading your credit balance. Please try again in a moment.');
      return;
    }

    if (file.type !== 'application/pdf') {
      alert('Please upload a valid PDF file.');
      return;
    }

    setCreditWarning(null);
    setGlobalStatus('converting');
    setPages([]);
    setProgress(0);

    try {
      const start = parseInt(pageRange.start);
      const end = parseInt(pageRange.end);
      const range = {
        start: isNaN(start) ? undefined : start,
        end: isNaN(end) ? undefined : end
      };

      const images = await convertPdfToImages(file, range);
      
      if (images.length === 0) {
        alert('No pages found in the specified range.');
        setGlobalStatus('idle');
        return;
      }

      if (availableCredits < images.length) {
        setGlobalStatus('idle');
        setCreditWarning(`You have ${availableCredits} credits, but this range contains ${images.length} pages.`);
        alert('Not enough credits for this page range. Adjust the range or buy more credits.');
        return;
      }
      
      const newPages: PageData[] = images.map((img, index) => ({
        pageNumber: (range.start || 1) + index,
        status: 'pending',
        content: '',
        image: img
      }));

      setPages(newPages);
      
      // Start processing
      processQueue(newPages);

    } catch (error) {
      console.error(error);
      alert('Error converting PDF. Please try again.');
      setGlobalStatus('idle');
    }
  };

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add toast here
  };

  const downloadText = () => {
    const fullText = pages.map(p => `## Page ${p.pageNumber}\n\n${p.content}\n`).join('\n---\n\n');
    const blob = new Blob([fullText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extracted-text.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full">
      {creditWarning && (
        <div className="glass-panel rounded-xl p-4 mb-6 border border-amber-500/30 text-amber-200 text-sm">
          {creditWarning}
        </div>
      )}
      {/* Header */}
      <header className="text-center mb-12 animate-fade-in">
        <h1 className="text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
          PageSentry Scanner
        </h1>
        <p className="text-slate-400 text-lg">
          Extract structured text and tables using Gemini 2.0 Flash
        </p>
        <p className="text-xs text-slate-500 mt-3">
          1 credit = 1 page scanned • {creditLabel} credits available
        </p>
      </header>

      {/* Upload Zone */}
      {pages.length === 0 && globalStatus !== 'converting' && (
        <div 
          className={`
            glass-panel rounded-2xl p-16 text-center transition-all duration-300 cursor-pointer border-2 border-dashed
            ${isDragOver ? 'border-indigo-400 bg-indigo-500/10 scale-[1.02]' : 'border-slate-700 hover:border-slate-500'}
            animate-fade-in
          `}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef}
            className="hidden" 
            accept="application/pdf"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
          />
          <div 
            className="mb-8 flex gap-4 justify-center items-center z-10 relative" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-start">
              <label className="text-xs text-slate-400 mb-1 font-medium">Start Page</label>
              <input 
                type="number" 
                placeholder="1" 
                min="1"
                value={pageRange.start}
                onChange={(e) => setPageRange(prev => ({ ...prev, start: e.target.value }))}
                className="bg-slate-800/50 border border-slate-700 rounded px-3 py-2 w-24 text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <div className="flex flex-col items-start">
              <label className="text-xs text-slate-400 mb-1 font-medium">End Page</label>
              <input 
                type="number" 
                placeholder="Max" 
                min="1"
                value={pageRange.end}
                onChange={(e) => setPageRange(prev => ({ ...prev, end: e.target.value }))}
                className="bg-slate-800/50 border border-slate-700 rounded px-3 py-2 w-24 text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          <div className="text-indigo-400 mb-6 flex justify-center">
            <Icons.Upload />
          </div>
          <h3 className="text-2xl font-semibold mb-2 text-slate-200">Drop your PDF here</h3>
          <p className="text-slate-500">or click to browse</p>
        </div>
      )}

      {/* Processing State */}
      {(globalStatus === 'converting' || (pages.length > 0 && globalStatus !== 'idle')) && (
        <div className="space-y-8 animate-fade-in">
          
          {/* Progress Bar */}
          <div className="glass-panel rounded-xl p-6 sticky top-6 z-50 backdrop-blur-xl">
            <div className="flex justify-between items-end mb-2">
              <div>
                <span className="text-2xl font-bold text-slate-200">{progress}%</span>
                <span className="text-slate-400 ml-2 text-sm">
                  {globalStatus === 'converting' ? 'Converting PDF...' : `Processing ${pages.length} pages`}
                </span>
                {/* NEW: Total Cost Display */}
                {totalCost > 0 && (
                  <span className="ml-4 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-full">
                    ${totalCost.toFixed(6)} est. cost
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {globalStatus === 'processing' && (
                  <button 
                    onClick={stopProcessing}
                    className="glass-button px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium text-rose-300 hover:text-rose-200 hover:bg-rose-500/20 border border-rose-500/30 transition-all"
                  >
                    <Icons.Stop /> Stop
                  </button>
                )}
                {pages.some(p => p.status === 'error') && globalStatus !== 'processing' && (
                  <button 
                    onClick={retryFailedPages}
                    className="glass-button px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium text-rose-300 hover:text-rose-200 hover:bg-rose-500/20 border border-rose-500/30 transition-all"
                  >
                    <Icons.Refresh /> Retry Failed
                  </button>
                )}
                {globalStatus === 'done' && (
                  <button 
                    onClick={downloadText}
                    className="glass-button px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium text-slate-200 hover:text-white hover:bg-white/10"
                  >
                    <Icons.Download /> Download Markdown
                  </button>
                )}
                 {globalStatus === 'done' && (
                  <button 
                    onClick={() => window.location.reload()} // Simple reset
                    className="glass-button px-4 py-2 rounded-lg text-sm font-medium text-slate-200 hover:text-white hover:bg-white/10"
                  >
                   New PDF
                  </button>
                )}
              </div>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Grid View */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {pages.map((page) => (
              <div 
                key={page.pageNumber} 
                className={`
                  glass-panel rounded-xl overflow-hidden transition-all duration-500
                  ${page.status === 'processing' ? 'ring-2 ring-indigo-500/50' : ''}
                `}
              >
                {/* Header */}
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-300">Page {page.pageNumber}</span>
                    {/* NEW: Page Cost Display */}
                    {page.usage && (
                       <span className="text-[10px] text-slate-500">
                         {page.usage.inputTokens + page.usage.outputTokens} tokens (${page.usage.cost.toFixed(5)})
                       </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {page.status === 'pending' && <span className="text-slate-500 text-xs uppercase tracking-wider">Pending</span>}
                    {page.status === 'processing' && (
                      <div className="flex items-center gap-2 text-indigo-400">
                        <div className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-[spin_1s_linear_infinite]" />
                        <span className="text-xs font-medium">Analyzing...</span>
                      </div>
                    )}
                    {page.status === 'success' && (
                      <div className="flex items-center gap-2">
                         <span className="text-emerald-400 flex items-center gap-1 text-xs font-medium">
                          <Icons.Check /> Done
                        </span>
                        <button 
                          onClick={() => copyToClipboard(page.content)}
                          className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors"
                          title="Copy text"
                        >
                          <Icons.Copy />
                        </button>
                      </div>
                    )}
                    {page.status === 'error' && (
                      <div className="flex items-center gap-2">
                        <span className="text-rose-400 flex items-center gap-1 text-xs font-medium">
                          <Icons.Alert /> Error
                        </span>
                        <button 
                          onClick={() => processPage(page)}
                          className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors"
                          title="Retry"
                        >
                          <Icons.Refresh />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="p-0 grid grid-cols-2 min-h-[300px]">
                  {/* Image Preview */}
                  <div className="bg-black/20 p-4 flex items-center justify-center border-r border-white/5 relative group">
                    <img 
                      src={`data:image/jpeg;base64,${page.image}`} 
                      alt={`Page ${page.pageNumber}`}
                      className="max-w-full max-h-[400px] shadow-lg rounded-sm opacity-90 transition-opacity group-hover:opacity-100"
                    />
                  </div>

                  {/* Text Result */}
                  <div className="p-6 max-h-[500px] overflow-y-auto custom-scrollbar">
                    {page.status === 'success' ? (
                      <div className="prose prose-invert prose-sm max-w-none">
                         <ReactMarkdown
                          components={{
                            table: ({ children }) => (
                              <div className="overflow-x-auto my-4 border border-slate-700 rounded-lg">
                                <table className="w-full text-left text-sm border-collapse">{children}</table>
                              </div>
                            ),
                            thead: ({ children }) => <thead className="bg-white/5 text-slate-200">{children}</thead>,
                            th: ({ children }) => <th className="p-3 border-b border-slate-700 font-semibold">{children}</th>,
                            td: ({ children }) => <td className="p-3 border-b border-slate-700/50 text-slate-400">{children}</td>,
                            h1: ({ children }) => <h1 className="text-xl font-bold text-slate-100 mt-4 mb-2">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-lg font-semibold text-slate-200 mt-3 mb-2">{children}</h2>,
                            p: ({ children }) => <p className="mb-2 text-slate-300 leading-relaxed">{children}</p>,
                            ul: ({ children }) => <ul className="list-disc list-inside mb-2 text-slate-300">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal list-inside mb-2 text-slate-300">{children}</ol>,
                            code: ({ children }) => <code className="bg-black/30 px-1 py-0.5 rounded text-pink-400 font-mono text-xs">{children}</code>,
                          }}
                        >
                          {page.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-600 italic">
                        {page.status === 'processing' ? 'Extracting text...' : 
                         page.status === 'error' ? 'Failed to extract text.' : 
                         'Waiting to start...'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  );
}
