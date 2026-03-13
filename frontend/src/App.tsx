import React, { useEffect, useMemo, useRef, useState } from 'react';
import Dashboard from './components/Dashboard';
import PodGroupFilter from './components/PodGroupFilter';
import { useMetrics } from './hooks/useMetrics';
import type { ConfigResponse, PodSample, Sample } from './lib/types';

type Timeframe = '10m' | '1h' | '8h' | 'all';

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
    typeof sample.clusterMemCapacityBytes === 'number'
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

  throw new Error('Uploaded JSON must be either a Sample[] array or an object with a valid samples array.');
}

export default function App() {
  const [uploadedSamples, setUploadedSamples] = useState<Sample[] | null>(null);
  const [uploadedConfig, setUploadedConfig] = useState<ConfigResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [purgedAtMs, setPurgedAtMs] = useState<number | null>(null);
  const [resetZoomSignal, setResetZoomSignal] = useState(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const isStaticMode = uploadedSamples !== null;
  const { samples: liveSamples, config: liveConfig, loading, error } = useMetrics({ enabled: !isStaticMode });
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
    samples.forEach(sample => sample.pods.forEach(pod => set.add(pod.name)));
    return Array.from(set).sort((left, right) => left.localeCompare(right));
  }, [config, samples]);

  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('all');
  const hasInitializedSelection = useRef(false);
  const hasUserInteracted = useRef(false);

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

  useEffect(() => {
    setSelectedGroups(previous => {
      if (!hasInitializedSelection.current && allGroups.length > 0) {
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

      if (!hasUserInteracted.current && allGroups.length > 0) {
        for (const group of allGroups) {
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
    hasUserInteracted.current = true;
    setSelectedGroups(new Set(allGroups));
  };

  const selectNone = () => {
    hasUserInteracted.current = true;
    setSelectedGroups(new Set());
  };

  const selectGalaxy = () => {
    hasUserInteracted.current = true;
    const galaxyTargets = new Set(['galaxy-web', 'galaxy-workflow', 'galaxy-job']);
    const nextSelection = allGroups.filter(group => galaxyTargets.has(group));
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
    setUploadedSamples(null);
    setUploadedConfig(null);
    setUploadError(null);
    setPurgedAtMs(null);
    setResetZoomSignal(previous => previous + 1);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
  };

  const resetCurrentData = () => {
    const confirmed = window.confirm('This will purge all currently displayed data. Continue?');
    if (!confirmed) {
      return;
    }

    if (isStaticMode) {
      setUploadedSamples([]);
      return;
    }

    setPurgedAtMs(Date.now());
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

      const sortedSamples = [...extracted.samples].sort((left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
      );

      setUploadedSamples(sortedSamples);
      setUploadedConfig(extracted.config ?? {
        namespace: 'uploaded-data',
        intervalSeconds: 0,
        retentionHours: 0,
        basePath: '',
        podGroups: []
      });
      setUploadError(null);
      setSelectedTimeframe('all');
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Could not parse uploaded data file.';
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
    anchor.download = `galaxy-vm-monitor-raw-usage-${timestamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: '#f5f7fb', minHeight: '100vh', color: '#111827' }}>
      <header data-no-print style={{ padding: '16px 20px', borderBottom: '1px solid #dbe1ea', background: '#fff' }}>
        <input
          ref={uploadInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleUploadData}
          style={{ display: 'none' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>Galaxy VM Monitor</h1>
            <div style={{ marginTop: 6, color: '#4b5563', fontSize: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span>Namespace: {config?.namespace ?? '-'} • Interval: {config?.intervalSeconds ?? '-'}s • Retention: {config?.retentionHours ?? '-'}h • Data points: {samples.length.toLocaleString()} • Source: {isStaticMode ? 'Uploaded static file' : 'Live stream'}</span>
              <button
                type="button"
                onClick={resetCurrentData}
                style={{
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#334155',
                  borderRadius: 999,
                  padding: '2px 8px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Reset data
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={openUploadPicker}
              style={{
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#334155',
                borderRadius: 999,
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              Upload data
            </button>
            {isStaticMode && (
              <button
                type="button"
                onClick={clearUploadedData}
                style={{
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#334155',
                  borderRadius: 999,
                  padding: '7px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Return to live
              </button>
            )}
            <button
              type="button"
              onClick={downloadRawData}
              style={{
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#334155',
                borderRadius: 999,
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              Download raw data
            </button>
            <button
              type="button"
              onClick={saveAsPdf}
              style={{
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#334155',
                borderRadius: 999,
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              Save as PDF
            </button>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, padding: 16, alignItems: 'flex-start' }}>
        <div data-no-print style={{ flex: '0 0 280px', width: 280 }}>
          <PodGroupFilter
            podGroups={allGroups}
            selectedGroups={selectedGroups}
            selectedTimeframe={selectedTimeframe}
            onToggleGroup={toggleGroup}
            onSelectOnly={selectOnly}
            onSelectAll={selectAll}
            onSelectNone={selectNone}
            onSelectGalaxy={selectGalaxy}
            onTimeframeChange={setSelectedTimeframe}
          />
        </div>

        <div style={{ minWidth: 0, flex: '1 1 900px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!isStaticMode && loading && <div data-no-print style={{ marginBottom: 12 }}>Loading metrics...</div>}
          {!isStaticMode && error && <div data-no-print style={{ marginBottom: 12, color: '#b91c1c' }}>{error}</div>}
          {uploadError && <div data-no-print style={{ marginBottom: 12, color: '#b91c1c' }}>{uploadError}</div>}
          <Dashboard samples={filteredSamples} selectedGroups={selectedGroups} resetZoomSignal={resetZoomSignal} />
        </div>
      </div>
    </div>
  );
}
