import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Cpu,
  Download,
  FileText,
  HardDrive,
  Loader2,
  Printer,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import PodGroupFilter, { isGalaxyGroup, type Timeframe } from './components/PodGroupFilter';
import StorageDashboard from './components/StorageDashboard';
import { useMetrics } from './hooks/useMetrics';
import { updateGroupColorMap, type GroupColorMap } from './lib/colors';
import type { ConfigResponse, DiskSample, PodSample, Sample } from './lib/types';

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '10m': '10m',
  '1h': '1h',
  '8h': '8h',
  all: 'All'
};

function isPodSample(value: unknown): value is PodSample {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const pod = value as Partial<PodSample>;
  return (
    typeof pod.name === 'string' &&
    typeof pod.cpuUsageMillicores === 'number' &&
    typeof pod.cpuRequestMillicores === 'number' &&
    typeof pod.memUsageBytes === 'number' &&
    typeof pod.memRequestBytes === 'number'
  );
}

function isDiskSample(value: unknown): value is DiskSample {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const disk = value as Partial<DiskSample>;
  return (
    typeof disk.nodeCapacityBytes === 'number' &&
    typeof disk.nodeUsedBytes === 'number' &&
    typeof disk.nodeAvailableBytes === 'number' &&
    typeof disk.imageUsedBytes === 'number' &&
    typeof disk.diskPressure === 'boolean' &&
    typeof disk.ioPsiSomeAvg10 === 'number' &&
    typeof disk.ioPsiFullAvg10 === 'number'
  );
}

function isSample(value: unknown): value is Sample {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const sample = value as Partial<Sample>;
  return (
    typeof sample.timestamp === 'string' &&
    Array.isArray(sample.pods) &&
    sample.pods.every(isPodSample) &&
    typeof sample.clusterCpuCapacityMillicores === 'number' &&
    typeof sample.clusterMemCapacityBytes === 'number' &&
    (sample.disk === undefined || isDiskSample(sample.disk))
  );
}

function extractUploadedData(raw: unknown): { samples: Sample[]; config: ConfigResponse | null } {
  if (Array.isArray(raw) && raw.every(isSample)) {
    return { samples: raw, config: null };
  }

  if (raw && typeof raw === 'object') {
    const payload = raw as {
      samples?: unknown;
      namespace?: unknown;
      intervalSeconds?: unknown;
      retentionHours?: unknown;
      podGroups?: unknown;
      basePath?: unknown;
    };

    if (Array.isArray(payload.samples) && payload.samples.every(isSample)) {
      const inferredGroups = new Set<string>();
      payload.samples.forEach(sample => sample.pods.forEach(pod => inferredGroups.add(pod.name)));

      const config: ConfigResponse = {
        namespace: typeof payload.namespace === 'string' ? payload.namespace : 'uploaded-data',
        intervalSeconds: typeof payload.intervalSeconds === 'number' ? payload.intervalSeconds : 0,
        retentionHours: typeof payload.retentionHours === 'number' ? payload.retentionHours : 0,
        basePath: typeof payload.basePath === 'string' ? payload.basePath : '',
        podGroups: Array.isArray(payload.podGroups)
          ? (payload.podGroups.filter(group => typeof group === 'string') as string[])
          : Array.from(inferredGroups).sort((left, right) => left.localeCompare(right))
      };

      return { samples: payload.samples, config };
    }
  }

  throw new Error(
    'Uploaded JSON must be either a Sample[] array or an object with a valid samples array.'
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'compute' | 'storage'>('compute');
  const [tabsActionsEl, setTabsActionsEl] = useState<HTMLDivElement | null>(null);
  const [uploadedSamples, setUploadedSamples] = useState<Sample[] | null>(null);
  const [uploadedConfig, setUploadedConfig] = useState<ConfigResponse | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [purgedAtMs, setPurgedAtMs] = useState<number | null>(null);
  const [resetZoomSignal, setResetZoomSignal] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [groupColorMap, setGroupColorMap] = useState<GroupColorMap>({});
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const isStaticMode = uploadedSamples !== null;
  const { samples: liveSamples, config: liveConfig, loading, error } = useMetrics({
    enabled: !isStaticMode
  });
  const sourceSamples = isStaticMode ? (uploadedSamples ?? []) : liveSamples;

  const samples = useMemo(() => {
    if (isStaticMode || purgedAtMs === null) {
      return sourceSamples;
    }

    return sourceSamples.filter(sample => new Date(sample.timestamp).getTime() >= purgedAtMs);
  }, [isStaticMode, purgedAtMs, sourceSamples]);

  const config = isStaticMode ? uploadedConfig : liveConfig;

  const allGroups = useMemo(() => {
    const set = new Set<string>();
    if (config) {
      config.podGroups.forEach(group => set.add(group));
    }
    sourceSamples.forEach(sample => sample.pods.forEach(pod => set.add(pod.name)));
    return Array.from(set).sort((left, right) => left.localeCompare(right));
  }, [config, sourceSamples]);

  useEffect(() => {
    if (allGroups.length === 0) {
      return;
    }
    setGroupColorMap(previous => updateGroupColorMap(previous, allGroups));
  }, [allGroups, updateGroupColorMap]);

  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('all');
  const hasInitializedSelection = useRef(false);
  const hasUserInteracted = useRef(false);

  useEffect(() => {
    if (!mobileFiltersOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileFiltersOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileFiltersOpen]);

  const filteredSamples = useMemo(() => {
    if (selectedTimeframe === 'all' || samples.length === 0) {
      return samples;
    }

    const latestTimestamp = new Date(samples[samples.length - 1].timestamp).getTime();
    const lookbackMilliseconds =
      selectedTimeframe === '10m'
        ? 10 * 60 * 1000
        : selectedTimeframe === '1h'
          ? 60 * 60 * 1000
          : 8 * 60 * 60 * 1000;

    const cutoff = latestTimestamp - lookbackMilliseconds;
    return samples.filter(sample => new Date(sample.timestamp).getTime() >= cutoff);
  }, [samples, selectedTimeframe]);

  const hasDiskPressureInWindow = useMemo(
    () => filteredSamples.some(sample => sample.disk?.diskPressure),
    [filteredSamples]
  );

  useEffect(() => {
    if (allGroups.length === 0) {
      return;
    }

    setSelectedGroups(previous => {
      if (!hasUserInteracted.current || !hasInitializedSelection.current) {
        hasInitializedSelection.current = true;
        return new Set(allGroups);
      }

      if (previous.size === 0) {
        return previous;
      }

      const available = new Set(allGroups);
      const next = new Set<string>();
      for (const group of previous) {
        if (available.has(group)) {
          next.add(group);
        }
      }

      return next;
    });
  }, [allGroups]);

  const toggleGroup = (name: string) => {
    hasUserInteracted.current = true;
    setSelectedGroups(previous => {
      const next = new Set(previous);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAll = () => {
    hasUserInteracted.current = false;
    hasInitializedSelection.current = true;
    setSelectedGroups(new Set(allGroups));
  };

  const selectNone = () => {
    hasUserInteracted.current = true;
    setSelectedGroups(new Set());
  };

  const selectGalaxy = () => {
    const nextSelection = allGroups.filter(isGalaxyGroup);
    if (nextSelection.length === 0) {
      return;
    }
    hasUserInteracted.current = true;
    setSelectedGroups(new Set(nextSelection));
  };

  const selectOnly = (groupName: string) => {
    hasUserInteracted.current = true;
    setSelectedGroups(new Set([groupName]));
  };

  const saveAsPdf = () => {
    window.print();
  };

  const openUploadPicker = () => {
    uploadInputRef.current?.click();
  };

  const clearUploadedData = () => {
    hasInitializedSelection.current = false;
    hasUserInteracted.current = false;
    setGroupColorMap({});
    setUploadedSamples(null);
    setUploadedConfig(null);
    setUploadedFilename(null);
    setUploadError(null);
    setPurgedAtMs(null);
    setResetZoomSignal(previous => previous + 1);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
  };

  const clearLiveHistory = () => {
    const confirmed = window.confirm(
      'Hide all live samples collected up to now? You can restore the in-memory history at any time.'
    );
    if (!confirmed) {
      return;
    }

    setPurgedAtMs(Date.now());
  };

  const restoreLiveHistory = () => {
    setPurgedAtMs(null);
  };

  const handleUploadData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const extracted = extractUploadedData(parsed);

      if (extracted.samples.length === 0) {
        throw new Error('Uploaded file has no samples.');
      }

      const sortedSamples = [...extracted.samples].sort(
        (left, right) =>
          new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
      );

      hasInitializedSelection.current = false;
      hasUserInteracted.current = false;
      setGroupColorMap({});
      setUploadedSamples(sortedSamples);
      setUploadedFilename(file.name);
      setUploadedConfig(
        extracted.config ?? {
          namespace: 'uploaded-data',
          intervalSeconds: 0,
          retentionHours: 0,
          basePath: '',
          podGroups: []
        }
      );
      setUploadError(null);
      setSelectedTimeframe('all');
      setResetZoomSignal(previous => previous + 1);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Could not parse uploaded data file.';
      setUploadError(message);
    } finally {
      event.target.value = '';
    }
  };

  const downloadRawData = () => {
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      namespace: config?.namespace ?? null,
      intervalSeconds: config?.intervalSeconds ?? null,
      retentionHours: config?.retentionHours ?? null,
      source: isStaticMode ? 'uploaded-static' : 'live-k8s',
      selectedTimeframe,
      sampleCount: samples.length,
      samples
    };

    const json = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    anchor.href = url;
    anchor.download = `galaxy-k8s-monitor-raw-usage-${timestamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const sourceLabel = isStaticMode
    ? `Uploaded snapshot (${uploadedFilename ?? 'file'})`
    : 'Live stream';

  return (
    <div>
      <a href="#main" className="skip-link" data-no-print>
        Skip to main content
      </a>

      <header className="masthead" data-no-print>
        <input
          ref={uploadInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleUploadData}
          style={{ display: 'none' }}
        />
        <div className="masthead-inner">
          <div className="brand">
            <Activity size={22} aria-hidden="true" />
            <span>Galaxy K8s Monitor</span>
          </div>

          <div className="masthead-status">
            {isStaticMode ? (
              <>
                <span className="mode-badge" data-mode="uploaded">
                  <FileText size={15} aria-hidden="true" />
                  <span
                    className="mode-badge-text"
                    title={`Uploaded snapshot · ${uploadedFilename ?? 'file'}`}
                  >
                    Uploaded snapshot · {uploadedFilename ?? 'file'}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-masthead"
                  onClick={clearUploadedData}
                >
                  <Radio size={15} aria-hidden="true" />
                  <span>Return to live</span>
                </button>
              </>
            ) : (
              <span className="mode-badge" data-mode="live">
                <span className="live-dot" aria-hidden="true" />
                <span>Live stream</span>
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="shell">
        <button
          type="button"
          className="drawer-toggle"
          data-no-print
          aria-expanded={mobileFiltersOpen}
          aria-controls="filter-sidebar"
          onClick={() => setMobileFiltersOpen(previous => !previous)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span>Filters</span>
          <span className="count-pill">
            {selectedGroups.size}/{allGroups.length} · {TIMEFRAME_LABELS[selectedTimeframe]}
          </span>
        </button>

        <div
          id="filter-sidebar"
          className="sidebar-wrap"
          data-open={mobileFiltersOpen ? 'true' : 'false'}
          data-no-print
        >
          <PodGroupFilter
            podGroups={allGroups}
            selectedGroups={selectedGroups}
            selectedTimeframe={selectedTimeframe}
            groupColorMap={groupColorMap}
            activeTab={activeTab}
            onToggleGroup={toggleGroup}
            onSelectOnly={selectOnly}
            onSelectAll={selectAll}
            onSelectNone={selectNone}
            onSelectGalaxy={selectGalaxy}
            onTimeframeChange={setSelectedTimeframe}
          />
        </div>

        <main id="main" className="page">
          <div className="page-header" data-no-print>
            <div className="page-heading-group">
              <h1 className="page-title">Galaxy K8s Monitor</h1>
              <p className="telemetry-meta">
                <span>
                  Namespace: <strong>{config?.namespace ?? '-'}</strong>
                </span>
                <span className="meta-sep" aria-hidden="true">•</span>
                <span>
                  Interval:{' '}
                  <strong>
                    {config?.intervalSeconds ? `${config.intervalSeconds}s` : '-'}
                  </strong>
                </span>
                <span className="meta-sep" aria-hidden="true">•</span>
                <span>
                  Retention:{' '}
                  <strong>
                    {config?.retentionHours ? `${config.retentionHours}h` : '-'}
                  </strong>
                </span>
                <span className="meta-sep" aria-hidden="true">•</span>
                <span>
                  Data points:{' '}
                  <strong className="tabular-nums">
                    {filteredSamples.length.toLocaleString()}
                  </strong>
                  {filteredSamples.length !== samples.length
                    ? ` (of ${samples.length.toLocaleString()})`
                    : ''}
                </span>
                <span className="meta-sep" aria-hidden="true">•</span>
                <span>
                  Source: <strong>{sourceLabel}</strong>
                </span>
              </p>
            </div>

            <div className="toolbar-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={openUploadPicker}
              >
                <Upload size={16} aria-hidden="true" />
                <span>Upload data</span>
              </button>

              {isStaticMode && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={clearUploadedData}
                >
                  <Radio size={16} aria-hidden="true" />
                  <span>Return to live</span>
                </button>
              )}

              <button
                type="button"
                className="btn-secondary"
                onClick={downloadRawData}
                disabled={samples.length === 0}
              >
                <Download size={16} aria-hidden="true" />
                <span>Download raw data</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={saveAsPdf}
                disabled={filteredSamples.length === 0}
              >
                <Printer size={16} aria-hidden="true" />
                <span>Save as PDF</span>
              </button>

              {!isStaticMode && purgedAtMs !== null && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={restoreLiveHistory}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  <span>Restore history</span>
                </button>
              )}

              {!isStaticMode && purgedAtMs === null && sourceSamples.length > 0 && (
                <button
                  type="button"
                  className="btn-destructive"
                  onClick={clearLiveHistory}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  <span>Clear history</span>
                </button>
              )}
            </div>
          </div>

          <div className="view-tabs" data-no-print>
            <div className="view-tabs-list" role="tablist" aria-label="Telemetry view">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'compute'}
                className="view-tab"
                onClick={() => setActiveTab('compute')}
              >
                <Cpu size={16} aria-hidden="true" />
                <span>Compute (CPU &amp; Memory)</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'storage'}
                className="view-tab"
                onClick={() => setActiveTab('storage')}
              >
                <HardDrive size={16} aria-hidden="true" />
                <span>Storage &amp; Disk Pressure</span>
                {hasDiskPressureInWindow && (
                  <span className="view-tab-alert" title="Disk pressure detected in timeframe">
                    Pressure
                  </span>
                )}
              </button>
            </div>
            <div
              ref={setTabsActionsEl}
              className="view-tabs-actions"
              role="status"
              aria-live="polite"
            />
          </div>

          {uploadError && (
            <div
              className="status-banner"
              data-variant="error"
              data-no-print
              role="alert"
            >
              <div className="status-banner-content">
                <AlertCircle size={18} color="var(--monitor-overdraw)" aria-hidden="true" />
                <div>
                  <strong>Upload failed:</strong> {uploadError}
                </div>
              </div>
              <button
                type="button"
                className="btn-compact"
                onClick={() => setUploadError(null)}
                aria-label="Dismiss upload error"
              >
                <X size={14} aria-hidden="true" />
                <span>Dismiss</span>
              </button>
            </div>
          )}

          {!isStaticMode && loading && sourceSamples.length === 0 && (
            <div
              className="status-banner"
              data-variant="info"
              data-no-print
              role="status"
            >
              <div className="status-banner-content">
                <Loader2
                  size={18}
                  className="spin"
                  color="var(--monitor-primary)"
                  aria-hidden="true"
                />
                <span>Loading cluster telemetry…</span>
              </div>
            </div>
          )}

          {!isStaticMode && error && (
            <div
              className="status-banner"
              data-variant={sourceSamples.length > 0 ? 'warning' : 'error'}
              data-no-print
              role={sourceSamples.length > 0 ? 'status' : 'alert'}
            >
              <div className="status-banner-content">
                {sourceSamples.length > 0 ? (
                  <AlertTriangle
                    size={18}
                    color="var(--monitor-warning-border)"
                    aria-hidden="true"
                  />
                ) : (
                  <AlertCircle
                    size={18}
                    color="var(--monitor-overdraw)"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <strong>{error}</strong>
                  {sourceSamples.length > 0 && (
                    <span>
                      {' '}
                      — Displaying last received telemetry ({sourceSamples.length.toLocaleString()}{' '}
                      samples) while waiting for the stream to reconnect.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isStaticMode && purgedAtMs !== null && (
            <div
              className="status-banner"
              data-variant="info"
              data-no-print
              role="status"
            >
              <div className="status-banner-content">
                <span>
                  Showing live samples collected since{' '}
                  <strong>{new Date(purgedAtMs).toLocaleTimeString()}</strong> (
                  {samples.length.toLocaleString()} of {sourceSamples.length.toLocaleString()}{' '}
                  in-memory samples).
                </span>
              </div>
              <button
                type="button"
                className="btn-compact"
                onClick={restoreLiveHistory}
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span>Restore history</span>
              </button>
            </div>
          )}

          {activeTab === 'storage' ? (
            <StorageDashboard
              samples={filteredSamples}
              resetZoomSignal={resetZoomSignal}
              toolbarPortalEl={tabsActionsEl}
              printMetadata={{
                namespace: config?.namespace ?? '-',
                timeframeLabel: TIMEFRAME_LABELS[selectedTimeframe],
                sourceLabel
              }}
            />
          ) : (
            <Dashboard
              samples={filteredSamples}
              selectedGroups={selectedGroups}
              totalGroupCount={allGroups.length}
              groupColorMap={groupColorMap}
              resetZoomSignal={resetZoomSignal}
              onSelectAllGroups={selectAll}
              toolbarPortalEl={tabsActionsEl}
              printMetadata={{
                namespace: config?.namespace ?? '-',
                timeframeLabel: TIMEFRAME_LABELS[selectedTimeframe],
                sourceLabel
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
