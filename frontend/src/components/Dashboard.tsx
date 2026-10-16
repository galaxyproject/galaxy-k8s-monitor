import React, { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Sample } from '../lib/types';
import { bytesToMiB } from '../lib/units';
import {
  CPU_RADAR_COLOR,
  getGroupColor,
  MEMORY_RADAR_COLOR,
  type GroupColorMap
} from '../lib/colors';
import CumulativeChart from './CumulativeChart';
import PerPodChart from './PerPodChart';
import PerPodRadarChart, { type RadarRow } from './PerPodRadarChart';
import StatsBar from './StatsBar';

type PrintMetadata = {
  namespace: string;
  timeframeLabel: string;
  sourceLabel: string;
};

type Props = {
  samples: Sample[];
  selectedGroups: Set<string>;
  totalGroupCount?: number;
  groupColorMap?: GroupColorMap;
  resetZoomSignal?: number;
  onSelectAllGroups?: () => void;
  toolbarPortalEl?: HTMLElement | null;
  printMetadata?: PrintMetadata;
};

function relativeTime(timestamp: string, firstTimestamp: string): string {
  const first = new Date(firstTimestamp).getTime();
  const current = new Date(timestamp).getTime();
  const diffSeconds = Math.max(0, Math.floor((current - first) / 1000));
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function Dashboard({
  samples,
  selectedGroups,
  totalGroupCount,
  groupColorMap,
  resetZoomSignal = 0,
  onSelectAllGroups,
  toolbarPortalEl,
  printMetadata
}: Props) {
  const groups = useMemo(
    () => Array.from(selectedGroups).sort((left, right) => left.localeCompare(right)),
    [selectedGroups]
  );
  const [pinnedTimestamp, setPinnedTimestamp] = useState<string | null>(null);
  const [zoomRange, setZoomRange] = useState<{
    startSampleIndex: number;
    endSampleIndex: number;
  } | null>(null);
  const [radarCollapsed, setRadarCollapsed] = useState(false);
  const radarPanelBodyId = useId();

  useEffect(() => {
    if (pinnedTimestamp === null) {
      return;
    }

    const existsInWindow = samples.some(sample => sample.timestamp === pinnedTimestamp);
    if (!existsInWindow) {
      setPinnedTimestamp(null);
    }
  }, [pinnedTimestamp, samples]);

  useEffect(() => {
    setZoomRange(null);
    setPinnedTimestamp(null);
  }, [resetZoomSignal]);

  const handlePointClick = (sampleIndex: number) => {
    const sample = samples[sampleIndex];
    if (sample) {
      setPinnedTimestamp(sample.timestamp);
    }
  };

  const graphModel = useMemo(() => {
    if (samples.length === 0) {
      return {
        timeline: [] as Record<string, number | string>[],
        currentCPU: [] as { name: string; usage: number; request: number }[],
        currentMemory: [] as { name: string; usage: number; request: number }[],
        cpuSeries: [] as {
          name: string;
          color: string;
          request: number;
          maxRecorded: number;
          axisCeiling: number;
          points: { sampleIndex: number; relativeTime: string; timestamp: string; usage: number }[];
        }[],
        memorySeries: [] as {
          name: string;
          color: string;
          request: number;
          maxRecorded: number;
          axisCeiling: number;
          points: { sampleIndex: number; relativeTime: string; timestamp: string; usage: number }[];
        }[],
        currentTotalCPU: 0,
        currentTotalMemoryMiB: 0,
        currentTotalCPURequest: 0,
        currentTotalMemoryRequestMiB: 0,
        peakTotalCPU: 0,
        peakTotalMemoryMiB: 0,
        cpuRadarRows: [] as RadarRow[],
        memoryRadarRows: [] as RadarRow[],
        selectedRadarRelativeTime: '-',
        selectedRadarTimestamp: null as string | null,
        activeSampleIndex: -1,
        clusterCPUCapacityMillicores: 0,
        clusterMemoryCapacityMiB: 0
      };
    }

    const firstTimestamp = samples[0].timestamp;
    const timeline = samples.map((sample, sampleIndex) => {
      const point: Record<string, number | string> = {
        sampleIndex,
        relativeTime: relativeTime(sample.timestamp, firstTimestamp),
        timestamp: sample.timestamp,
        totalCpuRequest: 0,
        totalMemRequestMiB: 0,
        totalCPU: 0,
        totalMemoryMiB: 0
      };

      sample.pods.forEach(pod => {
        if (!selectedGroups.has(pod.name)) {
          return;
        }

        const memUsageMiB = bytesToMiB(pod.memUsageBytes);
        const memReqMiB = bytesToMiB(pod.memRequestBytes);
        point[`${pod.name}.cpu`] = pod.cpuUsageMillicores;
        point[`${pod.name}.cpuRequest`] = pod.cpuRequestMillicores;
        point[`${pod.name}.memoryMiB`] = memUsageMiB;
        point[`${pod.name}.memoryRequestMiB`] = memReqMiB;
        point.totalCpuRequest = (point.totalCpuRequest as number) + pod.cpuRequestMillicores;
        point.totalMemRequestMiB = (point.totalMemRequestMiB as number) + memReqMiB;
        point.totalCPU = (point.totalCPU as number) + pod.cpuUsageMillicores;
        point.totalMemoryMiB = (point.totalMemoryMiB as number) + memUsageMiB;
      });

      return point;
    });

    const latest = samples[samples.length - 1];
    const currentCPU = latest.pods
      .filter(pod => selectedGroups.has(pod.name))
      .map(pod => ({
        name: pod.name,
        usage: pod.cpuUsageMillicores,
        request: pod.cpuRequestMillicores
      }));

    const currentMemory = latest.pods
      .filter(pod => selectedGroups.has(pod.name))
      .map(pod => ({
        name: pod.name,
        usage: bytesToMiB(pod.memUsageBytes),
        request: bytesToMiB(pod.memRequestBytes)
      }));

    const currentTotalCPU = currentCPU.reduce((sum, row) => sum + row.usage, 0);
    const currentTotalMemoryMiB = currentMemory.reduce((sum, row) => sum + row.usage, 0);
    const currentTotalCPURequest = currentCPU.reduce((sum, row) => sum + row.request, 0);
    const currentTotalMemoryRequestMiB = currentMemory.reduce((sum, row) => sum + row.request, 0);
    const peakTotalCPU = timeline.reduce((max, point) => Math.max(max, point.totalCPU as number), 0);
    const peakTotalMemoryMiB = timeline.reduce(
      (max, point) => Math.max(max, point.totalMemoryMiB as number),
      0
    );

    const pinnedIndex =
      pinnedTimestamp !== null
        ? samples.findIndex(sample => sample.timestamp === pinnedTimestamp)
        : -1;
    const activeSampleIndex = pinnedIndex >= 0 ? pinnedIndex : samples.length - 1;
    const radarSourceSample = samples[activeSampleIndex] ?? latest;

    const selectedCPU = radarSourceSample.pods
      .filter(pod => selectedGroups.has(pod.name))
      .map(pod => ({
        name: pod.name,
        usage: pod.cpuUsageMillicores,
        request: pod.cpuRequestMillicores
      }));

    const selectedMemory = radarSourceSample.pods
      .filter(pod => selectedGroups.has(pod.name))
      .map(pod => ({
        name: pod.name,
        usage: bytesToMiB(pod.memUsageBytes),
        request: bytesToMiB(pod.memRequestBytes)
      }));

    const cpuRadarRows: RadarRow[] = selectedCPU.map(row => {
      const hasRequest = row.request > 0;
      const rawPct = hasRequest ? (row.usage / row.request) * 100 : 0;
      return {
        name: row.name,
        usage: row.usage,
        request: hasRequest ? row.request : 0,
        hasRequest,
        rawPctOfRequest: rawPct,
        usagePctOfRequest: hasRequest ? Math.min(100, rawPct) : 0
      };
    });

    const memoryRadarRows: RadarRow[] = selectedMemory.map(row => {
      const hasRequest = row.request > 0;
      const rawPct = hasRequest ? (row.usage / row.request) * 100 : 0;
      return {
        name: row.name,
        usage: row.usage,
        request: hasRequest ? row.request : 0,
        hasRequest,
        rawPctOfRequest: rawPct,
        usagePctOfRequest: hasRequest ? Math.min(100, rawPct) : 0
      };
    });

    const cpuSeries = groups.map((group, index) => {
      const points = samples.map((sample, sampleIndex) => {
        const matchedPod = sample.pods.find(pod => pod.name === group);
        return {
          sampleIndex,
          relativeTime: relativeTime(sample.timestamp, firstTimestamp),
          timestamp: sample.timestamp,
          usage: matchedPod ? matchedPod.cpuUsageMillicores : 0,
          request: matchedPod ? matchedPod.cpuRequestMillicores : 0
        };
      });

      const request = points.reduce((max, point) => Math.max(max, point.request), 0);
      const peakUsage = points.reduce((max, point) => Math.max(max, point.usage), 0);

      return {
        name: group,
        color: getGroupColor(groupColorMap, group, index),
        request,
        maxRecorded: peakUsage,
        axisCeiling: Math.max(request, peakUsage, 1),
        points: points.map(point => ({
          sampleIndex: point.sampleIndex,
          relativeTime: point.relativeTime,
          timestamp: point.timestamp,
          usage: point.usage
        }))
      };
    });

    const memorySeries = groups.map((group, index) => {
      const points = samples.map((sample, sampleIndex) => {
        const matchedPod = sample.pods.find(pod => pod.name === group);
        return {
          sampleIndex,
          relativeTime: relativeTime(sample.timestamp, firstTimestamp),
          timestamp: sample.timestamp,
          usage: matchedPod ? bytesToMiB(matchedPod.memUsageBytes) : 0,
          request: matchedPod ? bytesToMiB(matchedPod.memRequestBytes) : 0
        };
      });

      const request = points.reduce((max, point) => Math.max(max, point.request), 0);
      const peakUsage = points.reduce((max, point) => Math.max(max, point.usage), 0);

      return {
        name: group,
        color: getGroupColor(groupColorMap, group, index),
        request,
        maxRecorded: peakUsage,
        axisCeiling: Math.max(request, peakUsage, 1),
        points: points.map(point => ({
          sampleIndex: point.sampleIndex,
          relativeTime: point.relativeTime,
          timestamp: point.timestamp,
          usage: point.usage
        }))
      };
    });

    return {
      timeline,
      currentCPU,
      currentMemory,
      cpuSeries,
      memorySeries,
      currentTotalCPU,
      currentTotalMemoryMiB,
      currentTotalCPURequest,
      currentTotalMemoryRequestMiB,
      peakTotalCPU,
      peakTotalMemoryMiB,
      cpuRadarRows,
      memoryRadarRows,
      selectedRadarRelativeTime: relativeTime(radarSourceSample.timestamp, firstTimestamp),
      selectedRadarTimestamp: radarSourceSample.timestamp,
      activeSampleIndex,
      clusterCPUCapacityMillicores: latest.clusterCpuCapacityMillicores ?? 0,
      clusterMemoryCapacityMiB: bytesToMiB(latest.clusterMemCapacityBytes ?? 0)
    };
  }, [samples, selectedGroups, groups, pinnedTimestamp, groupColorMap]);

  const zoomWindowLabel = useMemo(() => {
    if (!zoomRange || graphModel.timeline.length === 0) {
      return null;
    }
    const startPoint = graphModel.timeline.find(
      pt => pt.sampleIndex === zoomRange.startSampleIndex
    );
    const endPoint = graphModel.timeline.find(pt => pt.sampleIndex === zoomRange.endSampleIndex);
    const startRel =
      typeof startPoint?.relativeTime === 'string'
        ? startPoint.relativeTime
        : `#${zoomRange.startSampleIndex}`;
    const endRel =
      typeof endPoint?.relativeTime === 'string'
        ? endPoint.relativeTime
        : `#${zoomRange.endSampleIndex}`;
    return `${startRel} – ${endRel}`;
  }, [zoomRange, graphModel.timeline]);

  const isPinned = pinnedTimestamp !== null;
  const totalGroups = totalGroupCount ?? groups.length;

  return (
    <div data-print-content className="dashboard-stack">
      <div className="print-summary-header">
        <div className="print-summary-title">
          Galaxy K8s Monitor — Resource Utilization Report
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
            Samples: <strong>{samples.length.toLocaleString()}</strong>
          </span>
          <span>
            Pod groups:{' '}
            <strong>
              {selectedGroups.size}/{totalGroups}
            </strong>
          </span>
          <span>
            Exported: <strong>{new Date().toLocaleString()}</strong>
          </span>
        </div>
      </div>

      {toolbarPortalEl &&
        (zoomRange !== null || isPinned) &&
        createPortal(
          <>
            {zoomRange && zoomWindowLabel && (
              <>
                <span className="badge-scope" title="Active zoom window">
                  Zoom: {zoomWindowLabel}
                </span>
                <button
                  type="button"
                  className="btn-compact"
                  onClick={() => setZoomRange(null)}
                >
                  Reset zoom
                </button>
              </>
            )}
            {isPinned && (
              <>
                <span className="badge-pinned">
                  Pinned: {graphModel.selectedRadarRelativeTime}
                </span>
                <button
                  type="button"
                  className="btn-compact"
                  onClick={() => setPinnedTimestamp(null)}
                >
                  Unpin
                </button>
              </>
            )}
          </>,
          toolbarPortalEl
        )}

      {selectedGroups.size === 0 && totalGroups > 0 && (
        <div className="status-banner" data-variant="info" data-no-print role="status">
          <div className="status-banner-content">
            <strong>No pod groups selected.</strong>
            <span>Select one or more pod groups in the filter panel to plot telemetry.</span>
          </div>
          {onSelectAllGroups && (
            <button type="button" className="btn-compact" onClick={onSelectAllGroups}>
              Select all groups
            </button>
          )}
        </div>
      )}

      <StatsBar
        currentCPU={graphModel.currentTotalCPU}
        currentMemoryMiB={graphModel.currentTotalMemoryMiB}
        currentCPURequest={graphModel.currentTotalCPURequest}
        currentMemoryRequestMiB={graphModel.currentTotalMemoryRequestMiB}
        peakCPU={graphModel.peakTotalCPU}
        peakMemoryMiB={graphModel.peakTotalMemoryMiB}
        clusterCPUCapacityMillicores={graphModel.clusterCPUCapacityMillicores}
        clusterMemoryCapacityMiB={graphModel.clusterMemoryCapacityMiB}
        selectedGroupCount={selectedGroups.size}
        totalGroupCount={totalGroups}
      />

      <CumulativeChart
        title="Cumulative CPU"
        data={graphModel.timeline}
        podGroups={groups}
        metric="cpu"
        groupColorMap={groupColorMap}
        onPointClick={handlePointClick}
        onPinTimestamp={setPinnedTimestamp}
        pinnedTimestamp={pinnedTimestamp}
        activeSampleIndex={graphModel.activeSampleIndex}
        zoomRange={zoomRange}
        onZoomRangeChange={setZoomRange}
      />
      <CumulativeChart
        title="Cumulative Memory"
        data={graphModel.timeline}
        podGroups={groups}
        metric="memory"
        groupColorMap={groupColorMap}
        onPointClick={handlePointClick}
        onPinTimestamp={setPinnedTimestamp}
        pinnedTimestamp={pinnedTimestamp}
        activeSampleIndex={graphModel.activeSampleIndex}
        zoomRange={zoomRange}
        onZoomRangeChange={setZoomRange}
      />
      <PerPodChart
        title="Per-Pod CPU Horizon"
        series={graphModel.cpuSeries}
        unit="m"
        onPointClick={handlePointClick}
        onPinTimestamp={setPinnedTimestamp}
        activeRelativeTime={graphModel.selectedRadarRelativeTime}
        zoomRange={zoomRange}
      />
      <PerPodChart
        title="Per-Pod Memory Horizon"
        series={graphModel.memorySeries}
        unit=" MiB"
        onPointClick={handlePointClick}
        onPinTimestamp={setPinnedTimestamp}
        activeRelativeTime={graphModel.selectedRadarRelativeTime}
        zoomRange={zoomRange}
      />

      <section
        className="panel no-page-break"
        data-pinned={isPinned ? 'true' : 'false'}
        aria-label="Per-Pod Radar"
      >
        <div
          className="panel-header"
          data-collapsed={radarCollapsed ? 'true' : 'false'}
        >
          <div className="panel-title-group">
            <h3 className="panel-title">Per-Pod Radar</h3>
            {isPinned && <span className="badge-pinned">Pinned</span>}
            <span className="panel-subtitle">
              Datapoint: <strong>{graphModel.selectedRadarRelativeTime}</strong>
              {isPinned ? ' (pinned)' : ' (latest)'}
            </span>
          </div>

          <div className="panel-header-actions" data-no-print>
            {isPinned && (
              <button
                type="button"
                className="btn-compact"
                onClick={() => setPinnedTimestamp(null)}
              >
                Reset to latest
              </button>
            )}
            <button
              type="button"
              className="btn-compact"
              aria-expanded={!radarCollapsed}
              aria-controls={radarPanelBodyId}
              onClick={() => setRadarCollapsed(previous => !previous)}
            >
              {radarCollapsed ? 'Expand' : 'Collapse'}
            </button>
          </div>
        </div>

        {!radarCollapsed && (
          <div id={radarPanelBodyId} className="panel-body">
            <p className="panel-subtitle" style={{ marginBottom: '0.85rem', maxWidth: 820 }}>
              Each radar chart plots per-pod usage as a percentage of that pod&apos;s request, capped
              at 100%. Click any datapoint in the cumulative or per-pod charts above (or use the
              sample selector in the table disclosures) to pin this section to that sample.
            </p>

            <div className="radar-grid">
              <PerPodRadarChart
                title="Per-Pod CPU Radar"
                rows={graphModel.cpuRadarRows}
                unit="m"
                color={CPU_RADAR_COLOR}
                isPinned={isPinned}
              />
              <PerPodRadarChart
                title="Per-Pod Memory Radar"
                rows={graphModel.memoryRadarRows}
                unit=" MiB"
                color={MEMORY_RADAR_COLOR}
                isPinned={isPinned}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
