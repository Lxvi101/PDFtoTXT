'use client';

import { useState, useCallback, useRef, useEffect, type DragEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { upload } from '@vercel/blob/client';
import { convertPdfToImages } from '@/lib/pdfUtils';

// --- Types ---

type PageStatus = 'pending' | 'processing' | 'success' | 'error';

interface PageData {
  pageNumber: number;
  status: PageStatus;
  content: string;
  image: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

type GlobalStatus = 'idle' | 'converting' | 'uploading' | 'processing' | 'retrying' | 'done' | 'failed' | 'stopped';

/** Minimal fields from Convex `scanRuns` to resume polling after refresh */
export type ScanResumePayload = {
  triggerRunId: string;
  requestId: string;
  pageCount: number;
  pageStart: number;
};

interface ScannerProps {
  availableCredits: number | null;
  onCreditsUpdate?: (credits: number) => void;
  /** Active run from Convex — resume UI when idle (e.g. after refresh) */
  resumeRun?: ScanResumePayload | null;
  /** Convex + dashboard refresh after a run reaches a terminal state */
  onScanTerminal?: () => void;
  /** After a new run is successfully queued (Convex row created server-side) */
  onScanStarted?: () => void;
}

const sanitizeFilename = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '-');

// --- Icons ---

const Icons = {
  Upload: () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
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
  Cloud: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  ),
};

// --- Main Component ---

export default function Scanner({
  availableCredits,
  onCreditsUpdate,
  resumeRun = null,
  onScanTerminal,
  onScanStarted,
}: ScannerProps) {
  const [pages, setPages] = useState<PageData[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [globalStatus, setGlobalStatus] = useState<GlobalStatus>('idle');
  const [pageRange, setPageRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [creditWarning, setCreditWarning] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [liveCompleted, setLiveCompleted] = useState(0);
  const [liveFailed, setLiveFailed] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [stoppedReason, setStoppedReason] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const usageRecordedRef = useRef(false);
  const scanTerminalNotifiedRef = useRef(false);
  const previewImagesRef = useRef<string[]>([]);
  const startPageRef = useRef(1);
  /** Run IDs the user dismissed with "New PDF" so we don't auto-resume them */
  const skippedResumeIds = useRef<Set<string>>(new Set());

  const totalCost = pages.reduce((acc, page) => acc + (page.usage?.cost || 0), 0);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Poll Trigger.dev run for results + real-time progress ──
  const startPolling = useCallback((id: string, reqId: string, count: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    usageRecordedRef.current = false;
    scanTerminalNotifiedRef.current = false;

    const poll = async () => {
      try {
        const params = new URLSearchParams({ requestId: reqId, pageCount: String(count) });
        if (!usageRecordedRef.current) {
          params.set("recordUsage", "1");
        }

        const res = await fetch(`/api/scan/${id}?${params.toString()}`);
        if (!res.ok) return;

        const data = await res.json();

        // ── Real-time progress from metadata ──
        if (data.progress) {
          const p = data.progress;
          setLiveCompleted(p.completedCount ?? 0);
          setLiveFailed(p.failedCount ?? 0);
          setRetryAttempt(p.retryAttempt ?? 0);

          if (p.phase === 'retrying') {
            setGlobalStatus('retrying');
          }
          if (p.phase === 'stopped') {
            setStoppedReason(p.stoppedReason ?? 'Processing stopped due to too many failures.');
          }

          // Update per-page statuses in real-time
          if (p.pageStatuses) {
            setPages(prev => prev.map(page => {
              const liveStatus = p.pageStatuses[String(page.pageNumber)] as PageStatus | undefined;
              if (liveStatus && liveStatus !== page.status && page.status !== 'success') {
                return { ...page, status: liveStatus };
              }
              return page;
            }));
          }
        }

        // ── Terminal states ──
        if (data.status === 'completed' && data.output) {
          usageRecordedRef.current = true;
          if (pollRef.current) clearInterval(pollRef.current);

          const images = previewImagesRef.current;
          const sPage = startPageRef.current;

          const resultPages: PageData[] = data.output.pages.map((p: any, idx: number) => ({
            pageNumber: p.pageNumber || (sPage + idx),
            status: p.status === 'success' ? 'success' as const : 'error' as const,
            content: p.text || (p.status === 'error' ? (p.error || 'Failed to extract text.') : ''),
            image: images[p.pageNumber ? p.pageNumber - sPage : idx] || '',
            usage: p.status === 'success' ? {
              inputTokens: p.inputTokens,
              outputTokens: p.outputTokens,
              cost: p.cost,
            } : undefined,
          }));

          setPages(resultPages);
          setLiveCompleted(data.output.summary.successCount);
          setLiveFailed(data.output.summary.failedCount);

          if (data.output.summary.stoppedEarly) {
            setGlobalStatus('stopped');
            setStoppedReason(data.output.summary.stoppedReason ?? 'Stopped due to repeated failures.');
          } else {
            setGlobalStatus('done');
          }

          // Update credits (account for refunded failures + unattempted pages)
          const refunded = data.output.summary.failedCount +
            (data.output.summary.stoppedEarly
              ? count - data.output.pages.length
              : 0);
          if (refunded > 0 && availableCredits !== null && availableCredits !== Infinity) {
            onCreditsUpdate?.((availableCredits ?? 0) + refunded);
          }

          if (!scanTerminalNotifiedRef.current) {
            scanTerminalNotifiedRef.current = true;
            onScanTerminal?.();
          }
        } else if (data.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setGlobalStatus('failed');
          setCreditWarning('Cloud processing failed. Your credits have been refunded.');
          if (availableCredits !== null && availableCredits !== Infinity) {
            onCreditsUpdate?.((availableCredits ?? 0) + count);
          }

          if (!scanTerminalNotifiedRef.current) {
            scanTerminalNotifiedRef.current = true;
            onScanTerminal?.();
          }
        }
      } catch {
        // Network error — will retry on next interval
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
  }, [availableCredits, onCreditsUpdate, onScanTerminal]);

  // Resume active run from Convex when the console is idle (e.g. after refresh)
  useEffect(() => {
    if (!resumeRun) return;
    if (runId !== null) return;
    if (globalStatus !== 'idle') return;
    if (pages.length > 0) return;
    if (skippedResumeIds.current.has(resumeRun.triggerRunId)) return;

    const start = resumeRun.pageStart;
    const placeholders: PageData[] = Array.from({ length: resumeRun.pageCount }, (_, i) => ({
      pageNumber: start + i,
      status: 'pending' as PageStatus,
      content: '',
      image: '',
    }));
    setPages(placeholders);
    setPageCount(resumeRun.pageCount);
    setRunId(resumeRun.triggerRunId);
    setGlobalStatus('processing');
    startPolling(resumeRun.triggerRunId, resumeRun.requestId, resumeRun.pageCount);
  }, [resumeRun, startPolling, runId, globalStatus, pages.length]);

  // ── Handle file upload ──
  const handleFileUpload = async (file: File) => {
    if (availableCredits === null) {
      alert('Loading your credit balance. Please try again in a moment.');
      return;
    }

    if (file.type !== 'application/pdf') {
      alert('Please upload a valid PDF file.');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      alert('PDF must be under 20 MB.');
      return;
    }

    setCreditWarning(null);
    setStoppedReason(null);
    skippedResumeIds.current.clear();
    setGlobalStatus('converting');
    setPages([]);
    setLiveCompleted(0);
    setLiveFailed(0);
    setRetryAttempt(0);
    setRunId(null);

    try {
      const start = parseInt(pageRange.start);
      const end = parseInt(pageRange.end);
      const range = {
        start: isNaN(start) ? undefined : start,
        end: isNaN(end) ? undefined : end,
      };

      const images = await convertPdfToImages(file, range);

      if (images.length === 0) {
        alert('No pages found in the specified range.');
        setGlobalStatus('idle');
        return;
      }

      if (availableCredits !== Infinity && availableCredits < images.length) {
        setGlobalStatus('idle');
        setCreditWarning(`You have ${availableCredits} credits, but this range contains ${images.length} pages.`);
        return;
      }

      const startPage = range.start || 1;
      previewImagesRef.current = images;
      startPageRef.current = startPage;

      const previewPages: PageData[] = images.map((img, index) => ({
        pageNumber: startPage + index,
        status: 'pending' as PageStatus,
        content: '',
        image: img,
      }));

      setPages(previewPages);
      setPageCount(images.length);
      setGlobalStatus('uploading');

      const uploadPath = `scan-pdfs/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
      let uploadedBlob;
      try {
        uploadedBlob = await upload(uploadPath, file, {
          access: 'public',
          handleUploadUrl: '/api/uploads/pdf',
        });
      } catch (publicUploadError) {
        // Some stores are configured as private-only; retry with private access.
        uploadedBlob = await upload(uploadPath, file, {
          access: 'private',
          handleUploadUrl: '/api/uploads/pdf',
        });
        console.warn('Public blob upload failed, fell back to private access.', publicUploadError);
      }

      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobUrl: uploadedBlob.url,
          pageStart: range.start,
          pageEnd: range.end,
        }),
      });
      const data = await res.json();

      if (res.status === 401) {
        setCreditWarning('Your session expired. Please sign in again.');
        setGlobalStatus('idle');
        setPages([]);
        return;
      }

      if (res.status === 402) {
        setCreditWarning(`Insufficient credits. You need ${data.required} but have ${data.available}.`);
        setGlobalStatus('idle');
        setPages([]);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start scan');
      }

      setRunId(data.runId);
      setPageCount(data.pageCount);
      setGlobalStatus('processing');

      if (typeof data.creditsRemaining === 'number') {
        onCreditsUpdate?.(data.creditsRemaining);
      }

      startPolling(data.runId, data.requestId, data.pageCount);
      onScanStarted?.();

    } catch (error) {
      console.error(error);
      alert('Error starting scan. Please try again.');
      setGlobalStatus('idle');
      setPages([]);
    }
  };

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [availableCredits, pageRange]);

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
  };

  const downloadText = () => {
    const successPages = pages.filter(p => p.status === 'success');
    const fullText = successPages.map(p => `## Page ${p.pageNumber}\n\n${p.content}\n`).join('\n---\n\n');
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

  const resetScanner = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (runId) skippedResumeIds.current.add(runId);
    setPages([]);
    setGlobalStatus('idle');
    setRunId(null);
    setPageCount(0);
    setLiveCompleted(0);
    setLiveFailed(0);
    setRetryAttempt(0);
    setCreditWarning(null);
    setStoppedReason(null);
    previewImagesRef.current = [];
  };

  // Status label
  const statusLabel = (() => {
    switch (globalStatus) {
      case 'converting': return 'Converting PDF...';
      case 'uploading': return 'Uploading to cloud...';
      case 'processing':
        return `${liveCompleted} of ${pageCount} pages scanned` +
          (liveFailed > 0 ? ` (${liveFailed} failed)` : '');
      case 'retrying':
        return `Retrying ${liveFailed} failed pages (attempt ${retryAttempt})`;
      case 'done':
        return `${liveCompleted} pages extracted` +
          (liveFailed > 0 ? `, ${liveFailed} failed` : '');
      case 'stopped':
        return `Stopped — ${liveCompleted} extracted, ${liveFailed} failed`;
      case 'failed': return 'Processing failed';
      default: return '';
    }
  })();

  const isTerminal = globalStatus === 'done' || globalStatus === 'failed' || globalStatus === 'stopped';
  const hasSuccessPages = pages.some(p => p.status === 'success');

  return (
    <div className="w-full">
      {creditWarning && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-4 rounded-lg text-sm font-mono mb-6">
          {creditWarning}
        </div>
      )}

      {stoppedReason && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg text-sm font-mono mb-6">
          {stoppedReason}
        </div>
      )}

      {/* Upload Zone */}
      {pages.length === 0 && globalStatus === 'idle' && (
        <div
          className={`
            group border border-dashed transition-all duration-300 cursor-pointer min-h-[300px] flex flex-col items-center justify-center p-16
            ${isDragOver ? 'border-[#CCFF00] bg-[#CCFF00]/5' : 'border-white/10 hover:border-white/20 hover:bg-white/5'}
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
              <label className="text-xs text-white/40 mb-1 font-medium">Start Page</label>
              <input
                type="number"
                placeholder="1"
                min="1"
                value={pageRange.start}
                onChange={(e) => setPageRange(prev => ({ ...prev, start: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded px-3 py-2 w-24 text-slate-200 focus:outline-none focus:border-[#CCFF00]/50 transition-colors"
              />
            </div>
            <div className="flex flex-col items-start">
              <label className="text-xs text-white/40 mb-1 font-medium">End Page</label>
              <input
                type="number"
                placeholder="Max"
                min="1"
                value={pageRange.end}
                onChange={(e) => setPageRange(prev => ({ ...prev, end: e.target.value }))}
                className="bg-white/5 border border-white/10 rounded px-3 py-2 w-24 text-slate-200 focus:outline-none focus:border-[#CCFF00]/50 transition-colors"
              />
            </div>
          </div>

          <div className="text-white/20 mb-6 flex justify-center group-hover:text-[#CCFF00] transition-colors">
            <Icons.Upload />
          </div>
          <h3 className="text-xl font-bold mb-2 text-white font-[Syncopate]">INITIATE SCAN</h3>
          <p className="text-white/40 font-mono text-xs">DROP PDF OR CLICK TO BROWSE</p>
          <p className="text-white/20 font-mono text-[10px] mt-2 flex items-center gap-1">
            <Icons.Cloud /> POWERED BY TRIGGER.DEV CLOUD
          </p>
        </div>
      )}

      {/* Processing / Results State */}
      {(globalStatus !== 'idle' || pages.length > 0) && (
        <div className="space-y-8 animate-fade-in">

          {/* Progress Bar */}
          <div className="bg-[#0A0A0A] border border-white/10 rounded-xl p-6 sticky top-6 z-50">
            <div className="flex justify-between items-end mb-2">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-slate-200">
                    {isTerminal ? (globalStatus === 'failed' ? '!' : `${liveCompleted}/${pageCount}`) : `${liveCompleted}/${pageCount}`}
                  </span>
                  <span className="text-slate-400 text-sm">{statusLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                  {totalCost > 0 && (
                    <span className="px-2 py-0.5 bg-[#CCFF00]/10 border border-[#CCFF00]/20 text-[#CCFF00] text-[10px] font-mono rounded">
                      ${totalCost.toFixed(6)} est. cost
                    </span>
                  )}
                  {runId && (
                    <span className="px-2 py-0.5 bg-white/5 border border-white/10 text-white/30 text-[10px] font-mono rounded">
                      RUN {runId.slice(0, 8)}
                    </span>
                  )}
                  {globalStatus === 'retrying' && (
                    <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-mono rounded">
                      RETRY PASS {retryAttempt}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {(globalStatus === 'done' || globalStatus === 'stopped') && hasSuccessPages && (
                  <button
                    onClick={downloadText}
                    className="tech-button px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium"
                  >
                    <Icons.Download /> Download Markdown
                  </button>
                )}
                {isTerminal && (
                  <button
                    onClick={resetScanner}
                    className="tech-button px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium"
                  >
                    {globalStatus === 'done' ? 'New PDF' : <><Icons.Refresh /> Try Again</>}
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-white/5 rounded-full overflow-hidden flex">
              {/* Success portion */}
              <div
                className="h-full bg-[#CCFF00] transition-all duration-500 ease-out"
                style={{ width: pageCount > 0 ? `${(liveCompleted / pageCount) * 100}%` : '0%' }}
              />
              {/* Failed portion */}
              <div
                className="h-full bg-red-500 transition-all duration-500 ease-out"
                style={{ width: pageCount > 0 ? `${(liveFailed / pageCount) * 100}%` : '0%' }}
              />
              {/* Processing pulse (remaining) */}
              {!isTerminal && pageCount > 0 && (
                <div
                  className="h-full bg-[#CCFF00]/20 animate-pulse transition-all duration-500"
                  style={{ width: `${((pageCount - liveCompleted - liveFailed) / pageCount) * 100}%` }}
                />
              )}
            </div>

            {!isTerminal && (
              <p className="text-[10px] text-white/20 font-mono mt-2">
                Up to 5 pages run in parallel; progress updates as each page finishes. See Trigger.dev for full logs.
              </p>
            )}
          </div>

          {/* Grid View */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {pages.map((page) => (
              <div
                key={page.pageNumber}
                className={`
                  bg-[#0A0A0A] border border-white/10 rounded-xl overflow-hidden transition-all duration-500
                  ${page.status === 'processing' ? 'ring-2 ring-[#CCFF00]/50' : ''}
                `}
              >
                {/* Header */}
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                  <div className="flex flex-col">
                    <span className="font-medium text-slate-300">Page {page.pageNumber}</span>
                    {page.usage && (
                       <span className="text-[10px] text-slate-500">
                         {page.usage.inputTokens + page.usage.outputTokens} tokens (${page.usage.cost.toFixed(5)})
                       </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {page.status === 'pending' && <span className="text-slate-500 text-xs uppercase tracking-wider">Queued</span>}
                    {page.status === 'processing' && (
                      <div className="flex items-center gap-2 text-[#CCFF00]">
                        <div className="w-4 h-4 border-2 border-[#CCFF00]/30 border-t-[#CCFF00] rounded-full animate-spin" />
                        <span className="text-xs font-medium">Scanning...</span>
                      </div>
                    )}
                    {page.status === 'success' && (
                      <div className="flex items-center gap-2">
                         <span className="text-[#CCFF00] flex items-center gap-1 text-xs font-medium">
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
                      <span className="text-rose-400 flex items-center gap-1 text-xs font-medium">
                        <Icons.Alert /> Failed
                      </span>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="p-0 grid grid-cols-2 min-h-[300px]">
                  {/* Image Preview */}
                  <div className="bg-[#050505] p-4 flex items-center justify-center border-r border-white/5 relative group">
                    {page.image ? (
                      <img
                        src={`data:image/jpeg;base64,${page.image}`}
                        alt={`Page ${page.pageNumber}`}
                        className="max-w-full max-h-[400px] shadow-lg rounded-sm opacity-90 transition-opacity group-hover:opacity-100"
                      />
                    ) : (
                      <div className="text-white/10 text-xs font-mono">No preview</div>
                    )}
                  </div>

                  {/* Text Result */}
                  <div className="p-6 max-h-[500px] overflow-y-auto custom-scrollbar">
                    {page.status === 'success' ? (
                      <div className="prose prose-invert prose-sm max-w-none">
                         <ReactMarkdown
                          components={{
                            table: ({ children }) => (
                              <div className="overflow-x-auto my-4 border border-white/10 rounded-lg">
                                <table className="w-full text-left text-sm border-collapse">{children}</table>
                              </div>
                            ),
                            thead: ({ children }) => <thead className="bg-white/5 text-slate-200">{children}</thead>,
                            th: ({ children }) => <th className="p-3 border-b border-white/10 font-semibold">{children}</th>,
                            td: ({ children }) => <td className="p-3 border-b border-white/5 text-slate-400">{children}</td>,
                            h1: ({ children }) => <h1 className="text-xl font-bold text-slate-100 mt-4 mb-2">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-lg font-semibold text-slate-200 mt-3 mb-2">{children}</h2>,
                            p: ({ children }) => <p className="mb-2 text-slate-300 leading-relaxed">{children}</p>,
                            ul: ({ children }) => <ul className="list-disc list-inside mb-2 text-slate-300">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal list-inside mb-2 text-slate-300">{children}</ol>,
                            code: ({ children }) => <code className="bg-[#CCFF00]/10 px-1 py-0.5 rounded text-[#CCFF00] font-mono text-xs">{children}</code>,
                          }}
                        >
                          {page.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-slate-600 italic text-sm">
                        {page.status === 'processing' ? (
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-6 h-6 border-2 border-[#CCFF00]/20 border-t-[#CCFF00] rounded-full animate-spin" />
                            <span>Scanning page...</span>
                          </div>
                        ) : page.status === 'error' ? (
                          <div className="flex flex-col items-center gap-2 text-rose-400/70">
                            <Icons.Alert />
                            <span>{page.content || 'Failed to extract text.'}</span>
                          </div>
                        ) : (
                          <span className="text-white/20">Queued</span>
                        )}
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
