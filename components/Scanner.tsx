'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { upload } from '@vercel/blob/client';
import { convertPdfToImages } from '@/lib/pdfUtils';

type PageStatus = 'pending' | 'processing' | 'success' | 'error';
type RunStatus = 'queued' | 'converting' | 'uploading' | 'processing' | 'retrying' | 'completed' | 'failed' | 'stopped';

type PageResult = {
  pageNumber: number;
  status: 'success' | 'error';
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  error?: string;
};

type ScanOutput = {
  pages: PageResult[];
  summary: {
    totalPages: number;
    successCount: number;
    failedCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    stoppedEarly: boolean;
    stoppedReason?: string;
  };
};

type ScanProgress = {
  phase: 'splitting' | 'processing' | 'retrying' | 'done' | 'stopped';
  totalPages: number;
  completedCount: number;
  failedCount: number;
  retryAttempt: number;
  pageStatuses: Record<string, PageStatus>;
  stoppedReason?: string;
};

type SerializedError = {
  message: string;
  name?: string;
  stack?: string;
};

export type ScanRunRow = {
  _id: string;
  triggerRunId: string;
  requestId: string;
  fileName?: string;
  pageCount: number;
  pageStart: number;
  pageEnd: number;
  totalPages: number;
  isActive: boolean;
  status: 'processing' | 'completed' | 'failed' | 'stopped';
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  successCount?: number;
  failedCount?: number;
  stoppedEarly?: boolean;
  progress?: ScanProgress;
  output?: ScanOutput;
  errorMessage?: string;
  errorName?: string;
  errorStack?: string;
  triggerStatus?: string;
  lastPolledAt?: number;
};

export type ScanRunsState = {
  active: ScanRunRow[];
  recent: ScanRunRow[];
};

type RunView = {
  id: string;
  requestId?: string;
  fileName?: string;
  pageCount: number;
  pageStart: number;
  pageEnd?: number;
  totalPages?: number;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  progress?: ScanProgress;
  output?: ScanOutput;
  error?: SerializedError | null;
  pollError?: SerializedError | null;
  triggerStatus?: string;
  previewImages?: string[];
  previewStatus?: 'ready' | 'missing' | 'loading';
};

interface ScannerProps {
  availableCredits: number | null;
  scanRuns?: ScanRunsState | null;
  onCreditsUpdate?: (credits: number) => void;
  onRunsChanged?: () => void;
}

const sanitizeFilename = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '-');

const PREVIEW_DB_NAME = 'docmind-scan-previews';
const PREVIEW_STORE_NAME = 'previews';
const PREVIEW_DB_VERSION = 1;

type PreviewRecord = {
  runId: string;
  images: string[];
  pageStart: number;
  createdAt: number;
};

const openPreviewDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Preview cache is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(PREVIEW_DB_NAME, PREVIEW_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PREVIEW_STORE_NAME)) {
        db.createObjectStore(PREVIEW_STORE_NAME, { keyPath: 'runId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open preview cache'));
  });

const getCachedPreview = async (runId: string) => {
  const db = await openPreviewDb();
  return new Promise<PreviewRecord | null>((resolve, reject) => {
    const transaction = db.transaction(PREVIEW_STORE_NAME, 'readonly');
    const request = transaction.objectStore(PREVIEW_STORE_NAME).get(runId);
    request.onsuccess = () => resolve((request.result as PreviewRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Unable to read preview cache'));
    transaction.oncomplete = () => db.close();
  });
};

const setCachedPreview = async (record: PreviewRecord) => {
  const db = await openPreviewDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PREVIEW_STORE_NAME, 'readwrite');
    transaction.objectStore(PREVIEW_STORE_NAME).put(record);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('Unable to write preview cache'));
    };
  });
};

const isTerminalStatus = (status: RunStatus) =>
  status === 'completed' || status === 'failed' || status === 'stopped';

const formatTime = (value?: number) =>
  value
    ? new Date(value).toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const formatDuration = (start: number, end?: number) => {
  const ms = Math.max(0, (end ?? Date.now()) - start);
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
};

const statusLabel = (run: RunView) => {
  if (run.status === 'queued') return 'Queued';
  if (run.status === 'converting') return 'Preparing preview';
  if (run.status === 'uploading') return 'Uploading';
  if (run.status === 'retrying') return `Retrying failed pages${run.progress?.retryAttempt ? `, pass ${run.progress.retryAttempt}` : ''}`;
  if (run.status === 'completed') return 'Completed';
  if (run.status === 'stopped') return 'Stopped';
  if (run.status === 'failed') return 'Failed';
  return 'Processing';
};

const normalizeRunStatus = (row: ScanRunRow): RunStatus => {
  if (row.status === 'failed') return 'failed';
  if (row.status === 'stopped' || row.output?.summary?.stoppedEarly || row.progress?.phase === 'stopped') return 'stopped';
  if (row.status === 'completed') return 'completed';
  if (row.progress?.phase === 'retrying') return 'retrying';
  return 'processing';
};

const rowToRunView = (row: ScanRunRow): RunView => ({
  id: row.triggerRunId,
  requestId: row.requestId,
  fileName: row.fileName,
  pageCount: row.pageCount,
  pageStart: row.pageStart,
  pageEnd: row.pageEnd,
  totalPages: row.totalPages,
  status: normalizeRunStatus(row),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  finishedAt: row.finishedAt,
  progress: row.progress,
  output: row.output,
  error: row.errorMessage
    ? { message: row.errorMessage, name: row.errorName, stack: row.errorStack }
    : null,
  pollError: null,
  triggerStatus: row.triggerStatus,
  previewStatus: 'loading',
});

const pagesForRun = (run: RunView) => {
  if (run.output?.pages?.length) {
    return run.output.pages.map((page) => ({
      pageNumber: page.pageNumber,
      status: page.status,
      content: page.status === 'success' ? page.text || '' : page.error || 'Page failed without an error message.',
      usage:
        page.status === 'success'
          ? {
              inputTokens: page.inputTokens ?? 0,
              outputTokens: page.outputTokens ?? 0,
              cost: page.cost ?? 0,
            }
          : undefined,
    }));
  }

  return Array.from({ length: run.pageCount }, (_, index) => {
    const pageNumber = run.pageStart + index;
    return {
      pageNumber,
      status: run.progress?.pageStatuses?.[String(pageNumber)] ?? 'pending',
      content: '',
      usage: undefined,
    };
  });
};

const runCounts = (run: RunView) => {
  if (run.output) {
    return {
      success: run.output.summary.successCount,
      failed: run.output.summary.failedCount,
    };
  }

  return {
    success: run.progress?.completedCount ?? 0,
    failed: run.progress?.failedCount ?? 0,
  };
};

const errorListForRun = (run: RunView) => {
  const errors: Array<{ title: string; message: string; detail?: string }> = [];

  if (run.error?.message) {
    errors.push({
      title: run.error.name || 'Run error',
      message: run.error.message,
      detail: run.error.stack,
    });
  }

  if (run.pollError?.message) {
    errors.push({
      title: run.pollError.name || 'Status refresh error',
      message: run.pollError.message,
      detail: run.pollError.stack,
    });
  }

  if (run.output?.summary.stoppedReason) {
    errors.push({
      title: 'Circuit breaker',
      message: run.output.summary.stoppedReason,
    });
  } else if (run.progress?.stoppedReason) {
    errors.push({
      title: 'Circuit breaker',
      message: run.progress.stoppedReason,
    });
  }

  for (const page of run.output?.pages ?? []) {
    if (page.status === 'error') {
      errors.push({
        title: `Page ${page.pageNumber}`,
        message: page.error || 'Page failed without an error message.',
      });
    }
  }

  return errors;
};

const Icons = {
  Upload: () => (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  Alert: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Copy: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Download: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  Refresh: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
};

export default function Scanner({
  availableCredits,
  scanRuns = null,
  onCreditsUpdate,
  onRunsChanged,
}: ScannerProps) {
  const [pageRange, setPageRange] = useState({ start: '', end: '' });
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadState, setUploadState] = useState<{
    phase: 'idle' | 'converting' | 'uploading' | 'starting';
    fileName?: string;
    message?: string;
    error?: string;
  }>({ phase: 'idle' });
  const [localRuns, setLocalRuns] = useState<Record<string, RunView>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inFlightPolls = useRef<Set<string>>(new Set());
  const runsRef = useRef<RunView[]>([]);

  const serverRuns = useMemo(() => {
    const byId = new Map<string, ScanRunRow>();
    for (const run of scanRuns?.recent ?? []) byId.set(run.triggerRunId, run);
    for (const run of scanRuns?.active ?? []) byId.set(run.triggerRunId, run);
    return Array.from(byId.values()).map(rowToRunView);
  }, [scanRuns]);

  const runs = useMemo(() => {
    const byId = new Map<string, RunView>();
    for (const run of serverRuns) byId.set(run.id, run);
    for (const run of Object.values(localRuns)) {
      const server = byId.get(run.id);
      byId.set(run.id, {
        ...server,
        ...run,
        previewImages: run.previewImages ?? server?.previewImages,
        previewStatus: run.previewImages?.length ? 'ready' : run.previewStatus ?? server?.previewStatus ?? 'loading',
        progress: run.progress ?? server?.progress,
        output: run.output ?? server?.output,
        error: run.error ?? server?.error ?? null,
        pollError: run.pollError ?? null,
      });
    }
    return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [localRuns, serverRuns]);

  const selectedRun = useMemo(() => {
    return runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  }, [runs, selectedRunId]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  const updateRun = useCallback((id: string, updater: (run: RunView | undefined) => RunView) => {
    setLocalRuns((prev) => ({
      ...prev,
      [id]: updater(prev[id] ?? runsRef.current.find((run) => run.id === id)),
    }));
  }, []);

  useEffect(() => {
    const runsNeedingPreview = runs.filter(
      (run) => !run.previewImages?.length && run.previewStatus !== 'missing',
    );
    if (runsNeedingPreview.length === 0) return;

    let cancelled = false;

    for (const run of runsNeedingPreview) {
      void getCachedPreview(run.id)
        .then((record) => {
          if (cancelled) return;
          updateRun(run.id, (current) => ({
            ...(current ?? run),
            previewImages: record?.images,
            previewStatus: record?.images?.length ? 'ready' : 'missing',
            pageStart: record?.pageStart ?? current?.pageStart ?? run.pageStart,
            updatedAt: Date.now(),
          }));
        })
        .catch((error) => {
          if (cancelled) return;
          updateRun(run.id, (current) => ({
            ...(current ?? run),
            previewStatus: 'missing',
            pollError: {
              message: error instanceof Error ? error.message : 'Unable to load cached previews.',
              name: error instanceof Error ? error.name : undefined,
            },
            updatedAt: Date.now(),
          }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [runs, updateRun]);

  const pollRun = useCallback(async (id: string) => {
    if (inFlightPolls.current.has(id)) return;
    inFlightPolls.current.add(id);

    try {
      const res = await fetch(`/api/scan/${id}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const message = data?.detail || data?.error || `Status refresh failed with HTTP ${res.status}`;
        updateRun(id, (current) => ({
          ...(current ?? {
            id,
            pageCount: 0,
            pageStart: 1,
            status: 'processing' as RunStatus,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
          pollError: { message, name: data?.name },
          updatedAt: Date.now(),
        }));
        return;
      }

      updateRun(id, (current) => {
        const output = data.output as ScanOutput | null;
        const progress = data.progress as ScanProgress | null;
        const nextStatus: RunStatus =
          data.status === 'failed'
            ? 'failed'
            : data.status === 'completed' && output?.summary.stoppedEarly
              ? 'stopped'
              : data.status === 'completed'
                ? 'completed'
                : progress?.phase === 'retrying'
                  ? 'retrying'
                  : 'processing';

        return {
          ...(current ?? {
            id,
            pageCount: progress?.totalPages ?? output?.summary.totalPages ?? 0,
            pageStart: 1,
            createdAt: data.createdAt ? Date.parse(data.createdAt) : Date.now(),
          }),
          status: nextStatus,
          progress: progress ?? current?.progress,
          output: output ?? current?.output,
          error: data.error,
          pollError: null,
          triggerStatus: data.triggerStatus,
          finishedAt: data.finishedAt ? Date.parse(data.finishedAt) : current?.finishedAt,
          updatedAt: Date.now(),
        };
      });

      if (data.status === 'completed' || data.status === 'failed') {
        onRunsChanged?.();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error while refreshing run status.';
      updateRun(id, (current) => ({
        ...(current ?? {
          id,
          pageCount: 0,
          pageStart: 1,
          status: 'processing' as RunStatus,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
        pollError: {
          message,
          name: error instanceof Error ? error.name : undefined,
          stack: error instanceof Error ? error.stack : undefined,
        },
        updatedAt: Date.now(),
      }));
    } finally {
      inFlightPolls.current.delete(id);
    }
  }, [onRunsChanged, updateRun]);

  const activeRunIds = useMemo(
    () => runs.filter((run) => !isTerminalStatus(run.status)).map((run) => run.id),
    [runs],
  );

  useEffect(() => {
    if (activeRunIds.length === 0) return;
    for (const id of activeRunIds) void pollRun(id);
    const interval = setInterval(() => {
      for (const id of activeRunIds) void pollRun(id);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRunIds.join('|'), pollRun]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (availableCredits === null) {
      setUploadState({ phase: 'idle', error: 'Credit balance is still loading.' });
      return;
    }

    if (file.type !== 'application/pdf') {
      setUploadState({ phase: 'idle', error: 'Only PDF files can be scanned.' });
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setUploadState({ phase: 'idle', error: 'PDF must be under 50 MB.' });
      return;
    }

    try {
      setUploadState({ phase: 'converting', fileName: file.name, message: 'Preparing preview' });
      const start = parseInt(pageRange.start, 10);
      const end = parseInt(pageRange.end, 10);
      const range = {
        start: Number.isNaN(start) ? undefined : start,
        end: Number.isNaN(end) ? undefined : end,
      };

      const images = await convertPdfToImages(file, range);
      if (images.length === 0) {
        setUploadState({ phase: 'idle', error: 'No pages found in that range.' });
        return;
      }

      if (availableCredits !== Infinity && availableCredits < images.length) {
        setUploadState({
          phase: 'idle',
          error: `This run needs ${images.length} credits, but only ${availableCredits} are available.`,
        });
        return;
      }

      setUploadState({ phase: 'uploading', fileName: file.name, message: `${images.length} pages ready` });
      const uploadPath = `scan-pdfs/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
      const uploadedBlob = await upload(uploadPath, file, {
        access: 'private',
        handleUploadUrl: '/api/uploads/pdf',
      });

      setUploadState({ phase: 'starting', fileName: file.name, message: 'Starting cloud run' });
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobUrl: uploadedBlob.url,
          fileName: file.name,
          pageStart: range.start,
          pageEnd: range.end,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || `Failed to start scan with HTTP ${res.status}`);
      }

      const startPage = data.pageStart ?? range.start ?? 1;
      const run: RunView = {
        id: data.runId,
        requestId: data.requestId,
        fileName: file.name,
        pageCount: data.pageCount,
        pageStart: startPage,
        pageEnd: data.pageEnd,
        totalPages: data.totalPages,
        status: 'processing',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        previewImages: images,
        previewStatus: 'ready',
        progress: {
          phase: 'processing',
          totalPages: data.pageCount,
          completedCount: 0,
          failedCount: 0,
          retryAttempt: 0,
          pageStatuses: Object.fromEntries(
            Array.from({ length: data.pageCount }, (_, index) => [String(startPage + index), 'pending']),
          ) as Record<string, PageStatus>,
        },
      };

      setLocalRuns((prev) => ({ ...prev, [run.id]: run }));
      setSelectedRunId(run.id);
      setUploadState({ phase: 'idle', message: `${file.name} started` });
      void setCachedPreview({
        runId: run.id,
        images,
        pageStart: startPage,
        createdAt: Date.now(),
      }).catch((error) => {
        updateRun(run.id, (current) => ({
          ...(current ?? run),
          pollError: {
            message: error instanceof Error ? error.message : 'Unable to cache previews for refresh.',
            name: error instanceof Error ? error.name : undefined,
          },
          updatedAt: Date.now(),
        }));
      });

      if (typeof data.creditsRemaining === 'number') {
        onCreditsUpdate?.(data.creditsRemaining);
      }
      onRunsChanged?.();
      void pollRun(run.id);
    } catch (error) {
      setUploadState({
        phase: 'idle',
        fileName: file.name,
        error: error instanceof Error ? error.message : 'Upload failed.',
      });
    }
  }, [availableCredits, onCreditsUpdate, onRunsChanged, pageRange, pollRun]);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleFileUpload(file);
  }, [handleFileUpload]);

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  const downloadRunText = (run: RunView) => {
    const pages = run.output?.pages.filter((page) => page.status === 'success') ?? [];
    const fullText = pages
      .map((page) => `## Page ${page.pageNumber}\n\n${page.text || ''}\n`)
      .join('\n---\n\n');
    const blob = new Blob([fullText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(run.fileName || run.id)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const selectedPages = selectedRun ? pagesForRun(selectedRun) : [];
  const selectedCounts = selectedRun ? runCounts(selectedRun) : { success: 0, failed: 0 };
  const selectedErrors = selectedRun ? errorListForRun(selectedRun) : [];
  const activeCount = runs.filter((run) => !isTerminalStatus(run.status)).length;
  const terminalCount = runs.length - activeCount;

  return (
    <div className="space-y-6">
      <div
        className={`border transition-colors rounded-lg bg-[#080808] ${
          isDragOver ? 'border-[#CCFF00]/70 bg-[#CCFF00]/5' : 'border-white/10'
        }`}
        onDrop={onDrop}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragOver(false);
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 p-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-4 text-left min-h-24 rounded-md border border-dashed border-white/10 bg-white/[0.03] px-4 hover:border-[#CCFF00]/40 hover:bg-[#CCFF00]/5 transition-colors"
          >
            <span className="text-white/30"><Icons.Upload /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">Start another scan</span>
              <span className="block text-xs text-white/40 font-mono truncate">
                {uploadState.phase === 'idle'
                  ? uploadState.message || 'Drop a PDF here or browse'
                  : `${uploadState.fileName || 'PDF'} · ${uploadState.message || uploadState.phase}`}
              </span>
            </span>
          </button>

          <div className="flex items-end gap-3" onClick={(event) => event.stopPropagation()}>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40 uppercase tracking-widest">Start</span>
              <input
                type="number"
                min="1"
                placeholder="1"
                value={pageRange.start}
                onChange={(event) => setPageRange((prev) => ({ ...prev, start: event.target.value }))}
                className="h-10 w-24 rounded border border-white/10 bg-white/5 px-3 text-sm text-slate-200 outline-none focus:border-[#CCFF00]/50"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40 uppercase tracking-widest">End</span>
              <input
                type="number"
                min="1"
                placeholder="Max"
                value={pageRange.end}
                onChange={(event) => setPageRange((prev) => ({ ...prev, end: event.target.value }))}
                className="h-10 w-24 rounded border border-white/10 bg-white/5 px-3 text-sm text-slate-200 outline-none focus:border-[#CCFF00]/50"
              />
            </label>
          </div>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="application/pdf"
          onChange={(event) => event.target.files?.[0] && void handleFileUpload(event.target.files[0])}
        />

        {uploadState.error && (
          <div className="mx-4 mb-4 rounded border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 font-mono">
            {uploadState.error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-white">Runs</h3>
              <p className="text-[11px] text-white/35 font-mono">{activeCount} active · {terminalCount} finished</p>
            </div>
            {activeCount > 0 && (
              <span className="h-2.5 w-2.5 rounded-full bg-[#CCFF00] shadow-[0_0_16px_rgba(204,255,0,0.8)]" />
            )}
          </div>

          <div className="space-y-3 max-h-[720px] overflow-y-auto pr-1 custom-scrollbar">
            {runs.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-6 text-center text-xs text-white/30 font-mono">
                No runs yet
              </div>
            ) : (
              runs.map((run) => {
                const counts = runCounts(run);
                const percent = run.pageCount > 0 ? Math.min(100, ((counts.success + counts.failed) / run.pageCount) * 100) : 0;
                const hasErrors = errorListForRun(run).length > 0;
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className={`w-full text-left rounded-lg border p-4 transition-colors ${
                      selectedRun?.id === run.id
                        ? 'border-[#CCFF00]/50 bg-[#CCFF00]/5'
                        : 'border-white/10 bg-[#080808] hover:border-white/20 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{run.fileName || run.id}</p>
                        <p className="mt-1 text-[10px] font-mono text-white/35">{run.id.slice(0, 18)} · {formatTime(run.createdAt)}</p>
                      </div>
                      <span className={`shrink-0 rounded px-2 py-1 text-[9px] font-mono uppercase border ${
                        run.status === 'completed'
                          ? 'border-[#CCFF00]/25 bg-[#CCFF00]/10 text-[#CCFF00]'
                          : run.status === 'failed'
                            ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
                            : run.status === 'stopped'
                              ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                              : 'border-white/15 bg-white/5 text-white/55'
                      }`}>
                        {statusLabel(run)}
                      </span>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full bg-[#CCFF00] transition-all" style={{ width: `${percent}%` }} />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-white/35">
                      <span>{counts.success}/{run.pageCount} done · {counts.failed} failed</span>
                      <span className={hasErrors ? 'text-rose-300' : ''}>{hasErrors ? `${errorListForRun(run).length} errors` : formatDuration(run.createdAt, run.finishedAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="min-w-0">
          {selectedRun ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-white/10 bg-[#080808] p-5">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold text-white">{selectedRun.fileName || selectedRun.id}</h3>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-white/40">
                      <span className="rounded border border-white/10 bg-white/5 px-2 py-1">RUN {selectedRun.id}</span>
                      {selectedRun.triggerStatus && <span className="rounded border border-white/10 bg-white/5 px-2 py-1">{selectedRun.triggerStatus}</span>}
                      <span className="rounded border border-white/10 bg-white/5 px-2 py-1">{formatDuration(selectedRun.createdAt, selectedRun.finishedAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void pollRun(selectedRun.id)}
                      className="tech-button px-3 py-2 rounded flex items-center gap-2 text-xs"
                    >
                      <Icons.Refresh /> Refresh
                    </button>
                    {selectedRun.output?.pages.some((page) => page.status === 'success') && (
                      <button
                        type="button"
                        onClick={() => downloadRunText(selectedRun)}
                        className="tech-button px-3 py-2 rounded flex items-center gap-2 text-xs"
                      >
                        <Icons.Download /> Markdown
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  <div className="rounded border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-white/35">Pages</p>
                    <p className="mt-1 text-2xl font-mono text-white">{selectedCounts.success + selectedCounts.failed}/{selectedRun.pageCount}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-white/35">Failed</p>
                    <p className="mt-1 text-2xl font-mono text-rose-300">{selectedCounts.failed}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-white/35">Cost</p>
                    <p className="mt-1 text-2xl font-mono text-white">${(selectedRun.output?.summary.totalCost ?? 0).toFixed(5)}</p>
                  </div>
                </div>
              </div>

              {selectedErrors.length > 0 && (
                <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-rose-200">Errors</h4>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedErrors.map((error) => `${error.title}: ${error.message}${error.detail ? `\n${error.detail}` : ''}`).join('\n\n'))}
                      className="text-xs text-rose-100/70 hover:text-rose-100 flex items-center gap-2"
                    >
                      <Icons.Copy /> Copy
                    </button>
                  </div>
                  <div className="mt-3 space-y-3">
                    {selectedErrors.map((error, index) => (
                      <details key={`${error.title}-${index}`} open={index < 3} className="rounded border border-rose-500/20 bg-black/20 p-3">
                        <summary className="cursor-pointer text-sm font-medium text-rose-100">{error.title}</summary>
                        <p className="mt-2 whitespace-pre-wrap break-words text-xs font-mono text-rose-100/80">{error.message}</p>
                        {error.detail && (
                          <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-3 text-[10px] text-rose-100/55 custom-scrollbar">{error.detail}</pre>
                        )}
                      </details>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                {selectedPages.map((page) => {
                  const preview = selectedRun.previewImages?.[page.pageNumber - selectedRun.pageStart];
                  return (
                    <div key={page.pageNumber} className={`rounded-lg border bg-[#080808] overflow-hidden ${page.status === 'error' ? 'border-rose-500/20' : page.status === 'success' ? 'border-[#CCFF00]/20' : 'border-white/10'}`}>
                      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] p-3">
                        <div>
                          <p className="text-sm font-medium text-white">Page {page.pageNumber}</p>
                          {page.usage && (
                            <p className="mt-0.5 text-[10px] font-mono text-white/35">
                              {page.usage.inputTokens + page.usage.outputTokens} tokens · ${page.usage.cost.toFixed(5)}
                            </p>
                          )}
                        </div>
                        <span className={`flex items-center gap-1 text-xs ${
                          page.status === 'success' ? 'text-[#CCFF00]' : page.status === 'error' ? 'text-rose-300' : page.status === 'processing' ? 'text-white' : 'text-white/35'
                        }`}>
                          {page.status === 'success' && <Icons.Check />}
                          {page.status === 'error' && <Icons.Alert />}
                          {page.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 min-h-72">
                        <div className="flex items-center justify-center border-b md:border-b-0 md:border-r border-white/10 bg-black/30 p-3">
                          {preview ? (
                            <img
                              src={`data:image/jpeg;base64,${preview}`}
                              alt={`Page ${page.pageNumber}`}
                              className="max-h-80 max-w-full rounded-sm shadow-lg"
                            />
                          ) : (
                            <div className="text-center text-xs font-mono text-white/20">
                              {selectedRun.previewStatus === 'loading' ? 'Loading preview...' : 'Preview unavailable'}
                            </div>
                          )}
                        </div>
                        <div className="max-h-96 overflow-y-auto p-4 custom-scrollbar">
                          {page.status === 'success' ? (
                            <div className="prose prose-invert prose-sm max-w-none">
                              <ReactMarkdown>{page.content}</ReactMarkdown>
                            </div>
                          ) : page.status === 'error' ? (
                            <div className="rounded border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-200 whitespace-pre-wrap break-words">
                              {page.content}
                            </div>
                          ) : page.status === 'processing' ? (
                            <div className="flex h-full min-h-40 items-center justify-center text-sm text-white/45">
                              <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-[#CCFF00]/20 border-t-[#CCFF00]" />
                              Processing
                            </div>
                          ) : (
                            <div className="flex h-full min-h-40 items-center justify-center text-sm text-white/25">Queued</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-[#080808] p-10 text-center text-sm text-white/35">
              Select a run
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.04);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.16);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.25);
        }
      `}</style>
    </div>
  );
}
