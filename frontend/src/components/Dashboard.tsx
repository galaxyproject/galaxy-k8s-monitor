import React, { useEffect, useMemo, useState } from 'react';
import type { Sample } from '../lib/types';
import { bytesToMiB } from '../lib/units';
import { POD_GROUP_PALETTE } from '../lib/colors';
import CumulativeChart from './CumulativeChart';
import PerPodChart from './PerPodChart';
import PerPodRadarChart from './PerPodRadarChart';
import StatsBar from './StatsBar';

type Props = {
  samples: Sample[];
  selectedGroups: Set<string>;
  resetZoomSignal?: number;
};

function relativeTime(timestamp: string, firstTimestamp: string): string {
  const first = new Date(firstTimestamp).getTime();
  const current = new Date(timestamp).getTime();
  const diffSeconds = Math.max(0, Math.floor((current - first) / 1000));
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function Dashboard({ samples, selectedGroups, resetZoomSignal = 0 }: Props) {
  const groups = Array.from(selectedGroups).sort((left, right) => left.localeCompare(right));
  const [pinnedSampleIndex, setPinnedSampleIndex] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<{ startSampleIndex: number; endSampleIndex: number } | null>(null);
  const [radarCollapsed, setRadarCollapsed] = useState(false);

  useEffect(() => {
    if (pinnedSampleIndex === null) {
      return;
    }

    if (pinnedSampleIndex < 0 || pinnedSampleIndex >= samples.length) {
      setPinnedSampleIndex(null);
    }
  }, [pinnedSampleIndex, samples.length]);

  useEffect(() => {
    setZoomRange(null);
  }, [resetZoomSignal]);

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
        cpuRadarRows: [] as { name: string; usage: number; request: number; usagePctOfRequest: number; }[],
        memoryRadarRows: [] as { name: string; usage: number; request: number; usagePctOfRequest: number; }[],
        selectedRadarRelativeTime: '-',
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

        point[`${pod.name}.cpu`] = pod.cpuUsageMillicores;
        point[`${pod.name}.memoryMiB`] = bytesToMiB(pod.memUsageBytes);
        point.totalCpuRequest = (point.totalCpuRequest as number) + pod.cpuRequestMillicores;
        point.totalMemRequestMiB = (point.totalMemRequestMiB as number) + bytesToMiB(pod.memRequestBytes);
        point.totalCPU = (point.totalCPU as number) + pod.cpuUsageMillicores;
        point.totalMemoryMiB = (point.totalMemoryMiB as number) + bytesToMiB(pod.memUsageBytes);
      });

      return point;
    });

    const latest = samples[samples.length - 1];
    const currentCPU = latest.pods
      .filter(pod => selectedGroups.has(pod.name))
      .map(pod => ({ name: pod.name, usage: pod.cpuUsageMillicores, request: pod.cpuRequestMillicores }));

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
    const peakTotalMemoryMiB = timeline.reduce((max, point) => Math.max(max, point.totalMemoryMiB as number), 0);

    const activeSampleIndex = pinnedSampleIndex ?? (samples.length - 1);
    const radarSourceSample = samples[activeSampleIndex] ?? latest;

    const selectedCPU = radarSourceSample.pods
      .filter(pod => selectedGroups.has(pod.name))
      .map(pod => ({ name: pod.name, usage: pod.cpuUsageMillicores, request: pod.cpuRequestMillicores }));

    const selectedMemory = radarSourceSample.pods
      .filter(pod => selectedGroups.has(pod.name))
      .map(pod => ({
        name: pod.name,
        usage: bytesToMiB(pod.memUsageBytes),
        request: bytesToMiB(pod.memRequestBytes)
      }));

    const cpuRadarRows = selectedCPU.map(row => {
      const effectiveRequest = row.request > 0 ? row.request : Math.max(row.usage, 1);
      return {
        name: row.name,
        usage: row.usage,
        request: effectiveRequest,
        usagePctOfRequest: Math.min(100, (row.usage / effectiveRequest) * 100)
      };
    });

    const memoryRadarRows = selectedMemory.map(row => {
      const effectiveRequest = row.request > 0 ? row.request : Math.max(row.usage, 1);
      return {
        name: row.name,
        usage: row.usage,
        request: effectiveRequest,
        usagePctOfRequest: Math.min(100, (row.usage / effectiveRequest) * 100)
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
        color: POD_GROUP_PALETTE[index % POD_GROUP_PALETTE.length],
        request,
        maxRecorded: peakUsage,
        axisCeiling: Math.max(request, peakUsage, 1),
        points: points.map(point => ({ sampleIndex: point.sampleIndex, relativeTime: point.relativeTime, timestamp: point.timestamp, usage: point.usage }))
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
        color: POD_GROUP_PALETTE[index % POD_GROUP_PALETTE.length],
        request,
        maxRecorded: peakUsage,
        axisCeiling: Math.max(request, peakUsage, 1),
        points: points.map(point => ({ sampleIndex: point.sampleIndex, relativeTime: point.relativeTime, timestamp: point.timestamp, usage: point.usage }))
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
      activeSampleIndex,
      clusterCPUCapacityMillicores: latest.clusterCpuCapacityMillicores ?? 0,
      clusterMemoryCapacityMiB: bytesToMiB(latest.clusterMemCapacityBytes ?? 0)
    };
  }, [samples, selectedGroups, groups, pinnedSampleIndex]);

  return (
    <main data-print-content style={{ display: 'grid', gap: 12 }}>
      <StatsBar
        currentCPU={graphModel.currentTotalCPU}
        currentMemoryMiB={graphModel.currentTotalMemoryMiB}
        currentCPURequest={graphModel.currentTotalCPURequest}
        currentMemoryRequestMiB={graphModel.currentTotalMemoryRequestMiB}
        peakCPU={graphModel.peakTotalCPU}
        peakMemoryMiB={graphModel.peakTotalMemoryMiB}
        clusterCPUCapacityMillicores={graphModel.clusterCPUCapacityMillicores}
        clusterMemoryCapacityMiB={graphModel.clusterMemoryCapacityMiB}
      />

      <CumulativeChart
        title="Cumulative CPU"
        data={graphModel.timeline}
        podGroups={groups}
        metric="cpu"
        onPointClick={setPinnedSampleIndex}
        activeSampleIndex={graphModel.activeSampleIndex}
        zoomRange={zoomRange}
        onZoomRangeChange={setZoomRange}
      />
      <CumulativeChart
        title="Cumulative Memory"
        data={graphModel.timeline}
        podGroups={groups}
        metric="memory"
        onPointClick={setPinnedSampleIndex}
        activeSampleIndex={graphModel.activeSampleIndex}
        zoomRange={zoomRange}
        onZoomRangeChange={setZoomRange}
      />
      <PerPodChart
        title="Per-Pod CPU Horizon"
        series={graphModel.cpuSeries}
        unit="m"
        onPointClick={setPinnedSampleIndex}
        activeRelativeTime={graphModel.selectedRadarRelativeTime}
        zoomRange={zoomRange}
      />
      <PerPodChart
        title="Per-Pod Memory Horizon"
        series={graphModel.memorySeries}
        unit=" MiB"
        onPointClick={setPinnedSampleIndex}
        activeRelativeTime={graphModel.selectedRadarRelativeTime}
        zoomRange={zoomRange}
      />

      <section className="no-page-break" style={{ background: '#fff', border: '1px solid #dbe1ea', borderRadius: 8, padding: 12, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: radarCollapsed ? 0 : 4 }}>
          <h3 style={{ margin: 0 }}>Per-Pod Radar</h3>
          <button
            type="button"
            onClick={() => setRadarCollapsed(previous => !previous)}
            style={{
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              borderRadius: 999,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
              color: '#334155',
              fontWeight: 600
            }}
          >
            {radarCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>

        {!radarCollapsed && (
          <>
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>
                  Radar datapoint: {graphModel.selectedRadarRelativeTime}{pinnedSampleIndex === null ? ' (latest)' : ' (pinned)'}
                </div>
                {pinnedSampleIndex !== null && (
                  <button
                    type="button"
                    onClick={() => setPinnedSampleIndex(null)}
                    style={{
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      color: '#334155',
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Reset to latest
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#475569', maxWidth: 820, lineHeight: 1.35 }}>
                Each radar chart plots per-pod usage as a percentage of that pod's request, capped at 100%.
                Click any datapoint in the cumulative or per-pod charts above to pin this section to that sample.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <PerPodRadarChart
                title="Per-Pod CPU Radar"
                rows={graphModel.cpuRadarRows}
                unit="m"
                color={POD_GROUP_PALETTE[6]}
                isPinned={pinnedSampleIndex !== null}
              />
              <PerPodRadarChart
                title="Per-Pod Memory Radar"
                rows={graphModel.memoryRadarRows}
                unit=" MiB"
                color={POD_GROUP_PALETTE[2]}
                isPinned={pinnedSampleIndex !== null}
              />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
