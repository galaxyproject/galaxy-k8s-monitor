import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  ACTIVE_SAMPLE_LINE_COLOR,
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_SELECTION_FILL,
  NETWORK_CONTENTION_COLOR,
  NETWORK_EGRESS_COLOR,
  NETWORK_INGRESS_COLOR
} from '../lib/colors';
import type { Sample } from '../lib/types';
import { formatElapsedAxisTick, formatRelativeDuration } from '../lib/units';

type PrintMetadata = {
  namespace: string;
  timeframeLabel: string;
  sourceLabel: string;
};

type Props = {
  samples: Sample[];
  resetZoomSignal?: number;
  toolbarPortalEl?: HTMLElement | null;
  printMetadata?: PrintMetadata;
};

type NetworkChartPoint = {
  sampleIndex: number;
  timestamp: string;
  timestampMs: number;
  relativeSeconds: number;
  relativeTime: string;
  ingressMBps: number;
  egressMBps: number;
  rxBytes: number;
  txBytes: number;
  rxGiB: number;
  txGiB: number;
  windowRxBytes: number;
  windowTxBytes: number;
  cumulativeDrops: number;
  intervalDrops: number;
};

const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_GIB = 1024 * 1024 * 1024;
const BYTES_PER_TIB = 1024 * 1024 * 1024 * 1024;
const BYTES_PER_MB_DECIMAL = 1_000_000;

function formatRateMBps(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0.00 MB/s';
  }
  if (value >= 100) {
    return `${value.toFixed(0)} MB/s`;
  }
  if (value >= 10) {
    return `${value.toFixed(1)} MB/s`;
  }
  return `${value.toFixed(2)} MB/s`;
}

function formatBytesVolume(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 MiB';
  }
  if (bytes >= BYTES_PER_TIB) {
    const tib = bytes / BYTES_PER_TIB;
    return `${tib >= 10 ? tib.toFixed(1) : tib.toFixed(2)} TiB`;
  }
  if (bytes >= BYTES_PER_GIB) {
    const gib = bytes / BYTES_PER_GIB;
    return `${gib >= 100 ? gib.toFixed(0) : gib >= 10 ? gib.toFixed(1) : gib.toFixed(2)} GiB`;
  }
  if (bytes >= BYTES_PER_MIB) {
    const mib = bytes / BYTES_PER_MIB;
    return `${mib >= 100 ? mib.toFixed(0) : mib >= 10 ? mib.toFixed(1) : mib.toFixed(2)} MiB`;
  }
  const kib = bytes / 1024;
  return `${Math.max(1, Math.round(kib))} KiB`;
}


function formatShortTime(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) {
    return timestamp;
  }
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function selectAdaptiveTicks(points: NetworkChartPoint[], maxTicks = 8): string[] {
  if (points.length === 0) {
    return [];
  }
  if (points.length <= maxTicks) {
    return points.map(point => point.relativeTime);
  }

  const ticks: string[] = [];
  const step = (points.length - 1) / (maxTicks - 1);
  for (let index = 0; index < maxTicks; index += 1) {
    const pointIndex = Math.round(index * step);
    const label = points[Math.min(points.length - 1, pointIndex)].relativeTime;
    if (ticks[ticks.length - 1] !== label) {
      ticks.push(label);
    }
  }
  return ticks;
}

const SPARKLINE_WIDTH = 160;
const SPARKLINE_HEIGHT = 22;

function buildSparklinePaths(
  values: number[],
  mode: 'rate' | 'cumulative'
): { linePath: string; areaPath: string } {
  const flatY = SPARKLINE_HEIGHT - 2.5;
  if (values.length === 0) {
    return {
      linePath: `M0,${flatY} L${SPARKLINE_WIDTH},${flatY}`,
      areaPath: `M0,${flatY} L${SPARKLINE_WIDTH},${flatY} L${SPARKLINE_WIDTH},${SPARKLINE_HEIGHT} L0,${SPARKLINE_HEIGHT} Z`
    };
  }

  const maxBuckets = 64;
  let sampled: number[];
  if (values.length === 1) {
    sampled = [values[0], values[0]];
  } else if (values.length <= maxBuckets) {
    sampled = values;
  } else if (mode === 'rate') {
    sampled = [];
    for (let b = 0; b < maxBuckets; b += 1) {
      const start = Math.floor((b * values.length) / maxBuckets);
      const end = Math.max(start + 1, Math.floor(((b + 1) * values.length) / maxBuckets));
      let bucketMax = 0;
      for (let i = start; i < end; i += 1) {
        if (values[i] > bucketMax) {
          bucketMax = values[i];
        }
      }
      sampled.push(bucketMax);
    }
  } else {
    sampled = [];
    const step = (values.length - 1) / (maxBuckets - 1);
    for (let b = 0; b < maxBuckets; b += 1) {
      const idx = Math.min(values.length - 1, Math.round(b * step));
      sampled.push(values[idx]);
    }
  }

  const minVal = mode === 'cumulative' ? Math.min(...sampled, 0) : 0;
  const maxVal = Math.max(...sampled, 0);
  const range = maxVal - minVal;

  const topPad = 3;
  const bottomY = SPARKLINE_HEIGHT - 2.5;
  const usableHeight = bottomY - topPad;

  const coords = sampled.map((val, idx) => {
    const x = (idx / (sampled.length - 1)) * SPARKLINE_WIDTH;
    const normalized = range > 0 ? Math.max(0, Math.min(1, (val - minVal) / range)) : 0;
    const y = bottomY - normalized * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M${coords.join(' L')}`;
  const areaPath = `${linePath} L${SPARKLINE_WIDTH},${SPARKLINE_HEIGHT} L0,${SPARKLINE_HEIGHT} Z`;

  return { linePath, areaPath };
}

type CardSparklineProps = {
  linePath: string;
  areaPath: string;
  strokeColor: string;
  fillColor: string;
  ariaLabel: string;
};

function CardSparkline({
  linePath,
  areaPath,
  strokeColor,
  fillColor,
  ariaLabel
}: CardSparklineProps) {
  return (
    <div className="stat-sparkline" role="img" aria-label={ariaLabel}>
      <svg
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        className="stat-sparkline-svg"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={areaPath} fill={fillColor} />
        <path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.75}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

type ThroughputTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: NetworkChartPoint }>;
};

function ThroughputTooltip({ active, payload }: ThroughputTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const pt = payload[0].payload;
  const combinedMBps = pt.ingressMBps + pt.egressMBps;

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #94a3b8',
        borderRadius: 6,
        padding: '0.65rem 0.8rem',
        boxShadow: '0 4px 12px rgba(44, 49, 67, 0.14)',
        fontSize: '0.82rem',
        color: '#2c3143',
        minWidth: 250
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
        Elapsed: {formatElapsedAxisTick(pt.relativeTime)} ({formatShortTime(pt.timestamp)})
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.75rem',
          paddingBottom: '0.3rem',
          marginBottom: '0.3rem',
          borderBottom: '1px solid #dce5ed',
          fontWeight: 700
        }}
      >
        <span>Combined throughput</span>
        <span className="tabular-nums">{formatRateMBps(combinedMBps)}</span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginBottom: '0.2rem'
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <span
            className="color-swatch"
            style={{ background: NETWORK_INGRESS_COLOR }}
            aria-hidden="true"
          />
          <span>Download / Ingress</span>
        </span>
        <span className="tabular-nums" style={{ fontWeight: 700 }}>
          {formatRateMBps(pt.ingressMBps)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem'
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <span
            className="color-swatch"
            style={{ background: NETWORK_EGRESS_COLOR }}
            aria-hidden="true"
          />
          <span>Upload / Egress</span>
        </span>
        <span className="tabular-nums" style={{ fontWeight: 700 }}>
          {formatRateMBps(pt.egressMBps)}
        </span>
      </div>
      {pt.intervalDrops > 0 && (
        <div
          style={{
            marginTop: '0.35rem',
            paddingTop: '0.3rem',
            borderTop: '1px solid #dce5ed',
            color: NETWORK_CONTENTION_COLOR,
            fontWeight: 700
          }}
        >
          Contention: {pt.intervalDrops.toLocaleString()} packet drops in interval
        </div>
      )}
    </div>
  );
}

type CumulativeTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: NetworkChartPoint }>;
  volumeMode: 'boot' | 'window';
};

function CumulativeTooltip({ active, payload, volumeMode }: CumulativeTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const pt = payload[0].payload;
  const totalBootBytes = pt.rxBytes + pt.txBytes;
  const totalWindowBytes = pt.windowRxBytes + pt.windowTxBytes;

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #94a3b8',
        borderRadius: 6,
        padding: '0.65rem 0.8rem',
        boxShadow: '0 4px 12px rgba(44, 49, 67, 0.14)',
        fontSize: '0.82rem',
        color: '#2c3143',
        minWidth: 265
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
        Elapsed: {formatElapsedAxisTick(pt.relativeTime)} ({formatShortTime(pt.timestamp)})
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.75rem',
          paddingBottom: '0.3rem',
          marginBottom: '0.3rem',
          borderBottom: '1px solid #dce5ed',
          fontWeight: 700
        }}
      >
        <span>
          {volumeMode === 'window' ? 'Transferred in timeframe' : 'Total since instance boot'}
        </span>
        <span className="tabular-nums">
          {volumeMode === 'window'
            ? `+${formatBytesVolume(totalWindowBytes)}`
            : formatBytesVolume(totalBootBytes)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginBottom: '0.2rem'
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <span
            className="color-swatch"
            style={{ background: NETWORK_INGRESS_COLOR }}
            aria-hidden="true"
          />
          <span>Ingress (Data In)</span>
        </span>
        <span className="tabular-nums" style={{ fontWeight: 700 }}>
          {volumeMode === 'window'
            ? `+${formatBytesVolume(pt.windowRxBytes)}`
            : formatBytesVolume(pt.rxBytes)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem'
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <span
            className="color-swatch"
            style={{ background: NETWORK_EGRESS_COLOR }}
            aria-hidden="true"
          />
          <span>Egress (Data Out)</span>
        </span>
        <span className="tabular-nums" style={{ fontWeight: 700 }}>
          {volumeMode === 'window'
            ? `+${formatBytesVolume(pt.windowTxBytes)}`
            : formatBytesVolume(pt.txBytes)}
        </span>
      </div>
      <div
        style={{
          marginTop: '0.35rem',
          paddingTop: '0.3rem',
          borderTop: '1px solid #dce5ed',
          color: '#58585a',
          fontSize: '0.78rem'
        }}
      >
        {volumeMode === 'window' ? (
          <span>
            Lifetime since boot: <strong>{formatBytesVolume(pt.rxBytes)}</strong> in ·{' '}
            <strong>{formatBytesVolume(pt.txBytes)}</strong> out
          </span>
        ) : (
          <span>
            In timeframe: <strong>+{formatBytesVolume(pt.windowRxBytes)}</strong> in ·{' '}
            <strong>+{formatBytesVolume(pt.windowTxBytes)}</strong> out
          </span>
        )}
      </div>
    </div>
  );
}

export default function NetworkDashboard({
  samples,
  resetZoomSignal = 0,
  toolbarPortalEl = null,
  printMetadata
}: Props) {
  const throughputTitleId = useId();
  const throughputBodyId = useId();
  const volumeTitleId = useId();
  const volumeBodyId = useId();

  const [throughputCollapsed, setThroughputCollapsed] = useState(false);
  const [volumeCollapsed, setVolumeCollapsed] = useState(false);
  const [throughputHelpExpanded, setThroughputHelpExpanded] = useState(false);
  const [volumeHelpExpanded, setVolumeHelpExpanded] = useState(false);
  const [volumeMode, setVolumeMode] = useState<'boot' | 'window'>('boot');

  const [zoomRange, setZoomRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [dragStartSampleIndex, setDragStartSampleIndex] = useState<number | null>(null);
  const [dragEndSampleIndex, setDragEndSampleIndex] = useState<number | null>(null);
  const [pinnedSampleIndex, setPinnedSampleIndex] = useState<number | null>(null);
  const dragMovedRef = useRef(false);

  const resetZoom = () => {
    setZoomRange(null);
    setDragStartSampleIndex(null);
    setDragEndSampleIndex(null);
    setPinnedSampleIndex(null);
  };

  useEffect(() => {
    resetZoom();
  }, [resetZoomSignal]);

  const networkSamples = useMemo(
    () => samples.filter(sample => sample.network !== undefined),
    [samples]
  );

  const allPoints = useMemo<NetworkChartPoint[]>(() => {
    if (networkSamples.length === 0) {
      return [];
    }

    const firstMs = Date.parse(networkSamples[0].timestamp);
    const baseMs = Number.isFinite(firstMs) ? firstMs : 0;
    const baseRxBytes = networkSamples[0].network?.rxBytes ?? 0;
    const baseTxBytes = networkSamples[0].network?.txBytes ?? 0;

    const rawPoints: NetworkChartPoint[] = networkSamples.map((sample, index) => {
      const net = sample.network!;
      const ms = Date.parse(sample.timestamp);
      const timestampMs = Number.isFinite(ms) ? ms : baseMs + index * 10000;
      const relativeSeconds = Math.max(0, (timestampMs - baseMs) / 1000);
      const cumulativeDrops =
        (net.rxDropped ?? 0) +
        (net.txDropped ?? 0) +
        (net.rxErrors ?? 0) +
        (net.txErrors ?? 0);

      let ingressMBps = 0;
      let egressMBps = 0;
      let intervalDrops = 0;

      if (index > 0) {
        const prevSample = networkSamples[index - 1];
        const prevNet = prevSample.network!;
        const prevMs = Date.parse(prevSample.timestamp);
        const dtSeconds =
          Number.isFinite(prevMs) && timestampMs > prevMs
            ? (timestampMs - prevMs) / 1000
            : 10;

        if (dtSeconds > 0) {
          const dRx = Math.max(0, net.rxBytes - prevNet.rxBytes);
          const dTx = Math.max(0, net.txBytes - prevNet.txBytes);
          ingressMBps = dRx / dtSeconds / BYTES_PER_MB_DECIMAL;
          egressMBps = dTx / dtSeconds / BYTES_PER_MB_DECIMAL;
        }

        const prevDrops =
          (prevNet.rxDropped ?? 0) +
          (prevNet.txDropped ?? 0) +
          (prevNet.rxErrors ?? 0) +
          (prevNet.txErrors ?? 0);
        intervalDrops = Math.max(0, cumulativeDrops - prevDrops);
      }

      return {
        sampleIndex: index,
        timestamp: sample.timestamp,
        timestampMs,
        relativeSeconds,
        relativeTime: formatRelativeDuration(relativeSeconds),
        ingressMBps,
        egressMBps,
        rxBytes: net.rxBytes,
        txBytes: net.txBytes,
        rxGiB: net.rxBytes / BYTES_PER_GIB,
        txGiB: net.txBytes / BYTES_PER_GIB,
        windowRxBytes: Math.max(0, net.rxBytes - baseRxBytes),
        windowTxBytes: Math.max(0, net.txBytes - baseTxBytes),
        cumulativeDrops,
        intervalDrops
      };
    });

    // Backfill the first sample's instantaneous rate from the second sample so the left edge
    // of the throughput chart reflects the initial transfer rate rather than starting at 0.
    if (rawPoints.length >= 2) {
      rawPoints[0] = {
        ...rawPoints[0],
        ingressMBps: rawPoints[1].ingressMBps,
        egressMBps: rawPoints[1].egressMBps
      };
    }

    return rawPoints;
  }, [networkSamples]);

  const displayedPoints = useMemo(() => {
    if (allPoints.length === 0) {
      return [];
    }
    const sliced = !zoomRange
      ? allPoints
      : allPoints.slice(
          Math.max(0, Math.min(zoomRange.startIndex, allPoints.length - 1)),
          Math.max(0, Math.min(zoomRange.endIndex, allPoints.length - 1)) + 1
        );

    if (sliced.length === 0) {
      return [];
    }

    const windowStartRx = sliced[0].rxBytes;
    const windowStartTx = sliced[0].txBytes;
    return sliced.map(pt => ({
      ...pt,
      windowRxBytes: Math.max(0, pt.rxBytes - windowStartRx),
      windowTxBytes: Math.max(0, pt.txBytes - windowStartTx)
    }));
  }, [allPoints, zoomRange]);

  const xAxisTicks = useMemo(() => selectAdaptiveTicks(displayedPoints, 8), [displayedPoints]);

  const pinnedPoint = useMemo(() => {
    if (pinnedSampleIndex === null) {
      return null;
    }
    return displayedPoints.find(point => point.sampleIndex === pinnedSampleIndex) ?? null;
  }, [displayedPoints, pinnedSampleIndex]);

  const summary = useMemo(() => {
    if (displayedPoints.length === 0) {
      return null;
    }

    const first = displayedPoints[0];
    const latest = displayedPoints[displayedPoints.length - 1];

    let peakIngressMBps = 0;
    let peakIngressTimestamp = latest.timestamp;
    let sumIngressMBps = 0;

    let peakEgressMBps = 0;
    let peakEgressTimestamp = latest.timestamp;
    let sumEgressMBps = 0;

    let windowDrops = 0;

    for (const pt of displayedPoints) {
      sumIngressMBps += pt.ingressMBps;
      sumEgressMBps += pt.egressMBps;
      windowDrops += pt.intervalDrops;

      if (pt.ingressMBps >= peakIngressMBps) {
        peakIngressMBps = pt.ingressMBps;
        peakIngressTimestamp = pt.timestamp;
      }
      if (pt.egressMBps >= peakEgressMBps) {
        peakEgressMBps = pt.egressMBps;
        peakEgressTimestamp = pt.timestamp;
      }
    }

    const avgIngressMBps = sumIngressMBps / displayedPoints.length;
    const avgEgressMBps = sumEgressMBps / displayedPoints.length;
    const windowIngressBytes = Math.max(0, latest.rxBytes - first.rxBytes);
    const windowEgressBytes = Math.max(0, latest.txBytes - first.txBytes);

    return {
      first,
      latest,
      avgIngressMBps,
      peakIngressMBps,
      peakIngressTimestamp,
      avgEgressMBps,
      peakEgressMBps,
      peakEgressTimestamp,
      windowIngressBytes,
      windowEgressBytes,
      windowDrops,
      cumulativeDrops: latest.cumulativeDrops
    };
  }, [displayedPoints]);

  const getSampleIndexFromChartEvent = (chartState: unknown): number | null => {
    if (!chartState || typeof chartState !== 'object') {
      return null;
    }
    const state = chartState as {
      activePayload?: Array<{ payload?: NetworkChartPoint }>;
      activeLabel?: string;
    };
    const fromPayload = state.activePayload?.[0]?.payload?.sampleIndex;
    if (typeof fromPayload === 'number') {
      return fromPayload;
    }
    if (typeof state.activeLabel === 'string') {
      const match = displayedPoints.find(point => point.relativeTime === state.activeLabel);
      if (match) {
        return match.sampleIndex;
      }
    }
    return null;
  };

  const getRelativeTimeBySampleIndex = (sampleIndex: number): string | null => {
    const match = displayedPoints.find(point => point.sampleIndex === sampleIndex);
    return match ? match.relativeTime : null;
  };

  const handleChartMouseDown = (chartState: unknown) => {
    const sampleIndex = getSampleIndexFromChartEvent(chartState);
    if (sampleIndex === null) {
      return;
    }
    dragMovedRef.current = false;
    setDragStartSampleIndex(sampleIndex);
    setDragEndSampleIndex(sampleIndex);
  };

  const handleChartMouseMove = (chartState: unknown) => {
    if (dragStartSampleIndex === null) {
      return;
    }
    const sampleIndex = getSampleIndexFromChartEvent(chartState);
    if (sampleIndex === null) {
      return;
    }
    if (sampleIndex !== dragStartSampleIndex) {
      dragMovedRef.current = true;
    }
    setDragEndSampleIndex(sampleIndex);
  };

  const handleChartMouseUp = (chartState: unknown) => {
    if (dragStartSampleIndex === null) {
      return;
    }
    const endIndex = getSampleIndexFromChartEvent(chartState) ?? dragEndSampleIndex ?? dragStartSampleIndex;

    if (dragMovedRef.current && endIndex !== dragStartSampleIndex) {
      const start = Math.min(dragStartSampleIndex, endIndex);
      const end = Math.max(dragStartSampleIndex, endIndex);
      setZoomRange({ startIndex: start, endIndex: end });
    } else {
      setPinnedSampleIndex(previous => (previous === endIndex ? null : endIndex));
    }

    setDragStartSampleIndex(null);
    setDragEndSampleIndex(null);
    dragMovedRef.current = false;
  };

  // Determine whether the cumulative volume chart should render in MiB or GiB on the Y-axis
  const volumeChartScale = useMemo(() => {
    if (displayedPoints.length === 0) {
      return { unit: 'GiB' as const, divisor: BYTES_PER_GIB };
    }
    const last = displayedPoints[displayedPoints.length - 1];
    const maxBytes =
      volumeMode === 'window'
        ? Math.max(last.windowRxBytes, last.windowTxBytes)
        : Math.max(last.rxBytes, last.txBytes);

    if (maxBytes < BYTES_PER_GIB) {
      return { unit: 'MiB' as const, divisor: BYTES_PER_MIB };
    }
    return { unit: 'GiB' as const, divisor: BYTES_PER_GIB };
  }, [displayedPoints, volumeMode]);

  const volumeChartPoints = useMemo(() => {
    const { divisor } = volumeChartScale;
    return displayedPoints.map(pt => ({
      ...pt,
      displayIngressVolume:
        (volumeMode === 'window' ? pt.windowRxBytes : pt.rxBytes) / divisor,
      displayEgressVolume:
        (volumeMode === 'window' ? pt.windowTxBytes : pt.txBytes) / divisor
    }));
  }, [displayedPoints, volumeChartScale, volumeMode]);

  const sparklines = useMemo(() => {
    const ingressRates = displayedPoints.map(pt => pt.ingressMBps);
    const egressRates = displayedPoints.map(pt => pt.egressMBps);
    const ingressWindowVolumes = displayedPoints.map(pt => pt.windowRxBytes);
    const egressWindowVolumes = displayedPoints.map(pt => pt.windowTxBytes);

    return {
      ingressRate: buildSparklinePaths(ingressRates, 'rate'),
      egressRate: buildSparklinePaths(egressRates, 'rate'),
      ingressVolume: buildSparklinePaths(ingressWindowVolumes, 'cumulative'),
      egressVolume: buildSparklinePaths(egressWindowVolumes, 'cumulative')
    };
  }, [displayedPoints]);

  if (!summary) {
    return (
      <div className="panel">
        <div className="panel-body">
          <p style={{ margin: 0, color: 'var(--monitor-grey)' }}>
            No network telemetry is available in the selected timeframe yet. Waiting for the next
            node telemetry sample…
          </p>
        </div>
      </div>
    );
  }

  const { latest } = summary;
  const totalBootBytes = latest.rxBytes + latest.txBytes;
  const ingressSharePct =
    totalBootBytes > 0 ? (latest.rxBytes / totalBootBytes) * 100 : 0;
  const egressSharePct =
    totalBootBytes > 0 ? (latest.txBytes / totalBootBytes) * 100 : 0;

  const ingressRateMeterTooltip =
    'Includes: Uploading files to Galaxy, pulling tool containers, and fetching CVMFS reference data';
  const egressRateMeterTooltip =
    'Includes: Downloading results to your computer and exporting datasets or histories to external storage';
  const ingressTotalMeterTooltip =
    'Includes: All data received since instance start — uploaded files, pulled tool containers, and fetched CVMFS reference data';
  const egressTotalMeterTooltip =
    'Includes: All data sent out since instance start — downloaded results and datasets or histories exported to external storage';

  const zoomWindowLabel =
    zoomRange && displayedPoints.length > 0
      ? `${formatElapsedAxisTick(displayedPoints[0].relativeTime)} – ${formatElapsedAxisTick(
          displayedPoints[displayedPoints.length - 1].relativeTime
        )}`
      : null;

  return (
    <div data-print-content className="dashboard-stack">
      <div className="print-summary-header">
        <div className="print-summary-title">Galaxy K8s Monitor — Network Report</div>
        <div className="print-summary-meta">
          <span>
            Namespace: <strong>{printMetadata?.namespace ?? '-'}</strong>
          </span>
          <span>
            Timeframe: <strong>{printMetadata?.timeframeLabel ?? 'All'}</strong>
          </span>
          <span>
            Source: <strong>{printMetadata?.sourceLabel ?? 'Live stream'}</strong>
          </span>
          <span>
            Samples: <strong>{displayedPoints.length.toLocaleString()}</strong>
          </span>
          <span>
            Exported: <strong>{new Date().toLocaleString()}</strong>
          </span>
        </div>
      </div>

      {toolbarPortalEl &&
        zoomRange &&
        zoomWindowLabel &&
        createPortal(
          <>
            <span className="interaction-pill">Zoom: {zoomWindowLabel}</span>
            <button type="button" className="btn-compact" onClick={resetZoom}>
              Reset zoom
            </button>
          </>,
          toolbarPortalEl
        )}

      <section className="stats-section" aria-label="Network utilization summary">
        <div className="stats-header-bar">
          <span>
            External network interface · Transfer speeds in <strong>MB/s</strong> and cumulative
            data volume since instance start
          </span>
          {summary.windowDrops > 0 ? (
            <span
              className="badge-scope"
              style={{
                background: '#fef3c7',
                borderColor: '#f59e0b',
                color: '#92400e'
              }}
              title="Packet drops or interface errors occurred during the selected timeframe, indicating temporary network contention or bandwidth throttling."
            >
              Contention: {summary.windowDrops.toLocaleString()} packet{' '}
              {summary.windowDrops === 1 ? 'drop' : 'drops'} in timeframe
            </span>
          ) : (
            <span
              className="badge-scope"
              title="Zero packet drops or network interface errors during the selected timeframe."
            >
              Network Health: Normal (0 packet drops)
            </span>
          )}
        </div>

        <div className="stats-grid">
          {/* Card 1: Ingress */}
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Ingress</span>
              <span className="stat-pct">
                <span className="stat-pct-sub">Avg </span>
                {formatRateMBps(summary.avgIngressMBps)}
              </span>
            </div>
            <div className="stat-value">{formatRateMBps(latest.ingressMBps)}</div>
            <div
              className="stat-meter-wrapper"
              tabIndex={0}
              aria-label={ingressRateMeterTooltip}
            >
              <CardSparkline
                linePath={sparklines.ingressRate.linePath}
                areaPath={sparklines.ingressRate.areaPath}
                strokeColor={NETWORK_INGRESS_COLOR}
                fillColor="rgba(90, 169, 164, 0.25)"
                ariaLabel={ingressRateMeterTooltip}
              />
              <div className="stat-meter-tooltip" role="tooltip">
                <div className="stat-meter-tooltip-row">
                  <span>
                    <strong>Includes:</strong> Uploading files to Galaxy, pulling tool containers,
                    and fetching CVMFS reference data
                  </span>
                </div>
              </div>
            </div>
            <div className="stat-secondary">
              <span>Timeframe rate trend</span>
              <span>
                Peak: <strong>{formatRateMBps(summary.peakIngressMBps)}</strong>
              </span>
            </div>
          </div>

          {/* Card 2: Egress */}
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Egress</span>
              <span className="stat-pct">
                <span className="stat-pct-sub">Avg </span>
                {formatRateMBps(summary.avgEgressMBps)}
              </span>
            </div>
            <div className="stat-value">{formatRateMBps(latest.egressMBps)}</div>
            <div
              className="stat-meter-wrapper"
              tabIndex={0}
              aria-label={egressRateMeterTooltip}
            >
              <CardSparkline
                linePath={sparklines.egressRate.linePath}
                areaPath={sparklines.egressRate.areaPath}
                strokeColor={NETWORK_EGRESS_COLOR}
                fillColor="rgba(162, 155, 254, 0.25)"
                ariaLabel={egressRateMeterTooltip}
              />
              <div className="stat-meter-tooltip" role="tooltip">
                <div className="stat-meter-tooltip-row">
                  <span>
                    <strong>Includes:</strong> Downloading results to your computer and exporting
                    datasets or histories to external storage
                  </span>
                </div>
              </div>
            </div>
            <div className="stat-secondary">
              <span>Timeframe rate trend</span>
              <span>
                Peak: <strong>{formatRateMBps(summary.peakEgressMBps)}</strong>
              </span>
            </div>
          </div>

          {/* Card 3: Total Ingress */}
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Total Ingress</span>
              <span className="stat-pct" style={{ color: 'var(--monitor-primary)' }}>
                +{formatBytesVolume(summary.windowIngressBytes)}{' '}
                <span className="stat-pct-sub">in timeframe</span>
              </span>
            </div>
            <div className="stat-value">{formatBytesVolume(latest.rxBytes)}</div>
            <div
              className="stat-meter-wrapper"
              tabIndex={0}
              aria-label={ingressTotalMeterTooltip}
            >
              <CardSparkline
                linePath={sparklines.ingressVolume.linePath}
                areaPath={sparklines.ingressVolume.areaPath}
                strokeColor={NETWORK_INGRESS_COLOR}
                fillColor="rgba(90, 169, 164, 0.25)"
                ariaLabel={ingressTotalMeterTooltip}
              />
              <div className="stat-meter-tooltip" role="tooltip">
                <div className="stat-meter-tooltip-row">
                  <span>
                    <strong>Includes:</strong> All data received since instance start — uploaded
                    files, pulled tool containers, and fetched CVMFS reference data
                  </span>
                </div>
              </div>
            </div>
            <div className="stat-secondary">
              <span>Cumulative since boot</span>
              <span>
                <strong>{ingressSharePct.toFixed(1)}%</strong> of total
              </span>
            </div>
          </div>

          {/* Card 4: Total Egress */}
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Total Egress</span>
              <span className="stat-pct" style={{ color: 'var(--monitor-primary)' }}>
                +{formatBytesVolume(summary.windowEgressBytes)}{' '}
                <span className="stat-pct-sub">in timeframe</span>
              </span>
            </div>
            <div className="stat-value">{formatBytesVolume(latest.txBytes)}</div>
            <div
              className="stat-meter-wrapper"
              tabIndex={0}
              aria-label={egressTotalMeterTooltip}
            >
              <CardSparkline
                linePath={sparklines.egressVolume.linePath}
                areaPath={sparklines.egressVolume.areaPath}
                strokeColor={NETWORK_EGRESS_COLOR}
                fillColor="rgba(162, 155, 254, 0.25)"
                ariaLabel={egressTotalMeterTooltip}
              />
              <div className="stat-meter-tooltip" role="tooltip">
                <div className="stat-meter-tooltip-row">
                  <span>
                    <strong>Includes:</strong> All data sent out since instance start — downloaded
                    results and datasets or histories exported to external storage
                  </span>
                </div>
              </div>
            </div>
            <div className="stat-secondary">
              <span>Cumulative since boot</span>
              <span>
                <strong>{egressSharePct.toFixed(1)}%</strong> of total
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Chart Panel 1: Network Throughput */}
      <section
        className="panel"
        aria-labelledby={throughputTitleId}
        data-pinned={pinnedPoint ? 'true' : 'false'}
      >
        <div
          className="panel-header"
          data-collapsed={throughputCollapsed ? 'true' : 'false'}
        >
          <div className="panel-title-group">
            <h3 id={throughputTitleId} className="panel-title">
              Network Throughput
            </h3>
            <span className="panel-subtitle">
              Inbound download (Ingress) and outbound upload (Egress) speed · Drag across chart to
              zoom
            </span>
          </div>
          <div className="panel-header-actions" data-no-print>
            {zoomRange && zoomWindowLabel && (
              <>
                <span className="badge-scope" title="Active zoom window">
                  Zoom: {zoomWindowLabel}
                </span>
                <button type="button" className="btn-compact" onClick={resetZoom}>
                  Reset zoom
                </button>
              </>
            )}
            <button
              type="button"
              className="btn-compact"
              aria-expanded={!throughputCollapsed}
              aria-controls={throughputBodyId}
              onClick={() => setThroughputCollapsed(prev => !prev)}
            >
              {throughputCollapsed ? 'Expand' : 'Collapse'}
            </button>
          </div>
        </div>

        {!throughputCollapsed && (
          <div id={throughputBodyId}>
            <div className="panel-body">
              <p className="panel-description">
                Shows real-time download (ingress) and upload (egress) speeds across the instance’s
                external network interface.
                {throughputHelpExpanded && (
                  <>
                    {' '}
                    <strong>Download / Ingress</strong> reflects incoming data such as file uploads
                    to Galaxy, container image pulls, and CVMFS reference data fetches.{' '}
                    <strong>Upload / Egress</strong> reflects outbound data such as downloading
                    analysis results to your computer or exporting histories to external storage.
                  </>
                )}
                <button
                  type="button"
                  className="btn-inline-toggle"
                  aria-expanded={throughputHelpExpanded}
                  onClick={() => setThroughputHelpExpanded(prev => !prev)}
                >
                  {throughputHelpExpanded ? 'Hide' : 'More'}
                </button>
              </p>

              <div className="chart-key" style={{ marginBottom: '0.65rem' }}>
                <span className="chart-key-item">
                  <span
                    className="color-swatch"
                    style={{ background: NETWORK_INGRESS_COLOR }}
                    aria-hidden="true"
                  />
                  <span>Download / Ingress (MB/s)</span>
                </span>
                <span className="chart-key-item">
                  <span
                    className="color-swatch"
                    style={{ background: NETWORK_EGRESS_COLOR }}
                    aria-hidden="true"
                  />
                  <span>Upload / Egress (MB/s)</span>
                </span>
              </div>

              <div style={{ height: 300, position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={displayedPoints}
                    margin={{ top: 10, right: 20, left: 8, bottom: 8 }}
                    onMouseDown={handleChartMouseDown}
                    onMouseMove={handleChartMouseMove}
                    onMouseUp={handleChartMouseUp}
                  >
                    <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="relativeTime"
                      ticks={xAxisTicks}
                      interval={0}
                      minTickGap={36}
                      stroke={CHART_AXIS_COLOR}
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 13 }}
                      tickFormatter={(val: string) => formatElapsedAxisTick(String(val))}
                    />
                    <YAxis
                      width={76}
                      domain={[
                        0,
                        (dataMax: number) => Math.max(1, Math.ceil(dataMax * 1.15))
                      ]}
                      stroke={CHART_AXIS_COLOR}
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 13 }}
                      tickFormatter={(val: number) => `${Number(val.toFixed(1))} MB/s`}
                    />
                    <Tooltip
                      content={<ThroughputTooltip />}
                      offset={24}
                      wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                    />

                    {pinnedPoint && (
                      <ReferenceLine
                        x={pinnedPoint.relativeTime}
                        stroke={ACTIVE_SAMPLE_LINE_COLOR}
                        strokeWidth={1.5}
                        strokeDasharray="3 3"
                      />
                    )}

                    {dragStartSampleIndex !== null && dragEndSampleIndex !== null && (
                      <ReferenceArea
                        x1={
                          getRelativeTimeBySampleIndex(
                            Math.min(dragStartSampleIndex, dragEndSampleIndex)
                          ) ?? undefined
                        }
                        x2={
                          getRelativeTimeBySampleIndex(
                            Math.max(dragStartSampleIndex, dragEndSampleIndex)
                          ) ?? undefined
                        }
                        fill={CHART_SELECTION_FILL}
                        fillOpacity={0.18}
                      />
                    )}

                    <Area
                      type="monotone"
                      dataKey="ingressMBps"
                      name="Download / Ingress (MB/s)"
                      stroke={NETWORK_INGRESS_COLOR}
                      strokeWidth={2}
                      fill={NETWORK_INGRESS_COLOR}
                      fillOpacity={0.45}
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="egressMBps"
                      name="Upload / Egress (MB/s)"
                      stroke={NETWORK_EGRESS_COLOR}
                      strokeWidth={2}
                      fill={NETWORK_EGRESS_COLOR}
                      fillOpacity={0.45}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <details className="inline-details" data-no-print>
              <summary>Tabular summary (Network Throughput)</summary>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Direction</th>
                      <th scope="col" className="num">Current Rate</th>
                      <th scope="col" className="num">Timeframe Average</th>
                      <th scope="col" className="num">Timeframe Peak</th>
                      <th scope="col" className="num">Peak Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>Download / Ingress</strong>
                      </td>
                      <td className="num">{formatRateMBps(latest.ingressMBps)}</td>
                      <td className="num">{formatRateMBps(summary.avgIngressMBps)}</td>
                      <td className="num">{formatRateMBps(summary.peakIngressMBps)}</td>
                      <td className="num">{formatShortTime(summary.peakIngressTimestamp)}</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Upload / Egress</strong>
                      </td>
                      <td className="num">{formatRateMBps(latest.egressMBps)}</td>
                      <td className="num">{formatRateMBps(summary.avgEgressMBps)}</td>
                      <td className="num">{formatRateMBps(summary.peakEgressMBps)}</td>
                      <td className="num">{formatShortTime(summary.peakEgressTimestamp)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* Chart Panel 2: Cumulative Data Transferred */}
      <section
        className="panel"
        aria-labelledby={volumeTitleId}
        data-pinned={pinnedPoint ? 'true' : 'false'}
      >
        <div
          className="panel-header"
          data-collapsed={volumeCollapsed ? 'true' : 'false'}
        >
          <div className="panel-title-group">
            <h3 id={volumeTitleId} className="panel-title">
              Cumulative Data Transferred
            </h3>
            <span className="panel-subtitle">
              Total data received (Ingress) and sent out (Egress) · Drag across chart to zoom
            </span>
          </div>
          <div className="panel-header-actions" data-no-print>
            {zoomRange && zoomWindowLabel && (
              <>
                <span className="badge-scope" title="Active zoom window">
                  Zoom: {zoomWindowLabel}
                </span>
                <button type="button" className="btn-compact" onClick={resetZoom}>
                  Reset zoom
                </button>
              </>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={volumeMode === 'window'}
              className="toggle-switch-btn"
              title={
                volumeMode === 'window'
                  ? 'Showing data transferred in timeframe. Toggle off to show cumulative total since boot.'
                  : 'Showing cumulative total since boot. Toggle on to show data transferred in timeframe.'
              }
              onClick={() => setVolumeMode(prev => (prev === 'boot' ? 'window' : 'boot'))}
            >
              <span>In timeframe</span>
              <span className="toggle-switch-track" aria-hidden="true">
                <span className="toggle-switch-thumb" />
              </span>
            </button>
            <button
              type="button"
              className="btn-compact"
              aria-expanded={!volumeCollapsed}
              aria-controls={volumeBodyId}
              onClick={() => setVolumeCollapsed(prev => !prev)}
            >
              {volumeCollapsed ? 'Expand' : 'Collapse'}
            </button>
          </div>
        </div>

        {!volumeCollapsed && (
          <div id={volumeBodyId}>
            <div className="panel-body">
              <p className="panel-description">
                Shows cumulative data volume received (ingress) and sent out (egress) over time.
                {volumeHelpExpanded && (
                  <>
                    {' '}
                    Use the <strong>In timeframe</strong> toggle to switch between total lifetime
                    traffic since instance boot (off) and the amount of data downloaded and uploaded
                    during the selected timeframe (on).
                  </>
                )}
                <button
                  type="button"
                  className="btn-inline-toggle"
                  aria-expanded={volumeHelpExpanded}
                  onClick={() => setVolumeHelpExpanded(prev => !prev)}
                >
                  {volumeHelpExpanded ? 'Hide' : 'More'}
                </button>
              </p>

              <div className="chart-key" style={{ marginBottom: '0.65rem' }}>
                <span className="chart-key-item">
                  <span
                    className="color-swatch"
                    style={{ background: NETWORK_INGRESS_COLOR }}
                    aria-hidden="true"
                  />
                  <span>
                    Ingress / Data In ({volumeChartScale.unit})
                  </span>
                </span>
                <span className="chart-key-item">
                  <span
                    className="color-swatch"
                    style={{ background: NETWORK_EGRESS_COLOR }}
                    aria-hidden="true"
                  />
                  <span>
                    Egress / Data Out ({volumeChartScale.unit})
                  </span>
                </span>
              </div>

              <div style={{ height: 300, position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={volumeChartPoints}
                    margin={{ top: 10, right: 20, left: 8, bottom: 8 }}
                    onMouseDown={handleChartMouseDown}
                    onMouseMove={handleChartMouseMove}
                    onMouseUp={handleChartMouseUp}
                  >
                    <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="relativeTime"
                      ticks={xAxisTicks}
                      interval={0}
                      minTickGap={36}
                      stroke={CHART_AXIS_COLOR}
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 13 }}
                      tickFormatter={(val: string) => formatElapsedAxisTick(String(val))}
                    />
                    <YAxis
                      width={76}
                      domain={[
                        0,
                        (dataMax: number) =>
                          dataMax <= 1 ? 1 : Math.ceil(dataMax * 1.1)
                      ]}
                      stroke={CHART_AXIS_COLOR}
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 13 }}
                      tickFormatter={(val: number) =>
                        `${Number(val.toFixed(val >= 10 ? 1 : 2))} ${volumeChartScale.unit}`
                      }
                    />
                    <Tooltip
                      content={<CumulativeTooltip volumeMode={volumeMode} />}
                      offset={24}
                      wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                    />

                    {pinnedPoint && (
                      <ReferenceLine
                        x={pinnedPoint.relativeTime}
                        stroke={ACTIVE_SAMPLE_LINE_COLOR}
                        strokeWidth={1.5}
                        strokeDasharray="3 3"
                      />
                    )}

                    {dragStartSampleIndex !== null && dragEndSampleIndex !== null && (
                      <ReferenceArea
                        x1={
                          getRelativeTimeBySampleIndex(
                            Math.min(dragStartSampleIndex, dragEndSampleIndex)
                          ) ?? undefined
                        }
                        x2={
                          getRelativeTimeBySampleIndex(
                            Math.max(dragStartSampleIndex, dragEndSampleIndex)
                          ) ?? undefined
                        }
                        fill={CHART_SELECTION_FILL}
                        fillOpacity={0.18}
                      />
                    )}

                    <Area
                      type="monotone"
                      dataKey="displayIngressVolume"
                      name={`Ingress / Data In (${volumeChartScale.unit})`}
                      stroke={NETWORK_INGRESS_COLOR}
                      strokeWidth={2}
                      fill={NETWORK_INGRESS_COLOR}
                      fillOpacity={0.35}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="displayEgressVolume"
                      name={`Egress / Data Out (${volumeChartScale.unit})`}
                      stroke={NETWORK_EGRESS_COLOR}
                      strokeWidth={2.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <details className="inline-details" data-no-print>
              <summary>Tabular summary (Ingress &amp; Egress Data Volume)</summary>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Traffic Direction</th>
                      <th scope="col" className="num">Transferred in Timeframe</th>
                      <th scope="col" className="num">Total Since Instance Boot</th>
                      <th scope="col" className="num">Share of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>Ingress (Data In)</strong>
                      </td>
                      <td className="num">+{formatBytesVolume(summary.windowIngressBytes)}</td>
                      <td className="num">{formatBytesVolume(latest.rxBytes)}</td>
                      <td className="num">{ingressSharePct.toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Egress (Data Out)</strong>
                      </td>
                      <td className="num">+{formatBytesVolume(summary.windowEgressBytes)}</td>
                      <td className="num">{formatBytesVolume(latest.txBytes)}</td>
                      <td className="num">{egressSharePct.toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Combined Network Volume</strong>
                      </td>
                      <td className="num">
                        +{formatBytesVolume(summary.windowIngressBytes + summary.windowEgressBytes)}
                      </td>
                      <td className="num">{formatBytesVolume(totalBootBytes)}</td>
                      <td className="num">100.0%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}
