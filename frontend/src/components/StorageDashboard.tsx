import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
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
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_SELECTION_FILL,
  DISK_AVAILABLE_COLOR,
  DISK_DATA_COLOR,
  DISK_GC_LINE_COLOR,
  DISK_IMAGES_COLOR,
  DISK_POSTGRES_COLOR,
  DISK_PSI_FULL_COLOR,
  DISK_PSI_SOME_COLOR,
  OVERDRAW_COLOR,
  REQUEST_LINE_COLOR
} from '../lib/colors';
import type { Sample } from '../lib/types';
import { bytesToGiB, formatGiB } from '../lib/units';

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

type StoragePoint = {
  sampleIndex: number;
  relativeTime: string;
  timestamp: string;
  capacityGiB: number;
  usedGiB: number;
  availableGiB: number;
  imageUsedGiB: number;
  dataAndSystemGiB: number;
  usedPct: number;
  gcThresholdGiB: number;
  evictionThresholdGiB: number;
  galaxyPvcCapacityGiB: number;
  galaxyPvcUsedGiB: number;
  galaxyPvcAvailableGiB: number;
  galaxyPvcUsedPct: number;
  postgresCapacityGiB: number;
  postgresUsedGiB: number;
  postgresAvailableGiB: number;
  postgresUsedPct: number;
  diskPressure: boolean;
  ioPsiSomePct: number;
  ioPsiFullPct: number;
};

type ZoomRange = {
  startSampleIndex: number;
  endSampleIndex: number;
};

type PressureEpisode = {
  episodeNumber: number;
  startSampleIndex: number;
  endSampleIndex: number;
  startLabel: string;
  endLabel: string;
  startTimestamp: string;
  endTimestamp: string;
  sampleCount: number;
  durationSeconds: number;
  peakUsedPct: number;
  minAvailableGiB: number;
  isOngoing: boolean;
};

function formatIntGiB(valueGiB: number): string {
  return `${Math.round(valueGiB).toLocaleString()} GiB`;
}

function formatCompactGiB(valueGiB: number): string {
  if (valueGiB > 0 && valueGiB < 10) {
    return `${valueGiB.toFixed(1)} GiB`;
  }
  return `${Math.round(valueGiB).toLocaleString()} GiB`;
}

function relativeTime(timestamp: string, firstTimestamp: string): string {
  const first = new Date(firstTimestamp).getTime();
  const current = new Date(timestamp).getTime();
  const diffSeconds = Math.max(0, Math.floor((current - first) / 1000));
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatClockTime(timestamp: string): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatShortTime(timestamp: string): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '<10s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function computePressureIntervals(
  points: StoragePoint[]
): Array<{ startLabel: string; endLabel: string }> {
  const intervals: Array<{ startLabel: string; endLabel: string }> = [];
  let currentStart: string | null = null;
  let lastLabel: string | null = null;

  for (const pt of points) {
    if (pt.diskPressure) {
      if (currentStart === null) {
        currentStart = pt.relativeTime;
      }
      lastLabel = pt.relativeTime;
    } else if (currentStart !== null && lastLabel !== null) {
      intervals.push({ startLabel: currentStart, endLabel: lastLabel });
      currentStart = null;
      lastLabel = null;
    }
  }

  if (currentStart !== null && lastLabel !== null) {
    intervals.push({ startLabel: currentStart, endLabel: lastLabel });
  }

  return intervals;
}

function computePressureEpisodes(points: StoragePoint[]): PressureEpisode[] {
  const episodes: PressureEpisode[] = [];
  let activePoints: StoragePoint[] = [];

  const flushEpisode = (isLastPointInDataset: boolean) => {
    if (activePoints.length === 0) return;
    const first = activePoints[0];
    const last = activePoints[activePoints.length - 1];
    const startMs = new Date(first.timestamp).getTime();
    const endMs = new Date(last.timestamp).getTime();
    const rawDuration = Math.max(0, Math.round((endMs - startMs) / 1000));
    const peakUsedPct = activePoints.reduce((max, pt) => Math.max(max, pt.usedPct), 0);
    const minAvailableGiB = activePoints.reduce(
      (min, pt) => Math.min(min, pt.availableGiB),
      first.availableGiB
    );

    episodes.push({
      episodeNumber: episodes.length + 1,
      startSampleIndex: first.sampleIndex,
      endSampleIndex: last.sampleIndex,
      startLabel: first.relativeTime,
      endLabel: last.relativeTime,
      startTimestamp: first.timestamp,
      endTimestamp: last.timestamp,
      sampleCount: activePoints.length,
      durationSeconds: rawDuration,
      peakUsedPct,
      minAvailableGiB,
      isOngoing: isLastPointInDataset
    });
    activePoints = [];
  };

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt.diskPressure) {
      activePoints.push(pt);
    } else if (activePoints.length > 0) {
      flushEpisode(false);
    }
  }

  if (activePoints.length > 0) {
    flushEpisode(true);
  }

  return episodes;
}

function GalaxyDiskTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ payload: StoragePoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0].payload;
  const formattedTimestamp = point.timestamp
    ? new Date(point.timestamp).toLocaleString()
    : '-';

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-meta">Elapsed time: {label}</div>
      <div className="chart-tooltip-meta">Timestamp: {formattedTimestamp}</div>
      <div className="chart-tooltip-total">
        <div>
          Galaxy Data used: {formatGiB(point.galaxyPvcUsedGiB)} /{' '}
          {formatGiB(point.galaxyPvcCapacityGiB)} ({point.galaxyPvcUsedPct.toFixed(1)}%)
        </div>
        <div
          style={{
            fontWeight: 400,
            fontSize: '0.8rem',
            color: 'var(--monitor-grey)',
            marginTop: 2
          }}
        >
          Free space: <strong>{formatGiB(point.galaxyPvcAvailableGiB)}</strong>
        </div>
      </div>

      <div className="chart-tooltip-list">
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-series">
            <span
              className="color-swatch"
              style={{ background: DISK_DATA_COLOR }}
              aria-hidden="true"
            />
            <span>Galaxy Data Used</span>
          </span>
          <strong>{formatGiB(point.galaxyPvcUsedGiB)}</strong>
        </div>
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-series">
            <span
              className="color-swatch"
              style={{ background: DISK_AVAILABLE_COLOR }}
              aria-hidden="true"
            />
            <span>Available Free Space</span>
          </span>
          <strong>{formatGiB(point.galaxyPvcAvailableGiB)}</strong>
        </div>
      </div>
    </div>
  );
}

function PostgresDiskTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ payload: StoragePoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0].payload;
  const formattedTimestamp = point.timestamp
    ? new Date(point.timestamp).toLocaleString()
    : '-';

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-meta">Elapsed time: {label}</div>
      <div className="chart-tooltip-meta">Timestamp: {formattedTimestamp}</div>
      <div className="chart-tooltip-total">
        <div>
          Postgres DB used: {formatGiB(point.postgresUsedGiB)} /{' '}
          {formatGiB(point.postgresCapacityGiB)} ({point.postgresUsedPct.toFixed(1)}%)
        </div>
        <div
          style={{
            fontWeight: 400,
            fontSize: '0.8rem',
            color: 'var(--monitor-grey)',
            marginTop: 2
          }}
        >
          Free space: <strong>{formatGiB(point.postgresAvailableGiB)}</strong>
        </div>
      </div>

      <div className="chart-tooltip-list">
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-series">
            <span
              className="color-swatch"
              style={{ background: DISK_POSTGRES_COLOR }}
              aria-hidden="true"
            />
            <span>Postgres Database Used</span>
          </span>
          <strong>{formatGiB(point.postgresUsedGiB)}</strong>
        </div>
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-series">
            <span
              className="color-swatch"
              style={{ background: DISK_AVAILABLE_COLOR }}
              aria-hidden="true"
            />
            <span>Available Free Space</span>
          </span>
          <strong>{formatGiB(point.postgresAvailableGiB)}</strong>
        </div>
      </div>
    </div>
  );
}

function StorageUsageTooltip({
  active,
  payload,
  label,
  isDedicatedSystemDisk
}: {
  active?: boolean;
  payload?: Array<{ payload: StoragePoint }>;
  label?: string;
  isDedicatedSystemDisk?: boolean;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0].payload;
  const formattedTimestamp = point.timestamp
    ? new Date(point.timestamp).toLocaleString()
    : '-';

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-meta">Elapsed time: {label}</div>
      <div className="chart-tooltip-meta">Timestamp: {formattedTimestamp}</div>
      <div className="chart-tooltip-total">
        <div>
          {isDedicatedSystemDisk ? 'System disk used' : 'Total used'}: {formatGiB(point.usedGiB)} /{' '}
          {formatGiB(point.capacityGiB)} ({point.usedPct.toFixed(1)}%)
        </div>
        <div
          style={{
            fontWeight: 400,
            fontSize: '0.8rem',
            color: 'var(--monitor-grey)',
            marginTop: 2
          }}
        >
          Free space: <strong>{formatGiB(point.availableGiB)}</strong>
          {point.diskPressure && (
            <span className="text-overdraw" style={{ marginLeft: 6 }}>
              (Disk pressure active)
            </span>
          )}
        </div>
      </div>

      <div className="chart-tooltip-list">
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-series">
            <span
              className="color-swatch"
              style={{ background: DISK_DATA_COLOR }}
              aria-hidden="true"
            />
            <span>
              {isDedicatedSystemDisk
                ? 'System, Logs & Ephemeral Volumes'
                : 'Data, Volumes & System'}
            </span>
          </span>
          <strong>{formatGiB(point.dataAndSystemGiB)}</strong>
        </div>
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-series">
            <span
              className="color-swatch"
              style={{ background: DISK_IMAGES_COLOR }}
              aria-hidden="true"
            />
            <span>Container Images</span>
          </span>
          <strong>{formatGiB(point.imageUsedGiB)}</strong>
        </div>
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-series">
            <span
              className="color-swatch"
              style={{ background: DISK_AVAILABLE_COLOR }}
              aria-hidden="true"
            />
            <span>Available Free Space</span>
          </span>
          <strong>{formatGiB(point.availableGiB)}</strong>
        </div>
      </div>
    </div>
  );
}

function DiskPressureTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ payload: StoragePoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0].payload;
  const formattedTimestamp = point.timestamp
    ? new Date(point.timestamp).toLocaleString()
    : '-';

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-meta">Elapsed time: {label}</div>
      <div className="chart-tooltip-meta">Timestamp: {formattedTimestamp}</div>
      <div className="chart-tooltip-total">
        <div>
          Status:{' '}
          {point.diskPressure ? (
            <span className="text-overdraw">Disk Pressure (reclaiming space)</span>
          ) : point.ioPsiSomePct >= 25 || point.ioPsiFullPct >= 10 ? (
            <span className="text-overdraw">High I/O Wait (disk bottleneck)</span>
          ) : point.ioPsiSomePct >= 10 ? (
            <span style={{ color: DISK_GC_LINE_COLOR }}>Elevated I/O (moderate disk wait)</span>
          ) : (
            <span>Healthy</span>
          )}
        </div>
        <div
          style={{
            fontWeight: 400,
            fontSize: '0.8rem',
            color: 'var(--monitor-grey)',
            marginTop: 2
          }}
        >
          System disk used: {point.usedPct.toFixed(1)}% ({formatGiB(point.availableGiB)} free)
        </div>
      </div>

      <div className="chart-tooltip-list">
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-series">
            <span
              className="color-swatch"
              style={{ background: DISK_PSI_SOME_COLOR }}
              aria-hidden="true"
            />
            <span>Some tasks delayed (partial I/O wait)</span>
          </span>
          <strong>{point.ioPsiSomePct.toFixed(2)}%</strong>
        </div>
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-series">
            <span
              className="color-swatch"
              style={{ background: DISK_PSI_FULL_COLOR }}
              aria-hidden="true"
            />
            <span>All tasks stalled (full I/O wait)</span>
          </span>
          <strong>{point.ioPsiFullPct.toFixed(2)}%</strong>
        </div>
      </div>
    </div>
  );
}

export default function StorageDashboard({
  samples,
  resetZoomSignal = 0,
  toolbarPortalEl,
  printMetadata
}: Props) {
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
  const [galaxyCollapsed, setGalaxyCollapsed] = useState(false);
  const [usageCollapsed, setUsageCollapsed] = useState(false);
  const [postgresCollapsed, setPostgresCollapsed] = useState(false);
  const [pressureCollapsed, setPressureCollapsed] = useState(false);
  const [usageHelpExpanded, setUsageHelpExpanded] = useState(false);
  const [pressureHelpExpanded, setPressureHelpExpanded] = useState(false);
  const [dismissedUpToTimestamp, setDismissedUpToTimestamp] = useState<string | null>(null);
  const [episodesExpanded, setEpisodesExpanded] = useState(false);
  const [dragStartSampleIndex, setDragStartSampleIndex] = useState<number | null>(null);
  const [dragEndSampleIndex, setDragEndSampleIndex] = useState<number | null>(null);
  const suppressNextClickRef = useRef(false);

  const galaxyBodyId = useId();
  const usageBodyId = useId();
  const postgresBodyId = useId();
  const pressureBodyId = useId();

  useEffect(() => {
    setZoomRange(null);
  }, [resetZoomSignal]);

  const storagePoints = useMemo<StoragePoint[]>(() => {
    const withDisk = samples.filter(sample => sample.disk && sample.disk.nodeCapacityBytes > 0);
    if (withDisk.length === 0) {
      return [];
    }

    const firstTimestamp = withDisk[0].timestamp;
    return withDisk.map((sample, sampleIndex) => {
      const disk = sample.disk!;
      const capacityGiB = bytesToGiB(disk.nodeCapacityBytes);
      const usedGiB = bytesToGiB(disk.nodeUsedBytes);
      const availableGiB = bytesToGiB(disk.nodeAvailableBytes);
      const imageUsedGiB = Math.min(usedGiB, bytesToGiB(disk.imageUsedBytes));
      const dataAndSystemGiB = Math.max(0, usedGiB - imageUsedGiB);
      const usedPct = capacityGiB > 0 ? (usedGiB / capacityGiB) * 100 : 0;

      const galaxyPvcCapacityGiB = bytesToGiB(disk.galaxyPvcCapacityBytes ?? 0);
      const galaxyPvcUsedGiB = bytesToGiB(disk.galaxyPvcUsedBytes ?? 0);
      const galaxyPvcAvailableGiB = bytesToGiB(disk.galaxyPvcAvailableBytes ?? 0);
      const galaxyPvcUsedPct =
        galaxyPvcCapacityGiB > 0 ? (galaxyPvcUsedGiB / galaxyPvcCapacityGiB) * 100 : 0;

      const postgresCapacityGiB = bytesToGiB(disk.postgresCapacityBytes ?? 0);
      const postgresUsedGiB = bytesToGiB(disk.postgresUsedBytes ?? 0);
      const postgresAvailableGiB = bytesToGiB(disk.postgresAvailableBytes ?? 0);
      const postgresUsedPct =
        postgresCapacityGiB > 0 ? (postgresUsedGiB / postgresCapacityGiB) * 100 : 0;

      return {
        sampleIndex,
        relativeTime: relativeTime(sample.timestamp, firstTimestamp),
        timestamp: sample.timestamp,
        capacityGiB,
        usedGiB,
        availableGiB,
        imageUsedGiB,
        dataAndSystemGiB,
        usedPct,
        gcThresholdGiB: capacityGiB * 0.85,
        evictionThresholdGiB: capacityGiB * 0.9,
        galaxyPvcCapacityGiB,
        galaxyPvcUsedGiB,
        galaxyPvcAvailableGiB,
        galaxyPvcUsedPct,
        postgresCapacityGiB,
        postgresUsedGiB,
        postgresAvailableGiB,
        postgresUsedPct,
        diskPressure: Boolean(disk.diskPressure),
        ioPsiSomePct: disk.ioPsiSomeAvg10 ?? 0,
        ioPsiFullPct: disk.ioPsiFullAvg10 ?? 0
      };
    });
  }, [samples]);

  const displayedPoints = useMemo(() => {
    if (!zoomRange) {
      return storagePoints;
    }
    return storagePoints.filter(
      pt =>
        pt.sampleIndex >= zoomRange.startSampleIndex &&
        pt.sampleIndex <= zoomRange.endSampleIndex
    );
  }, [storagePoints, zoomRange]);

  const xAxisTicks = useMemo(() => {
    const maxTickCount = 10;
    if (displayedPoints.length === 0) {
      return [] as string[];
    }
    if (displayedPoints.length <= maxTickCount) {
      return displayedPoints.map(pt => pt.relativeTime);
    }
    const step = Math.ceil((displayedPoints.length - 1) / (maxTickCount - 1));
    const ticks: string[] = [];
    for (let index = 0; index < displayedPoints.length; index += step) {
      ticks.push(displayedPoints[index].relativeTime);
    }
    const lastValue = displayedPoints[displayedPoints.length - 1].relativeTime;
    if (ticks[ticks.length - 1] !== lastValue) {
      ticks.push(lastValue);
    }
    return ticks;
  }, [displayedPoints]);

  const pressureIntervals = useMemo(
    () => computePressureIntervals(displayedPoints),
    [displayedPoints]
  );

  const pressureEpisodes = useMemo(
    () => computePressureEpisodes(storagePoints),
    [storagePoints]
  );

  const summary = useMemo(() => {
    if (storagePoints.length === 0) {
      return null;
    }
    const latest = storagePoints[storagePoints.length - 1];
    const peakPoint = storagePoints.reduce(
      (maxPt, pt) => (pt.usedGiB >= maxPt.usedGiB ? pt : maxPt),
      storagePoints[0]
    );
    const peakUsedGiB = peakPoint.usedGiB;
    const peakTimestamp = peakPoint.timestamp;
    const minAvailableGiB = storagePoints.reduce(
      (min, pt) => Math.min(min, pt.availableGiB),
      latest.availableGiB
    );
    const peakImageGiB = storagePoints.reduce((max, pt) => Math.max(max, pt.imageUsedGiB), 0);
    const peakPsiSomePct = storagePoints.reduce((max, pt) => Math.max(max, pt.ioPsiSomePct), 0);
    const peakPsiFullPct = storagePoints.reduce((max, pt) => Math.max(max, pt.ioPsiFullPct), 0);
    const pressureSampleCount = storagePoints.filter(pt => pt.diskPressure).length;
    const peakUsedPct = latest.capacityGiB > 0 ? (peakUsedGiB / latest.capacityGiB) * 100 : 0;

    // Galaxy Data Disk peaks
    const galaxyPoints = storagePoints.filter(pt => pt.galaxyPvcCapacityGiB > 0);
    const peakGalaxyPoint =
      galaxyPoints.length > 0
        ? galaxyPoints.reduce(
            (maxPt, pt) => (pt.galaxyPvcUsedGiB >= maxPt.galaxyPvcUsedGiB ? pt : maxPt),
            galaxyPoints[0]
          )
        : latest;
    const peakGalaxyUsedGiB = peakGalaxyPoint.galaxyPvcUsedGiB;
    const peakGalaxyTimestamp = peakGalaxyPoint.timestamp;
    const peakGalaxyUsedPct =
      latest.galaxyPvcCapacityGiB > 0
        ? (peakGalaxyUsedGiB / latest.galaxyPvcCapacityGiB) * 100
        : 0;
    const minGalaxyAvailableGiB =
      galaxyPoints.length > 0
        ? galaxyPoints.reduce(
            (min, pt) => Math.min(min, pt.galaxyPvcAvailableGiB),
            latest.galaxyPvcAvailableGiB
          )
        : latest.galaxyPvcAvailableGiB;

    // Postgres Disk peaks
    const postgresPoints = storagePoints.filter(pt => pt.postgresCapacityGiB > 0);
    const peakPostgresPoint =
      postgresPoints.length > 0
        ? postgresPoints.reduce(
            (maxPt, pt) => (pt.postgresUsedGiB >= maxPt.postgresUsedGiB ? pt : maxPt),
            postgresPoints[0]
          )
        : latest;
    const peakPostgresUsedGiB = peakPostgresPoint.postgresUsedGiB;
    const peakPostgresTimestamp = peakPostgresPoint.timestamp;
    const peakPostgresUsedPct =
      latest.postgresCapacityGiB > 0
        ? (peakPostgresUsedGiB / latest.postgresCapacityGiB) * 100
        : 0;
    const minPostgresAvailableGiB =
      postgresPoints.length > 0
        ? postgresPoints.reduce(
            (min, pt) => Math.min(min, pt.postgresAvailableGiB),
            latest.postgresAvailableGiB
          )
        : latest.postgresAvailableGiB;

    // 5-minute rolling average for the Disk I/O Wait card so brief single-sample dips/spikes
    // don't misrepresent recent I/O contention.
    const latestMs = new Date(latest.timestamp).getTime();
    const fiveMinAgoMs = latestMs - 5 * 60 * 1000;
    const recentWindowPoints = Number.isFinite(latestMs)
      ? storagePoints.filter(pt => new Date(pt.timestamp).getTime() >= fiveMinAgoMs)
      : [latest];
    const recentPoints = recentWindowPoints.length > 0 ? recentWindowPoints : [latest];
    const recentPsiSomePct =
      recentPoints.reduce((sum, pt) => sum + pt.ioPsiSomePct, 0) / recentPoints.length;
    const recentPsiFullPct =
      recentPoints.reduce((sum, pt) => sum + pt.ioPsiFullPct, 0) / recentPoints.length;

    // Detect if Galaxy PVC is on a dedicated separate disk (capacity differs by >1 GiB)
    const hasDedicatedGalaxyDisk =
      latest.galaxyPvcCapacityGiB > 0 &&
      Math.abs(latest.galaxyPvcCapacityGiB - latest.capacityGiB) > 1;

    const hasPostgresDisk =
      latest.postgresCapacityGiB > 0 &&
      Math.abs(latest.postgresCapacityGiB - latest.capacityGiB) > 1;

    return {
      latest,
      peakUsedGiB,
      peakUsedPct,
      peakTimestamp,
      minAvailableGiB,
      peakImageGiB,
      peakGalaxyUsedGiB,
      peakGalaxyUsedPct,
      peakGalaxyTimestamp,
      minGalaxyAvailableGiB,
      peakPostgresUsedGiB,
      peakPostgresUsedPct,
      peakPostgresTimestamp,
      minPostgresAvailableGiB,
      peakPsiSomePct,
      peakPsiFullPct,
      recentPsiSomePct,
      recentPsiFullPct,
      pressureSampleCount,
      hasDedicatedGalaxyDisk,
      hasPostgresDisk
    };
  }, [storagePoints]);

  const getSampleIndexFromState = (state: {
    activePayload?: Array<{ payload?: StoragePoint }>;
  }): number | null => {
    const sampleIndex = state.activePayload?.[0]?.payload?.sampleIndex;
    return typeof sampleIndex === 'number' ? sampleIndex : null;
  };

  const getRelativeTimeBySampleIndex = (sampleIndex: number): string | null => {
    const found = storagePoints.find(pt => pt.sampleIndex === sampleIndex);
    return found ? found.relativeTime : null;
  };

  const zoomWindowLabel = useMemo(() => {
    if (!zoomRange) {
      return null;
    }
    const startLabel =
      getRelativeTimeBySampleIndex(zoomRange.startSampleIndex) ??
      `#${zoomRange.startSampleIndex}`;
    const endLabel =
      getRelativeTimeBySampleIndex(zoomRange.endSampleIndex) ?? `#${zoomRange.endSampleIndex}`;
    return `${startLabel} – ${endLabel}`;
  }, [zoomRange, storagePoints]);

  if (!summary) {
    return (
      <div className="panel">
        <div className="panel-body">
          <p style={{ margin: 0, color: 'var(--monitor-grey)' }}>
            No disk telemetry samples are available in this dataset. Ensure the collector has node
            stats access or upload a snapshot containing disk metrics.
          </p>
        </div>
      </div>
    );
  }

  const { latest } = summary;
  const isMultiDisk = summary.hasDedicatedGalaxyDisk || summary.hasPostgresDisk;
  const imageSharePct =
    latest.capacityGiB > 0 ? (latest.imageUsedGiB / latest.capacityGiB) * 100 : 0;
  const peakImageSharePct =
    latest.capacityGiB > 0 ? (summary.peakImageGiB / latest.capacityGiB) * 100 : 0;

  const latestEpisode =
    pressureEpisodes.length > 0 ? pressureEpisodes[pressureEpisodes.length - 1] : null;

  const isBannerDismissed =
    dismissedUpToTimestamp !== null &&
    latestEpisode !== null &&
    new Date(latestEpisode.endTimestamp).getTime() <=
      new Date(dismissedUpToTimestamp).getTime();

  const toggleWarningBanner = () => {
    if (!latestEpisode) {
      return;
    }
    if (isBannerDismissed) {
      setDismissedUpToTimestamp(null);
    } else {
      setDismissedUpToTimestamp(latestEpisode.endTimestamp);
    }
  };

  const warningToggleTitle = isBannerDismissed
    ? 'Show low-disk warning summary box below cards'
    : 'Hide low-disk warning summary box below cards';

  const galaxyDiskMeterTooltip = [
    `Current Galaxy Data used (solid): ${formatCompactGiB(latest.galaxyPvcUsedGiB)} of ${formatIntGiB(latest.galaxyPvcCapacityGiB)} (${latest.galaxyPvcUsedPct.toFixed(1)}%) — ${formatCompactGiB(latest.galaxyPvcAvailableGiB)} free`,
    `Peak Galaxy Data used (shaded): ${formatCompactGiB(summary.peakGalaxyUsedGiB)} of ${formatIntGiB(latest.galaxyPvcCapacityGiB)} (${summary.peakGalaxyUsedPct.toFixed(1)}% at ${formatShortTime(summary.peakGalaxyTimestamp)}) — lowest free: ${formatCompactGiB(summary.minGalaxyAvailableGiB)}`,
    '• Dedicated Galaxy storage (/mnt/block_storage): user datasets, job working directories, uploads, and CVMFS cache'
  ].join('\n');

  const systemDiskMeterTooltip = [
    `Current system disk used (solid): ${formatCompactGiB(latest.usedGiB)} of ${formatIntGiB(latest.capacityGiB)} (${latest.usedPct.toFixed(1)}%) — ${formatCompactGiB(latest.availableGiB)} free (${formatCompactGiB(latest.imageUsedGiB)} in container images)`,
    `Peak system disk used (shaded): ${formatCompactGiB(summary.peakUsedGiB)} of ${formatIntGiB(latest.capacityGiB)} (${summary.peakUsedPct.toFixed(1)}% at ${formatShortTime(summary.peakTimestamp)}) — lowest free: ${formatCompactGiB(summary.minAvailableGiB)}`,
    `• Amber vertical mark (85% / ${formatIntGiB(latest.gcThresholdGiB)}): Auto-cleanup threshold — unused container images are automatically removed above this level`,
    `• Dark vertical mark (90% / ${formatIntGiB(latest.evictionThresholdGiB)}): Disk pressure limit — running jobs may be stopped above this level to free disk space`
  ].join('\n');

  const postgresDiskMeterTooltip = [
    `Current Postgres DB used (solid): ${formatGiB(latest.postgresUsedGiB)} of ${formatIntGiB(latest.postgresCapacityGiB)} (${latest.postgresUsedPct.toFixed(1)}%) — ${formatGiB(latest.postgresAvailableGiB)} free`,
    `Peak Postgres DB used (shaded): ${formatGiB(summary.peakPostgresUsedGiB)} of ${formatIntGiB(latest.postgresCapacityGiB)} (${summary.peakPostgresUsedPct.toFixed(1)}% at ${formatShortTime(summary.peakPostgresTimestamp)}) — lowest free: ${formatGiB(summary.minPostgresAvailableGiB)}`,
    '• Dedicated database storage (/mnt/postgres_storage): Galaxy & Rainstone PostgreSQL databases'
  ].join('\n');

  const currentDiskMeterTooltip = [
    `Current disk used: ${formatIntGiB(latest.usedGiB)} of ${formatIntGiB(latest.capacityGiB)} (${latest.usedPct.toFixed(1)}%) — ${formatIntGiB(latest.availableGiB)} free`,
    `• Amber vertical mark (85% / ${formatIntGiB(latest.gcThresholdGiB)}): Auto-cleanup threshold — unused container images are automatically removed above this level`,
    `• Dark vertical mark (90% / ${formatIntGiB(latest.evictionThresholdGiB)}): Disk pressure limit — running jobs may be stopped above this level to free disk space`
  ].join('\n');

  const peakDiskMeterTooltip = [
    `Peak disk used: ${formatIntGiB(summary.peakUsedGiB)} of ${formatIntGiB(latest.capacityGiB)} (${summary.peakUsedPct.toFixed(1)}% at ${formatShortTime(summary.peakTimestamp)}) — lowest free: ${formatIntGiB(summary.minAvailableGiB)}`,
    `• Amber vertical mark (85% / ${formatIntGiB(latest.gcThresholdGiB)}): Auto-cleanup threshold — unused container images are automatically removed above this level`,
    `• Dark vertical mark (90% / ${formatIntGiB(latest.evictionThresholdGiB)}): Disk pressure limit — running jobs may be stopped above this level to free disk space`
  ].join('\n');

  const imagesMeterTooltip = [
    `Current container images (solid): ${formatIntGiB(latest.imageUsedGiB)} of ${formatIntGiB(latest.capacityGiB)} (${imageSharePct.toFixed(1)}% of disk)`,
    `Peak container images (shaded): ${formatIntGiB(summary.peakImageGiB)} of ${formatIntGiB(latest.capacityGiB)} (${peakImageSharePct.toFixed(1)}% of disk)`
  ].join('\n');

  const ioWaitMeterTooltip = [
    `5m avg disk I/O wait (solid): ${summary.recentPsiSomePct.toFixed(1)}% (latest sample: ${latest.ioPsiSomePct.toFixed(1)}%)`,
    `Peak disk I/O wait (shaded): ${summary.peakPsiSomePct.toFixed(1)}%`,
    '• Amber vertical mark (10%): Elevated I/O threshold — tasks spend 10%+ of time waiting on disk reads/writes',
    '• Dark vertical mark (25%): High I/O wait threshold — tasks spend 25%+ of time blocked on disk I/O'
  ].join('\n');

  const zoomToEpisode = (episode: PressureEpisode) => {
    const maxIdx = Math.max(0, storagePoints.length - 1);
    setZoomRange({
      startSampleIndex: Math.max(0, episode.startSampleIndex - 2),
      endSampleIndex: Math.min(maxIdx, episode.endSampleIndex + 2)
    });
  };

  const handleChartMouseDown = (state: {
    activePayload?: Array<{ payload?: StoragePoint }>;
  }) => {
    const sampleIndex = getSampleIndexFromState(state);
    if (sampleIndex === null) return;
    setDragStartSampleIndex(sampleIndex);
    setDragEndSampleIndex(sampleIndex);
  };

  const handleChartMouseMove = (state: {
    activePayload?: Array<{ payload?: StoragePoint }>;
  }) => {
    if (dragStartSampleIndex === null) return;
    const sampleIndex = getSampleIndexFromState(state);
    if (sampleIndex === null) return;
    setDragEndSampleIndex(sampleIndex);
  };

  const handleChartMouseUp = (state: {
    activePayload?: Array<{ payload?: StoragePoint }>;
  }) => {
    if (dragStartSampleIndex === null) return;
    const fallback = getSampleIndexFromState(state);
    const end = dragEndSampleIndex ?? fallback;
    if (end !== null && end !== dragStartSampleIndex) {
      setZoomRange({
        startSampleIndex: Math.min(dragStartSampleIndex, end),
        endSampleIndex: Math.max(dragStartSampleIndex, end)
      });
      suppressNextClickRef.current = true;
    }
    setDragStartSampleIndex(null);
    setDragEndSampleIndex(null);
  };

  const resetZoom = () => {
    setZoomRange(null);
    setDragStartSampleIndex(null);
    setDragEndSampleIndex(null);
  };

  return (
    <div data-print-content className="dashboard-stack">
      <div className="print-summary-header">
        <div className="print-summary-title">
          Galaxy K8s Monitor — Storage &amp; Disk Pressure Report
        </div>
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
            Samples: <strong>{storagePoints.length.toLocaleString()}</strong>
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

      <section className="stats-section" aria-label="Storage utilization summary">
        <div className="stats-header-bar">
          {isMultiDisk ? (
            <span>
              Storage capacities:{' '}
              {summary.hasDedicatedGalaxyDisk && (
                <>
                  Galaxy Data <strong>{formatIntGiB(latest.galaxyPvcCapacityGiB)}</strong> ·{' '}
                </>
              )}
              System &amp; Images <strong>{formatIntGiB(latest.capacityGiB)}</strong> (markers at{' '}
              <strong>85%</strong> auto-cleanup / <strong>90%</strong> limit)
              {summary.hasPostgresDisk && (
                <>
                  {' '}
                  · Postgres DB <strong>{formatIntGiB(latest.postgresCapacityGiB)}</strong>
                </>
              )}
            </span>
          ) : (
            <span>
              Node disk capacity: <strong>{formatIntGiB(latest.capacityGiB)}</strong> (markers at{' '}
              <strong>85%</strong> auto-cleanup of unused images and <strong>90%</strong> disk
              pressure limit)
            </span>
          )}
          <span className="badge-scope">
            {summary.hasDedicatedGalaxyDisk && summary.hasPostgresDisk
              ? '3-Disk Setup (Galaxy Data · System · Postgres)'
              : summary.hasDedicatedGalaxyDisk
              ? '2-Disk Setup (Galaxy Data · System)'
              : 'Shared System & Galaxy Disk'}
          </span>
        </div>

        <div className="stats-grid">
          {isMultiDisk ? (
            <>
              {/* Card 1: Galaxy Data Disk */}
              <div className="stat-card">
                <div className="stat-card-header">
                  <span className="stat-label">Galaxy Data Disk</span>
                  <span className="stat-pct">{latest.galaxyPvcUsedPct.toFixed(1)}%</span>
                </div>
                <div className="stat-value">
                  {formatCompactGiB(latest.galaxyPvcUsedGiB)} /{' '}
                  {formatIntGiB(latest.galaxyPvcCapacityGiB)}
                </div>
                <div
                  className="stat-meter-wrapper"
                  tabIndex={0}
                  aria-label={galaxyDiskMeterTooltip}
                >
                  <div className="stat-meter" role="img" aria-label={galaxyDiskMeterTooltip}>
                    {summary.peakGalaxyUsedPct > 0 && (
                      <div
                        className="stat-meter-peak-fill"
                        style={{
                          width: `${Math.min(100, summary.peakGalaxyUsedPct)}%`,
                          background: 'rgba(90, 169, 164, 0.25)',
                          borderRightColor: 'rgba(90, 169, 164, 0.7)'
                        }}
                      />
                    )}
                    <div
                      className="stat-meter-fill"
                      style={{
                        width: `${Math.min(100, latest.galaxyPvcUsedPct)}%`,
                        background: DISK_DATA_COLOR
                      }}
                    />
                  </div>
                  <div className="stat-meter-tooltip" role="tooltip">
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-swatch"
                        style={{ background: DISK_DATA_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>Current used (solid):</strong>{' '}
                        {formatCompactGiB(latest.galaxyPvcUsedGiB)} of{' '}
                        {formatIntGiB(latest.galaxyPvcCapacityGiB)} (
                        {latest.galaxyPvcUsedPct.toFixed(1)}%) —{' '}
                        {formatCompactGiB(latest.galaxyPvcAvailableGiB)} free
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-swatch"
                        style={{
                          background: 'rgba(90, 169, 164, 0.28)',
                          border: '1px solid rgba(90, 169, 164, 0.7)'
                        }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>Peak used (shaded):</strong>{' '}
                        {formatCompactGiB(summary.peakGalaxyUsedGiB)} of{' '}
                        {formatIntGiB(latest.galaxyPvcCapacityGiB)} (
                        {summary.peakGalaxyUsedPct.toFixed(1)}% at{' '}
                        {formatShortTime(summary.peakGalaxyTimestamp)}) — lowest free:{' '}
                        {formatCompactGiB(summary.minGalaxyAvailableGiB)}
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span>
                        <strong>Mount (/mnt/block_storage):</strong> User datasets, job working
                        directories, uploads &amp; CVMFS cache
                      </span>
                    </div>
                  </div>
                </div>
                <div className="stat-secondary">
                  <span>
                    Free: <strong>{formatCompactGiB(latest.galaxyPvcAvailableGiB)}</strong>
                  </span>
                  <span>
                    Peak: <strong>{summary.peakGalaxyUsedPct.toFixed(1)}%</strong>
                  </span>
                </div>
              </div>

              {/* Card 2: System & Images Disk */}
              <div className="stat-card">
                <div className="stat-card-header">
                  <span className="stat-label">System &amp; Images Disk</span>
                  <span className="stat-pct">{latest.usedPct.toFixed(1)}%</span>
                </div>
                <div className="stat-value">
                  {formatCompactGiB(latest.usedGiB)} / {formatIntGiB(latest.capacityGiB)}
                </div>
                <div
                  className="stat-meter-wrapper"
                  tabIndex={0}
                  aria-label={systemDiskMeterTooltip}
                >
                  <div className="stat-meter" role="img" aria-label={systemDiskMeterTooltip}>
                    {summary.peakUsedPct > 0 && (
                      <div
                        className="stat-meter-peak-fill"
                        style={{
                          width: `${Math.min(100, summary.peakUsedPct)}%`,
                          background: 'rgba(123, 167, 204, 0.25)',
                          borderRightColor: 'rgba(123, 167, 204, 0.7)'
                        }}
                      />
                    )}
                    <div
                      className="stat-meter-fill"
                      style={{
                        width: `${Math.min(100, latest.usedPct)}%`,
                        background: DISK_IMAGES_COLOR
                      }}
                    />
                    <div
                      className="stat-meter-marker"
                      style={{ left: 'calc(85% - 1.5px)', background: DISK_GC_LINE_COLOR }}
                    />
                    <div
                      className="stat-meter-marker"
                      style={{ left: 'calc(90% - 1.5px)' }}
                    />
                  </div>
                  <div className="stat-meter-tooltip" role="tooltip">
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-swatch"
                        style={{ background: DISK_IMAGES_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>Current used (solid):</strong> {formatCompactGiB(latest.usedGiB)}{' '}
                        of {formatIntGiB(latest.capacityGiB)} ({latest.usedPct.toFixed(1)}%) —{' '}
                        {formatCompactGiB(latest.availableGiB)} free (
                        {formatCompactGiB(latest.imageUsedGiB)} in container images)
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-swatch"
                        style={{
                          background: 'rgba(123, 167, 204, 0.28)',
                          border: '1px solid rgba(123, 167, 204, 0.7)'
                        }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>Peak used (shaded):</strong>{' '}
                        {formatCompactGiB(summary.peakUsedGiB)} of{' '}
                        {formatIntGiB(latest.capacityGiB)} ({summary.peakUsedPct.toFixed(1)}% at{' '}
                        {formatShortTime(summary.peakTimestamp)}) — lowest free:{' '}
                        {formatCompactGiB(summary.minAvailableGiB)}
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-mark"
                        style={{ background: DISK_GC_LINE_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>85% mark ({formatIntGiB(latest.gcThresholdGiB)}):</strong>{' '}
                        Auto-cleanup threshold for unused container images
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-mark"
                        style={{ background: REQUEST_LINE_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>90% mark ({formatIntGiB(latest.evictionThresholdGiB)}):</strong>{' '}
                        Disk pressure threshold where running jobs may be stopped
                      </span>
                    </div>
                  </div>
                </div>
                <div className="stat-secondary">
                  <span>
                    Free: <strong>{formatCompactGiB(latest.availableGiB)}</strong>
                  </span>
                  {pressureEpisodes.length > 0 && latestEpisode ? (
                    <button
                      type="button"
                      className="btn-warning-link"
                      data-resolved={!latest.diskPressure ? 'true' : 'false'}
                      data-active={!isBannerDismissed ? 'true' : 'false'}
                      aria-expanded={!isBannerDismissed}
                      title={warningToggleTitle}
                      onClick={toggleWarningBanner}
                    >
                      <span>
                        {pressureEpisodes.length}{' '}
                        {pressureEpisodes.length === 1 ? 'episode' : 'episodes'}
                      </span>
                      <ChevronDown
                        size={13}
                        className="btn-warning-chevron"
                        aria-hidden="true"
                      />
                    </button>
                  ) : latest.usedPct >= 85 ? (
                    <span style={{ color: DISK_GC_LINE_COLOR, fontWeight: 700 }}>
                      Over 85%
                    </span>
                  ) : (
                    <span>
                      Peak: <strong>{summary.peakUsedPct.toFixed(1)}%</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Card 3: Postgres DB Disk (or Container Images if 2-disk) */}
              {summary.hasPostgresDisk ? (
                <div className="stat-card">
                  <div className="stat-card-header">
                    <span className="stat-label">Postgres DB Disk</span>
                    <span className="stat-pct">{latest.postgresUsedPct.toFixed(1)}%</span>
                  </div>
                  <div className="stat-value">
                    {formatCompactGiB(latest.postgresUsedGiB)} /{' '}
                    {formatIntGiB(latest.postgresCapacityGiB)}
                  </div>
                  <div
                    className="stat-meter-wrapper"
                    tabIndex={0}
                    aria-label={postgresDiskMeterTooltip}
                  >
                    <div className="stat-meter" role="img" aria-label={postgresDiskMeterTooltip}>
                      {summary.peakPostgresUsedPct > 0 && (
                        <div
                          className="stat-meter-peak-fill"
                          style={{
                            width: `${Math.min(100, summary.peakPostgresUsedPct)}%`,
                            background: 'rgba(162, 155, 254, 0.25)',
                            borderRightColor: 'rgba(162, 155, 254, 0.7)'
                          }}
                        />
                      )}
                      <div
                        className="stat-meter-fill"
                        style={{
                          width: `${Math.min(100, latest.postgresUsedPct)}%`,
                          background: DISK_POSTGRES_COLOR
                        }}
                      />
                    </div>
                    <div className="stat-meter-tooltip" role="tooltip">
                      <div className="stat-meter-tooltip-row">
                        <span
                          className="stat-meter-tooltip-swatch"
                          style={{ background: DISK_POSTGRES_COLOR }}
                          aria-hidden="true"
                        />
                        <span>
                          <strong>Current used (solid):</strong>{' '}
                          {formatGiB(latest.postgresUsedGiB)} of{' '}
                          {formatIntGiB(latest.postgresCapacityGiB)} (
                          {latest.postgresUsedPct.toFixed(1)}%) —{' '}
                          {formatGiB(latest.postgresAvailableGiB)} free
                        </span>
                      </div>
                      <div className="stat-meter-tooltip-row">
                        <span
                          className="stat-meter-tooltip-swatch"
                          style={{
                            background: 'rgba(162, 155, 254, 0.28)',
                            border: '1px solid rgba(162, 155, 254, 0.7)'
                          }}
                          aria-hidden="true"
                        />
                        <span>
                          <strong>Peak used (shaded):</strong>{' '}
                          {formatGiB(summary.peakPostgresUsedGiB)} of{' '}
                          {formatIntGiB(latest.postgresCapacityGiB)} (
                          {summary.peakPostgresUsedPct.toFixed(1)}% at{' '}
                          {formatShortTime(summary.peakPostgresTimestamp)}) — lowest free:{' '}
                          {formatGiB(summary.minPostgresAvailableGiB)}
                        </span>
                      </div>
                      <div className="stat-meter-tooltip-row">
                        <span>
                          <strong>Mount (/mnt/postgres_storage):</strong> Galaxy &amp; Rainstone
                          PostgreSQL databases
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="stat-secondary">
                    <span>
                      Free: <strong>{formatCompactGiB(latest.postgresAvailableGiB)}</strong>
                    </span>
                    <span>
                      Peak: <strong>{summary.peakPostgresUsedPct.toFixed(1)}%</strong>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="stat-card">
                  <div className="stat-card-header">
                    <span className="stat-label">Container Images</span>
                    <span className="stat-pct">{imageSharePct.toFixed(1)}%</span>
                  </div>
                  <div className="stat-value">
                    {formatIntGiB(latest.imageUsedGiB)} / {formatIntGiB(latest.capacityGiB)}
                  </div>
                  <div className="stat-meter-wrapper" tabIndex={0} aria-label={imagesMeterTooltip}>
                    <div className="stat-meter" role="img" aria-label={imagesMeterTooltip}>
                      {peakImageSharePct > 0 && (
                        <div
                          className="stat-meter-peak-fill"
                          style={{
                            width: `${Math.min(100, peakImageSharePct)}%`,
                            background: 'rgba(124, 58, 237, 0.25)',
                            borderRightColor: 'rgba(124, 58, 237, 0.65)'
                          }}
                        />
                      )}
                      <div
                        className="stat-meter-fill"
                        style={{
                          width: `${Math.min(100, imageSharePct)}%`,
                          background: DISK_IMAGES_COLOR
                        }}
                      />
                    </div>
                    <div className="stat-meter-tooltip" role="tooltip">
                      <div className="stat-meter-tooltip-row">
                        <span
                          className="stat-meter-tooltip-swatch"
                          style={{ background: DISK_IMAGES_COLOR }}
                          aria-hidden="true"
                        />
                        <span>
                          <strong>Current images (solid):</strong>{' '}
                          {formatIntGiB(latest.imageUsedGiB)} of {formatIntGiB(latest.capacityGiB)}{' '}
                          ({imageSharePct.toFixed(1)}% of system disk)
                        </span>
                      </div>
                      <div className="stat-meter-tooltip-row">
                        <span
                          className="stat-meter-tooltip-swatch"
                          style={{
                            background: 'rgba(124, 58, 237, 0.28)',
                            border: '1px solid rgba(124, 58, 237, 0.65)'
                          }}
                          aria-hidden="true"
                        />
                        <span>
                          <strong>Peak images (shaded):</strong>{' '}
                          {formatIntGiB(summary.peakImageGiB)} of{' '}
                          {formatIntGiB(latest.capacityGiB)} ({peakImageSharePct.toFixed(1)}% of
                          system disk)
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="stat-secondary">
                    <span>
                      Peak images: <strong>{formatIntGiB(summary.peakImageGiB)}</strong> (
                      {peakImageSharePct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Single-Disk Mode Card 1: Current Disk */}
              <div className="stat-card">
                <div className="stat-card-header">
                  <span className="stat-label">Current Disk</span>
                  <span className="stat-pct">{latest.usedPct.toFixed(1)}%</span>
                </div>
                <div className="stat-value">
                  {formatIntGiB(latest.usedGiB)} / {formatIntGiB(latest.capacityGiB)}
                </div>
                <div
                  className="stat-meter-wrapper"
                  tabIndex={0}
                  aria-label={currentDiskMeterTooltip}
                >
                  <div className="stat-meter" role="img" aria-label={currentDiskMeterTooltip}>
                    <div
                      className="stat-meter-fill"
                      style={{
                        width: `${Math.min(100, latest.usedPct)}%`,
                        background: DISK_DATA_COLOR
                      }}
                    />
                    <div
                      className="stat-meter-marker"
                      style={{ left: 'calc(85% - 1.5px)', background: DISK_GC_LINE_COLOR }}
                    />
                    <div
                      className="stat-meter-marker"
                      style={{ left: 'calc(90% - 1.5px)' }}
                    />
                  </div>
                  <div className="stat-meter-tooltip" role="tooltip">
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-swatch"
                        style={{ background: DISK_DATA_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>Current used:</strong> {formatIntGiB(latest.usedGiB)} of{' '}
                        {formatIntGiB(latest.capacityGiB)} ({latest.usedPct.toFixed(1)}%) —{' '}
                        {formatIntGiB(latest.availableGiB)} free
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-mark"
                        style={{ background: DISK_GC_LINE_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>85% mark ({formatIntGiB(latest.gcThresholdGiB)}):</strong>{' '}
                        Auto-cleanup threshold for unused container images
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-mark"
                        style={{ background: REQUEST_LINE_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>90% mark ({formatIntGiB(latest.evictionThresholdGiB)}):</strong>{' '}
                        Disk pressure threshold where running jobs may be stopped
                      </span>
                    </div>
                  </div>
                </div>
                <div className="stat-secondary">
                  <span>
                    Free: <strong>{formatIntGiB(latest.availableGiB)}</strong>
                  </span>
                  {latest.usedPct >= 90 ? (
                    latestEpisode ? (
                      <button
                        type="button"
                        className="btn-warning-link"
                        data-resolved="false"
                        data-active={!isBannerDismissed ? 'true' : 'false'}
                        aria-expanded={!isBannerDismissed}
                        title={warningToggleTitle}
                        onClick={toggleWarningBanner}
                      >
                        <span>Over 90% limit</span>
                        <ChevronDown
                          size={13}
                          className="btn-warning-chevron"
                          aria-hidden="true"
                        />
                      </button>
                    ) : (
                      <span className="text-overdraw">Over 90% limit</span>
                    )
                  ) : latest.usedPct >= 85 ? (
                    <span style={{ color: DISK_GC_LINE_COLOR, fontWeight: 700 }}>
                      Over 85% auto-cleanup
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Single-Disk Mode Card 2: Peak Disk */}
              <div className="stat-card">
                <div className="stat-card-header">
                  <span className="stat-label">Peak Disk</span>
                  <span className="stat-pct">
                    {summary.peakUsedPct.toFixed(1)}%{' '}
                    <span className="stat-pct-sub">
                      at {formatShortTime(summary.peakTimestamp)}
                    </span>
                  </span>
                </div>
                <div className="stat-value">
                  {formatIntGiB(summary.peakUsedGiB)} / {formatIntGiB(latest.capacityGiB)}
                </div>
                <div
                  className="stat-meter-wrapper"
                  tabIndex={0}
                  aria-label={peakDiskMeterTooltip}
                >
                  <div className="stat-meter" role="img" aria-label={peakDiskMeterTooltip}>
                    <div
                      className="stat-meter-fill"
                      style={{
                        width: `${Math.min(100, summary.peakUsedPct)}%`,
                        background: DISK_AVAILABLE_COLOR
                      }}
                    />
                    <div
                      className="stat-meter-marker"
                      style={{ left: 'calc(85% - 1.5px)', background: DISK_GC_LINE_COLOR }}
                    />
                    <div
                      className="stat-meter-marker"
                      style={{ left: 'calc(90% - 1.5px)' }}
                    />
                  </div>
                  <div className="stat-meter-tooltip" role="tooltip">
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-swatch"
                        style={{ background: DISK_AVAILABLE_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>Peak used:</strong> {formatIntGiB(summary.peakUsedGiB)} of{' '}
                        {formatIntGiB(latest.capacityGiB)} ({summary.peakUsedPct.toFixed(1)}% at{' '}
                        {formatShortTime(summary.peakTimestamp)}) — lowest free:{' '}
                        {formatIntGiB(summary.minAvailableGiB)}
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-mark"
                        style={{ background: DISK_GC_LINE_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>85% mark ({formatIntGiB(latest.gcThresholdGiB)}):</strong>{' '}
                        Auto-cleanup threshold for unused container images
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-mark"
                        style={{ background: REQUEST_LINE_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>90% mark ({formatIntGiB(latest.evictionThresholdGiB)}):</strong>{' '}
                        Disk pressure threshold where running jobs may be stopped
                      </span>
                    </div>
                  </div>
                </div>
                <div className="stat-secondary">
                  <span>
                    Lowest free: <strong>{formatIntGiB(summary.minAvailableGiB)}</strong>
                  </span>
                  {pressureEpisodes.length > 0 && latestEpisode ? (
                    <button
                      type="button"
                      className="btn-warning-link"
                      data-resolved={!latest.diskPressure ? 'true' : 'false'}
                      data-active={!isBannerDismissed ? 'true' : 'false'}
                      aria-expanded={!isBannerDismissed}
                      title={warningToggleTitle}
                      onClick={toggleWarningBanner}
                    >
                      <span>
                        {pressureEpisodes.length}{' '}
                        {pressureEpisodes.length === 1 ? 'episode' : 'episodes'}
                      </span>
                      <ChevronDown
                        size={13}
                        className="btn-warning-chevron"
                        aria-hidden="true"
                      />
                    </button>
                  ) : summary.peakUsedPct >= 90 ? (
                    <span className="text-overdraw">&gt;90% limit</span>
                  ) : null}
                </div>
              </div>

              {/* Single-Disk Mode Card 3: Container Images */}
              <div className="stat-card">
                <div className="stat-card-header">
                  <span className="stat-label">Container Images</span>
                  <span className="stat-pct">{imageSharePct.toFixed(1)}%</span>
                </div>
                <div className="stat-value">
                  {formatIntGiB(latest.imageUsedGiB)} / {formatIntGiB(latest.capacityGiB)}
                </div>
                <div className="stat-meter-wrapper" tabIndex={0} aria-label={imagesMeterTooltip}>
                  <div className="stat-meter" role="img" aria-label={imagesMeterTooltip}>
                    {peakImageSharePct > 0 && (
                      <div
                        className="stat-meter-peak-fill"
                        style={{
                          width: `${Math.min(100, peakImageSharePct)}%`,
                          background: 'rgba(124, 58, 237, 0.25)',
                          borderRightColor: 'rgba(124, 58, 237, 0.65)'
                        }}
                      />
                    )}
                    <div
                      className="stat-meter-fill"
                      style={{
                        width: `${Math.min(100, imageSharePct)}%`,
                        background: DISK_IMAGES_COLOR
                      }}
                    />
                  </div>
                  <div className="stat-meter-tooltip" role="tooltip">
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-swatch"
                        style={{ background: DISK_IMAGES_COLOR }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>Current images (solid):</strong>{' '}
                        {formatIntGiB(latest.imageUsedGiB)} of {formatIntGiB(latest.capacityGiB)} (
                        {imageSharePct.toFixed(1)}% of disk)
                      </span>
                    </div>
                    <div className="stat-meter-tooltip-row">
                      <span
                        className="stat-meter-tooltip-swatch"
                        style={{
                          background: 'rgba(124, 58, 237, 0.28)',
                          border: '1px solid rgba(124, 58, 237, 0.65)'
                        }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>Peak images (shaded):</strong>{' '}
                        {formatIntGiB(summary.peakImageGiB)} of {formatIntGiB(latest.capacityGiB)}{' '}
                        ({peakImageSharePct.toFixed(1)}% of disk)
                      </span>
                    </div>
                  </div>
                </div>
                <div className="stat-secondary">
                  <span>
                    Peak images: <strong>{formatIntGiB(summary.peakImageGiB)}</strong> (
                    {peakImageSharePct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Card 4: Disk I/O Wait */}
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Disk I/O Wait</span>
              <span className="stat-pct" title="5-minute average partial I/O wait">
                {summary.recentPsiSomePct.toFixed(1)}%
              </span>
            </div>
            <div className="stat-value">
              {latest.diskPressure ? (
                <span className="text-overdraw">Disk Pressure</span>
              ) : summary.recentPsiSomePct >= 25 || summary.recentPsiFullPct >= 10 ? (
                <span className="text-overdraw">High I/O Wait</span>
              ) : summary.recentPsiSomePct >= 10 ? (
                <span style={{ color: DISK_GC_LINE_COLOR }}>Elevated I/O</span>
              ) : (
                'Healthy'
              )}
            </div>
            <div className="stat-meter-wrapper" tabIndex={0} aria-label={ioWaitMeterTooltip}>
              <div className="stat-meter" role="img" aria-label={ioWaitMeterTooltip}>
                {summary.peakPsiSomePct > 0 && (
                  <div
                    className="stat-meter-peak-fill"
                    style={{
                      width: `${Math.min(100, summary.peakPsiSomePct)}%`
                    }}
                  />
                )}
                <div
                  className="stat-meter-fill"
                  style={{
                    width: `${Math.min(100, summary.recentPsiSomePct)}%`,
                    background:
                      summary.recentPsiSomePct >= 25 || summary.recentPsiFullPct >= 10
                        ? OVERDRAW_COLOR
                        : DISK_PSI_SOME_COLOR
                  }}
                />
                <div
                  className="stat-meter-marker"
                  style={{ left: 'calc(10% - 1.5px)', background: DISK_GC_LINE_COLOR }}
                />
                <div
                  className="stat-meter-marker"
                  style={{ left: 'calc(25% - 1.5px)' }}
                />
              </div>
              <div className="stat-meter-tooltip" role="tooltip">
                <div className="stat-meter-tooltip-row">
                  <span
                    className="stat-meter-tooltip-swatch"
                    style={{
                      background:
                        summary.recentPsiSomePct >= 25 || summary.recentPsiFullPct >= 10
                          ? OVERDRAW_COLOR
                          : DISK_PSI_SOME_COLOR
                    }}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>5m avg I/O wait (solid):</strong>{' '}
                    {summary.recentPsiSomePct.toFixed(1)}% (latest sample:{' '}
                    {latest.ioPsiSomePct.toFixed(1)}%)
                  </span>
                </div>
                <div className="stat-meter-tooltip-row">
                  <span
                    className="stat-meter-tooltip-swatch"
                    style={{
                      background: 'rgba(217, 119, 6, 0.28)',
                      border: '1px solid rgba(217, 119, 6, 0.7)'
                    }}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>Peak I/O wait (shaded):</strong>{' '}
                    {summary.peakPsiSomePct.toFixed(1)}%
                  </span>
                </div>
                <div className="stat-meter-tooltip-row">
                  <span
                    className="stat-meter-tooltip-mark"
                    style={{ background: DISK_GC_LINE_COLOR }}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>10% mark:</strong> Elevated I/O threshold (noticeable disk contention)
                  </span>
                </div>
                <div className="stat-meter-tooltip-row">
                  <span
                    className="stat-meter-tooltip-mark"
                    style={{ background: REQUEST_LINE_COLOR }}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>25% mark:</strong> High I/O wait threshold (heavy disk bottleneck)
                  </span>
                </div>
              </div>
            </div>
            <div className="stat-secondary">
              <span>5m avg</span>
              <span>
                Peak: <strong>{summary.peakPsiSomePct.toFixed(1)}%</strong>
              </span>
            </div>
          </div>
        </div>

        {latestEpisode && (
          <div
            className="stats-drawer-collapse"
            data-open={!isBannerDismissed ? 'true' : 'false'}
            aria-hidden={isBannerDismissed}
          >
            <div className="stats-drawer-inner">
              <div
                className="status-banner status-banner-drawer"
                data-variant={latest.diskPressure ? 'error' : 'warning'}
                role="status"
              >
                <div className="status-banner-content">
                  <div>
                    <strong>
                      {latest.diskPressure
                        ? pressureEpisodes.length > 1
                          ? `Low disk space warning is currently active (${pressureEpisodes.length} episodes in this timeframe)`
                          : 'Low disk space warning is currently active'
                        : pressureEpisodes.length > 1
                        ? `${pressureEpisodes.length} past low-disk warning episodes in this timeframe (resolved)`
                        : '1 past low-disk warning episode in this timeframe (resolved)'}
                    </strong>{' '}
                    —{' '}
                    {pressureEpisodes.length === 1 ? (
                      <>
                        Occurred at <strong>{formatClockTime(latestEpisode.startTimestamp)}</strong> (
                        {latestEpisode.startLabel}–{latestEpisode.endLabel}, duration{' '}
                        <strong>{formatDuration(latestEpisode.durationSeconds)}</strong>, peak usage{' '}
                        <strong>{latestEpisode.peakUsedPct.toFixed(1)}%</strong>, lowest free space{' '}
                        <strong>{formatGiB(latestEpisode.minAvailableGiB)}</strong>).
                      </>
                    ) : (
                      <>
                        Most recent at{' '}
                        <strong>{formatClockTime(latestEpisode.startTimestamp)}</strong> (peak usage
                        across episodes reached <strong>{summary.peakUsedPct.toFixed(1)}%</strong>,
                        lowest free space <strong>{formatGiB(summary.minAvailableGiB)}</strong>).
                      </>
                    )}{' '}
                    When disk usage crosses 85–90%, the system automatically removes unused
                    container images and may stop running jobs to reclaim space.
                  </div>
                </div>

                <div className="status-banner-actions" data-no-print>
                  {pressureEpisodes.length === 1 ? (
                    <button
                      type="button"
                      className="btn-compact"
                      tabIndex={isBannerDismissed ? -1 : 0}
                      onClick={() => zoomToEpisode(latestEpisode)}
                    >
                      Zoom to episode
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-compact"
                      tabIndex={isBannerDismissed ? -1 : 0}
                      aria-expanded={episodesExpanded}
                      onClick={() => setEpisodesExpanded(prev => !prev)}
                    >
                      <span className="btn-episodes-toggle-stack">
                        <span
                          data-visible={!episodesExpanded ? 'true' : 'false'}
                          aria-hidden={episodesExpanded}
                        >
                          Show episodes ({pressureEpisodes.length})
                        </span>
                        <span
                          data-visible={episodesExpanded ? 'true' : 'false'}
                          aria-hidden={!episodesExpanded}
                        >
                          Hide episodes
                        </span>
                      </span>
                    </button>
                  )}
                </div>

                {episodesExpanded && pressureEpisodes.length > 0 && (
                  <div className="status-banner-episodes" data-no-print>
                    {pressureEpisodes.map(ep => (
                      <button
                        key={ep.episodeNumber}
                        type="button"
                        className="episode-pill"
                        tabIndex={isBannerDismissed ? -1 : 0}
                        title="Click to zoom charts to this episode"
                        onClick={() => zoomToEpisode(ep)}
                      >
                        <strong>#{ep.episodeNumber}</strong>
                        <span>
                          {formatClockTime(ep.startTimestamp)} ({ep.startLabel}–{ep.endLabel},{' '}
                          {formatDuration(ep.durationSeconds)})
                        </span>
                        <span>· Peak {ep.peakUsedPct.toFixed(1)}%</span>
                        <span style={{ color: 'var(--monitor-primary)', fontWeight: 700 }}>
                          Zoom
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Chart Panel 1 (Multi-Disk): Galaxy Data Disk */}
      {summary.hasDedicatedGalaxyDisk && (
        <section
          className="panel"
          aria-label="Galaxy Data Disk — Storage Consumed & Available Over Time"
        >
          <div className="panel-header" data-collapsed={galaxyCollapsed ? 'true' : 'false'}>
            <div className="panel-title-group">
              <h3 className="panel-title">
                Galaxy Data Disk — Storage Consumed &amp; Available Over Time
              </h3>
              <span className="panel-subtitle">
                /mnt/block_storage ({formatIntGiB(latest.galaxyPvcCapacityGiB)}) · Drag across chart
                to zoom
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
                aria-expanded={!galaxyCollapsed}
                aria-controls={galaxyBodyId}
                onClick={() => setGalaxyCollapsed(prev => !prev)}
              >
                {galaxyCollapsed ? 'Expand' : 'Collapse'}
              </button>
            </div>
          </div>

          {!galaxyCollapsed && (
            <div id={galaxyBodyId}>
              <div className="panel-body">
                <p className="panel-description">
                  Shows disk space used on the primary Galaxy data disk (user datasets, histories,
                  job working directories, tusd uploads, and CVMFS cache) alongside remaining free
                  space.
                </p>

                <div className="chart-key" style={{ marginBottom: '0.65rem' }}>
                  <span className="chart-key-item">
                    <span
                      className="color-swatch"
                      style={{ background: DISK_DATA_COLOR }}
                      aria-hidden="true"
                    />
                    <span>Galaxy Data Used (GiB)</span>
                  </span>
                  <span className="chart-key-item">
                    <span
                      className="key-line-dashed"
                      style={{ borderTopColor: DISK_AVAILABLE_COLOR }}
                      aria-hidden="true"
                    />
                    <span>Available Free Space (GiB)</span>
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
                      />
                      <YAxis
                        domain={[0, Math.ceil(latest.galaxyPvcCapacityGiB)]}
                        stroke={CHART_AXIS_COLOR}
                        tick={{ fill: CHART_AXIS_COLOR, fontSize: 13 }}
                        tickFormatter={(val: number) => `${val} GiB`}
                      />
                      <Tooltip
                        content={<GalaxyDiskTooltip />}
                        offset={24}
                        wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                      />

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
                        dataKey="galaxyPvcUsedGiB"
                        name="Galaxy Data Used (GiB)"
                        stroke={DISK_DATA_COLOR}
                        strokeWidth={1.75}
                        fill={DISK_DATA_COLOR}
                        fillOpacity={0.62}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="galaxyPvcAvailableGiB"
                        name="Available Free Space (GiB)"
                        stroke={DISK_AVAILABLE_COLOR}
                        strokeWidth={2}
                        strokeDasharray="5 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <details className="inline-details" data-no-print>
                <summary>Tabular summary (Galaxy Data Disk)</summary>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Storage Category</th>
                        <th scope="col" className="num">Latest</th>
                        <th scope="col" className="num">Peak</th>
                        <th scope="col" className="num">Share of Capacity</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <strong>Galaxy Data Used</strong>
                        </td>
                        <td className="num">{formatGiB(latest.galaxyPvcUsedGiB)}</td>
                        <td className="num">{formatGiB(summary.peakGalaxyUsedGiB)}</td>
                        <td className="num">{latest.galaxyPvcUsedPct.toFixed(1)}%</td>
                      </tr>
                      <tr>
                        <td>Available Free Space</td>
                        <td className="num">{formatGiB(latest.galaxyPvcAvailableGiB)}</td>
                        <td className="num">
                          {formatGiB(
                            displayedPoints.reduce(
                              (max, pt) => Math.max(max, pt.galaxyPvcAvailableGiB),
                              0
                            )
                          )}
                        </td>
                        <td className="num">
                          {latest.galaxyPvcCapacityGiB > 0
                            ? `${((latest.galaxyPvcAvailableGiB / latest.galaxyPvcCapacityGiB) * 100).toFixed(1)}%`
                            : '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}
        </section>
      )}

      {/* Chart Panel 2: System & Container Images Disk (or Single-Disk Storage Consumed) */}
      <section
        className="panel"
        aria-label={
          isMultiDisk
            ? 'System & Container Images Disk — Storage Consumed & Available Over Time'
            : 'Storage Consumed & Available Over Time'
        }
      >
        <div className="panel-header" data-collapsed={usageCollapsed ? 'true' : 'false'}>
          <div className="panel-title-group">
            <h3 className="panel-title">
              {isMultiDisk
                ? 'System & Container Images Disk — Storage Consumed & Available Over Time'
                : 'Storage Consumed & Available Over Time'}
            </h3>
            <span className="panel-subtitle">
              {isMultiDisk
                ? `/ (${formatIntGiB(latest.capacityGiB)}) · Drag across chart to zoom`
                : 'Drag across chart to zoom'}
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
              aria-expanded={!usageCollapsed}
              aria-controls={usageBodyId}
              onClick={() => setUsageCollapsed(prev => !prev)}
            >
              {usageCollapsed ? 'Expand' : 'Collapse'}
            </button>
          </div>
        </div>

        {!usageCollapsed && (
          <div id={usageBodyId}>
            <div className="panel-body">
              <p className="panel-description">
                {isMultiDisk ? (
                  <>
                    Shows how much space on the system boot disk is used by the OS, Kubernetes, and
                    ephemeral volumes versus downloaded container images, alongside remaining free
                    space.
                  </>
                ) : (
                  <>
                    Shows how much disk space is used by Galaxy data, volumes, and system files
                    versus downloaded container images, alongside remaining free space.
                  </>
                )}
                {usageHelpExpanded && (
                  <>
                    {' '}
                    If disk usage reaches <strong>85%</strong>, the system automatically deletes
                    unused container images to free up space. If it reaches <strong>90%</strong>,
                    the node enters a low-disk warning state and may stop running jobs to prevent
                    the disk from filling up completely.
                  </>
                )}
                <button
                  type="button"
                  className="btn-inline-toggle"
                  aria-expanded={usageHelpExpanded}
                  onClick={() => setUsageHelpExpanded(prev => !prev)}
                >
                  {usageHelpExpanded ? 'Hide' : 'More'}
                </button>
              </p>

              <div className="chart-key" style={{ marginBottom: '0.4rem' }}>
                <span className="chart-key-item">
                  <span
                    className="color-swatch"
                    style={{ background: DISK_DATA_COLOR }}
                    aria-hidden="true"
                  />
                  <span>
                    {isMultiDisk
                      ? 'System, Logs & Ephemeral Volumes (GiB)'
                      : 'Data, Volumes & System (GiB)'}
                  </span>
                </span>
                <span className="chart-key-item">
                  <span
                    className="color-swatch"
                    style={{ background: DISK_IMAGES_COLOR }}
                    aria-hidden="true"
                  />
                  <span>Container Images (GiB)</span>
                </span>
                <span className="chart-key-item">
                  <span
                    className="key-line-dashed"
                    style={{ borderTopColor: DISK_AVAILABLE_COLOR }}
                    aria-hidden="true"
                  />
                  <span>Available Free Space (GiB)</span>
                </span>
              </div>

              <div className="chart-key" style={{ marginBottom: '0.65rem' }}>
                <span className="chart-key-item">
                  <span
                    className="key-line-dashed"
                    style={{ borderTopColor: DISK_GC_LINE_COLOR }}
                    aria-hidden="true"
                  />
                  <span>85% auto-cleanup threshold for unused container images</span>
                </span>
                <span className="chart-key-item">
                  <span className="key-line-dashed" aria-hidden="true" />
                  <span>90% disk pressure threshold where running jobs may be stopped</span>
                </span>
                <span className="chart-key-item">
                  <span className="key-swatch-overdraw" aria-hidden="true" />
                  <span>Low-disk warning active</span>
                </span>
              </div>

              <div style={{ height: isMultiDisk ? 300 : 340, position: 'relative' }}>
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
                    />
                    <YAxis
                      domain={[0, Math.ceil(latest.capacityGiB)]}
                      stroke={CHART_AXIS_COLOR}
                      tick={{ fill: CHART_AXIS_COLOR, fontSize: 13 }}
                      tickFormatter={(val: number) => `${val} GiB`}
                    />
                    <Tooltip
                      content={<StorageUsageTooltip isDedicatedSystemDisk={isMultiDisk} />}
                      offset={24}
                      wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                    />

                    {pressureIntervals.map((interval, idx) => (
                      <ReferenceArea
                        key={`pressure-${idx}`}
                        x1={interval.startLabel}
                        x2={interval.endLabel}
                        fill={OVERDRAW_COLOR}
                        fillOpacity={0.14}
                      />
                    ))}

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

                    <ReferenceLine
                      y={latest.gcThresholdGiB}
                      stroke={DISK_GC_LINE_COLOR}
                      strokeDasharray="5 4"
                      strokeWidth={1.5}
                    />
                    <ReferenceLine
                      y={latest.evictionThresholdGiB}
                      stroke={REQUEST_LINE_COLOR}
                      strokeDasharray="6 4"
                      strokeWidth={1.75}
                    />

                    <Area
                      type="monotone"
                      dataKey="dataAndSystemGiB"
                      stackId="used"
                      name={
                        isMultiDisk
                          ? 'System, Logs & Ephemeral Volumes (GiB)'
                          : 'Data, Volumes & System (GiB)'
                      }
                      stroke={DISK_DATA_COLOR}
                      strokeWidth={1.5}
                      fill={DISK_DATA_COLOR}
                      fillOpacity={0.62}
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="imageUsedGiB"
                      stackId="used"
                      name="Container Images (GiB)"
                      stroke={DISK_IMAGES_COLOR}
                      strokeWidth={1.5}
                      fill={DISK_IMAGES_COLOR}
                      fillOpacity={0.65}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="availableGiB"
                      name="Available Free Space (GiB)"
                      stroke={DISK_AVAILABLE_COLOR}
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <details className="inline-details" data-no-print>
              <summary>
                Tabular summary (
                {isMultiDisk
                  ? 'System & Container Images Disk'
                  : 'Storage Consumed & Available'}
                )
              </summary>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Storage Category</th>
                      <th scope="col" className="num">Latest</th>
                      <th scope="col" className="num">Peak</th>
                      <th scope="col" className="num">Share of Capacity</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>Total Used Disk</strong>
                      </td>
                      <td className="num">{formatGiB(latest.usedGiB)}</td>
                      <td className="num">{formatGiB(summary.peakUsedGiB)}</td>
                      <td className="num">{latest.usedPct.toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td>
                        {isMultiDisk
                          ? 'System, Logs & Ephemeral Volumes'
                          : 'Data, Volumes & System'}
                      </td>
                      <td className="num">{formatGiB(latest.dataAndSystemGiB)}</td>
                      <td className="num">
                        {formatGiB(
                          displayedPoints.reduce(
                            (max, pt) => Math.max(max, pt.dataAndSystemGiB),
                            0
                          )
                        )}
                      </td>
                      <td className="num">
                        {latest.capacityGiB > 0
                          ? `${((latest.dataAndSystemGiB / latest.capacityGiB) * 100).toFixed(1)}%`
                          : '-'}
                      </td>
                    </tr>
                    <tr>
                      <td>Container Images</td>
                      <td className="num">{formatGiB(latest.imageUsedGiB)}</td>
                      <td className="num">{formatGiB(summary.peakImageGiB)}</td>
                      <td className="num">{imageSharePct.toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td>Available Free Space</td>
                      <td className="num">{formatGiB(latest.availableGiB)}</td>
                      <td className="num">
                        {formatGiB(
                          displayedPoints.reduce((max, pt) => Math.max(max, pt.availableGiB), 0)
                        )}
                      </td>
                      <td className="num">
                        {latest.capacityGiB > 0
                          ? `${((latest.availableGiB / latest.capacityGiB) * 100).toFixed(1)}%`
                          : '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* Chart Panel 3 (Multi-Disk): Postgres Database Disk */}
      {summary.hasPostgresDisk && (
        <section
          className="panel"
          aria-label="Postgres Database Disk — Storage Consumed & Available Over Time"
        >
          <div className="panel-header" data-collapsed={postgresCollapsed ? 'true' : 'false'}>
            <div className="panel-title-group">
              <h3 className="panel-title">
                Postgres Database Disk — Storage Consumed &amp; Available Over Time
              </h3>
              <span className="panel-subtitle">
                /mnt/postgres_storage ({formatIntGiB(latest.postgresCapacityGiB)}) · Drag across
                chart to zoom
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
                aria-expanded={!postgresCollapsed}
                aria-controls={postgresBodyId}
                onClick={() => setPostgresCollapsed(prev => !prev)}
              >
                {postgresCollapsed ? 'Expand' : 'Collapse'}
              </button>
            </div>
          </div>

          {!postgresCollapsed && (
            <div id={postgresBodyId}>
              <div className="panel-body">
                <p className="panel-description">
                  Shows disk space used on the dedicated PostgreSQL database disk (Galaxy and
                  Rainstone relational databases) alongside remaining free space.
                </p>

                <div className="chart-key" style={{ marginBottom: '0.65rem' }}>
                  <span className="chart-key-item">
                    <span
                      className="color-swatch"
                      style={{ background: DISK_POSTGRES_COLOR }}
                      aria-hidden="true"
                    />
                    <span>Postgres Database Used (GiB)</span>
                  </span>
                  <span className="chart-key-item">
                    <span
                      className="key-line-dashed"
                      style={{ borderTopColor: DISK_AVAILABLE_COLOR }}
                      aria-hidden="true"
                    />
                    <span>Available Free Space (GiB)</span>
                  </span>
                </div>

                <div style={{ height: 260, position: 'relative' }}>
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
                      />
                      <YAxis
                        domain={[0, Math.ceil(latest.postgresCapacityGiB)]}
                        stroke={CHART_AXIS_COLOR}
                        tick={{ fill: CHART_AXIS_COLOR, fontSize: 13 }}
                        tickFormatter={(val: number) => `${val} GiB`}
                      />
                      <Tooltip
                        content={<PostgresDiskTooltip />}
                        offset={24}
                        wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                      />

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
                        dataKey="postgresUsedGiB"
                        name="Postgres Database Used (GiB)"
                        stroke={DISK_POSTGRES_COLOR}
                        strokeWidth={1.75}
                        fill={DISK_POSTGRES_COLOR}
                        fillOpacity={0.62}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="postgresAvailableGiB"
                        name="Available Free Space (GiB)"
                        stroke={DISK_AVAILABLE_COLOR}
                        strokeWidth={2}
                        strokeDasharray="5 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <details className="inline-details" data-no-print>
                <summary>Tabular summary (Postgres Database Disk)</summary>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Storage Category</th>
                        <th scope="col" className="num">Latest</th>
                        <th scope="col" className="num">Peak</th>
                        <th scope="col" className="num">Share of Capacity</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <strong>Postgres Database Used</strong>
                        </td>
                        <td className="num">{formatGiB(latest.postgresUsedGiB)}</td>
                        <td className="num">{formatGiB(summary.peakPostgresUsedGiB)}</td>
                        <td className="num">{latest.postgresUsedPct.toFixed(1)}%</td>
                      </tr>
                      <tr>
                        <td>Available Free Space</td>
                        <td className="num">{formatGiB(latest.postgresAvailableGiB)}</td>
                        <td className="num">
                          {formatGiB(
                            displayedPoints.reduce(
                              (max, pt) => Math.max(max, pt.postgresAvailableGiB),
                              0
                            )
                          )}
                        </td>
                        <td className="num">
                          {latest.postgresCapacityGiB > 0
                            ? `${((latest.postgresAvailableGiB / latest.postgresCapacityGiB) * 100).toFixed(1)}%`
                            : '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}
        </section>
      )}

      {/* Chart Panel 4: Disk Pressure & I/O Wait Over Time */}
      <section className="panel" aria-label="Disk Pressure & I/O Wait Over Time">
        <div className="panel-header" data-collapsed={pressureCollapsed ? 'true' : 'false'}>
          <div className="panel-title-group">
            <h3 className="panel-title">Disk Pressure &amp; I/O Wait Over Time</h3>
            <span className="panel-subtitle">Drag across chart to zoom</span>
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
              aria-expanded={!pressureCollapsed}
              aria-controls={pressureBodyId}
              onClick={() => setPressureCollapsed(prev => !prev)}
            >
              {pressureCollapsed ? 'Expand' : 'Collapse'}
            </button>
          </div>
        </div>

        {!pressureCollapsed && (
          <div id={pressureBodyId} className="panel-body">
            <p className="panel-description">
              Shows the percentage of time processes had to wait for disk reads or writes to
              complete.
              {pressureHelpExpanded && (
                <>
                  {' '}
                  <strong>Some tasks delayed (partial I/O wait)</strong> means at least one task was
                  slowed down waiting for the disk while other work continued—brief spikes are
                  normal during large file uploads or container downloads.{' '}
                  <strong>All tasks stalled (full I/O wait)</strong> means all active work was
                  blocked waiting on the disk, which can make Galaxy and running jobs feel slow or
                  unresponsive.
                </>
              )}
              <button
                type="button"
                className="btn-inline-toggle"
                aria-expanded={pressureHelpExpanded}
                onClick={() => setPressureHelpExpanded(prev => !prev)}
              >
                {pressureHelpExpanded ? 'Hide' : 'More'}
              </button>
            </p>

            <div className="chart-key" style={{ marginBottom: '0.4rem' }}>
              <span className="chart-key-item">
                <span
                  className="color-swatch"
                  style={{ background: DISK_PSI_SOME_COLOR }}
                  aria-hidden="true"
                />
                <span>Some tasks delayed — partial I/O wait (%)</span>
              </span>
              <span className="chart-key-item">
                <span
                  className="color-swatch"
                  style={{ background: DISK_PSI_FULL_COLOR }}
                  aria-hidden="true"
                />
                <span>All tasks stalled — full I/O wait (%)</span>
              </span>
            </div>

            <div className="chart-key" style={{ marginBottom: '0.65rem' }}>
              <span className="chart-key-item">
                <span
                  className="key-line-dashed"
                  style={{ borderTopColor: DISK_GC_LINE_COLOR }}
                  aria-hidden="true"
                />
                <span>10% elevated I/O threshold</span>
              </span>
              <span className="chart-key-item">
                <span className="key-line-dashed" aria-hidden="true" />
                <span>25% high I/O wait threshold</span>
              </span>
              <span className="chart-key-item">
                <span className="key-swatch-overdraw" aria-hidden="true" />
                <span>Low-disk warning active</span>
              </span>
            </div>

            <div style={{ height: 260, position: 'relative' }}>
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
                  />
                  <YAxis
                    stroke={CHART_AXIS_COLOR}
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 13 }}
                    tickFormatter={(val: number) => `${val}%`}
                  />
                  <Tooltip
                    content={<DiskPressureTooltip />}
                    offset={24}
                    wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                  />

                  {pressureIntervals.map((interval, idx) => (
                    <ReferenceArea
                      key={`psi-pressure-${idx}`}
                      x1={interval.startLabel}
                      x2={interval.endLabel}
                      fill={OVERDRAW_COLOR}
                      fillOpacity={0.14}
                    />
                  ))}

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

                  <ReferenceLine
                    y={10}
                    stroke={DISK_GC_LINE_COLOR}
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                  />
                  <ReferenceLine
                    y={25}
                    stroke={REQUEST_LINE_COLOR}
                    strokeDasharray="6 4"
                    strokeWidth={1.75}
                  />

                  <Area
                    type="monotone"
                    dataKey="ioPsiSomePct"
                    name="Some tasks delayed — partial I/O wait (%)"
                    stroke={DISK_PSI_SOME_COLOR}
                    strokeWidth={2}
                    fill={DISK_PSI_SOME_COLOR}
                    fillOpacity={0.45}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="ioPsiFullPct"
                    name="All tasks stalled — full I/O wait (%)"
                    stroke={DISK_PSI_FULL_COLOR}
                    strokeWidth={2}
                    fill={DISK_PSI_FULL_COLOR}
                    fillOpacity={0.55}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
