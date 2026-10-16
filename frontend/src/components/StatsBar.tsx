import React from 'react';
import {
  CPU_CURRENT_COLOR,
  CPU_PEAK_COLOR,
  MEMORY_CURRENT_COLOR,
  MEMORY_PEAK_COLOR,
  REQUEST_LINE_COLOR
} from '../lib/colors';
import { formatAdaptiveMemoryFromMiB, formatGiBFromMiB, formatMillicores } from '../lib/units';

type Props = {
  currentCPU: number;
  currentMemoryMiB: number;
  currentCPURequest: number;
  currentMemoryRequestMiB: number;
  peakCPU: number;
  peakMemoryMiB: number;
  clusterCPUCapacityMillicores: number;
  clusterMemoryCapacityMiB: number;
  selectedGroupCount?: number;
  totalGroupCount?: number;
};

type UtilizationCardProps = {
  label: string;
  value: string;
  percentage: number;
  fillColor: string;
  requestLabel: string;
  requestPercentage: number;
  isOverRequest: boolean;
};

function UtilizationCard({
  label,
  value,
  percentage,
  fillColor,
  requestLabel,
  requestPercentage,
  isOverRequest
}: UtilizationCardProps) {
  const safePercentage = Math.max(0, Math.min(100, percentage));
  const safeMarkerPercentage = Math.max(0, Math.min(100, requestPercentage));

  const meterTooltip = [
    `${label}: ${value} (${safePercentage.toFixed(1)}% of cluster capacity)`,
    `• Vertical mark (${safeMarkerPercentage.toFixed(1)}% / ${requestLabel}): Cumulative pod resource request`
  ].join('\n');

  return (
    <div className="stat-card">
      <div className="stat-card-header">
        <span className="stat-label">{label}</span>
        <span className="stat-pct">{safePercentage.toFixed(1)}%</span>
      </div>

      <div className="stat-value">{value}</div>

      <div className="stat-meter-wrapper" tabIndex={0} aria-label={meterTooltip}>
        <div className="stat-meter" role="img" aria-label={meterTooltip}>
          <div
            className="stat-meter-fill"
            style={{
              width: `${safePercentage}%`,
              background: fillColor
            }}
          />
          <div
            className="stat-meter-marker"
            style={{
              left: `calc(${safeMarkerPercentage}% - 1.5px)`
            }}
          />
        </div>
        <div className="stat-meter-tooltip" role="tooltip">
          <div className="stat-meter-tooltip-row">
            <span
              className="stat-meter-tooltip-swatch"
              style={{ background: fillColor }}
              aria-hidden="true"
            />
            <span>
              <strong>{label}:</strong> {value} ({safePercentage.toFixed(1)}% of capacity)
            </span>
          </div>
          <div className="stat-meter-tooltip-row">
            <span
              className="stat-meter-tooltip-mark"
              style={{ background: REQUEST_LINE_COLOR }}
              aria-hidden="true"
            />
            <span>
              <strong>Request mark ({safeMarkerPercentage.toFixed(1)}%):</strong> {requestLabel}{' '}
              cumulative pod request
            </span>
          </div>
        </div>
      </div>

      <div className="stat-secondary">
        <span>
          Req: <strong>{requestLabel}</strong> ({Math.round(safeMarkerPercentage)}%)
        </span>
        {isOverRequest && (
          <span className="text-overdraw">Exceeded</span>
        )}
      </div>
    </div>
  );
}

export default function StatsBar(props: Props) {
  const cpuPercentage =
    props.clusterCPUCapacityMillicores > 0
      ? (props.currentCPU / props.clusterCPUCapacityMillicores) * 100
      : 0;

  const peakCPUPercentage =
    props.clusterCPUCapacityMillicores > 0
      ? (props.peakCPU / props.clusterCPUCapacityMillicores) * 100
      : 0;

  const memoryPercentage =
    props.clusterMemoryCapacityMiB > 0
      ? (props.currentMemoryMiB / props.clusterMemoryCapacityMiB) * 100
      : 0;

  const peakMemoryPercentage =
    props.clusterMemoryCapacityMiB > 0
      ? (props.peakMemoryMiB / props.clusterMemoryCapacityMiB) * 100
      : 0;

  const cpuRequestPercentage =
    props.clusterCPUCapacityMillicores > 0
      ? (props.currentCPURequest / props.clusterCPUCapacityMillicores) * 100
      : 0;

  const memoryRequestPercentage =
    props.clusterMemoryCapacityMiB > 0
      ? (props.currentMemoryRequestMiB / props.clusterMemoryCapacityMiB) * 100
      : 0;

  const totalGroups = props.totalGroupCount ?? 0;
  const selectedGroups = props.selectedGroupCount ?? totalGroups;
  const isFilteredSubset = totalGroups > 0 && selectedGroups < totalGroups;

  const cpuCapacityLabel = formatMillicores(props.clusterCPUCapacityMillicores);
  const memCapacityLabel = formatGiBFromMiB(props.clusterMemoryCapacityMiB);
  const cpuRequestLabel = formatMillicores(props.currentCPURequest);
  const memRequestLabel = formatAdaptiveMemoryFromMiB(props.currentMemoryRequestMiB);

  return (
    <section className="stats-section" aria-label="Cluster utilization summary">
      {totalGroups > 0 && (
        <div className="stats-header-bar">
          <span>
            Totals for{' '}
            <strong>
              {isFilteredSubset
                ? `${selectedGroups} of ${totalGroups} selected pod groups`
                : `all ${totalGroups} pod groups`}
            </strong>{' '}
            vs. full cluster capacity (vertical bar marker = cumulative request)
          </span>
          {isFilteredSubset && (
            <span className="badge-scope">
              Filtered subset ({selectedGroups}/{totalGroups})
            </span>
          )}
        </div>
      )}

      <div className="stats-grid">
        <UtilizationCard
          label="Current Total CPU"
          value={`${formatMillicores(props.currentCPU)} / ${cpuCapacityLabel}`}
          percentage={cpuPercentage}
          fillColor={CPU_CURRENT_COLOR}
          requestLabel={cpuRequestLabel}
          requestPercentage={cpuRequestPercentage}
          isOverRequest={props.currentCPURequest > 0 && props.currentCPU > props.currentCPURequest}
        />
        <UtilizationCard
          label="Peak Total CPU"
          value={`${formatMillicores(props.peakCPU)} / ${cpuCapacityLabel}`}
          percentage={peakCPUPercentage}
          fillColor={CPU_PEAK_COLOR}
          requestLabel={cpuRequestLabel}
          requestPercentage={cpuRequestPercentage}
          isOverRequest={props.currentCPURequest > 0 && props.peakCPU > props.currentCPURequest}
        />
        <UtilizationCard
          label="Current Total Memory"
          value={`${formatAdaptiveMemoryFromMiB(props.currentMemoryMiB)} / ${memCapacityLabel}`}
          percentage={memoryPercentage}
          fillColor={MEMORY_CURRENT_COLOR}
          requestLabel={memRequestLabel}
          requestPercentage={memoryRequestPercentage}
          isOverRequest={props.currentMemoryRequestMiB > 0 && props.currentMemoryMiB > props.currentMemoryRequestMiB}
        />
        <UtilizationCard
          label="Peak Total Memory"
          value={`${formatAdaptiveMemoryFromMiB(props.peakMemoryMiB)} / ${memCapacityLabel}`}
          percentage={peakMemoryPercentage}
          fillColor={MEMORY_PEAK_COLOR}
          requestLabel={memRequestLabel}
          requestPercentage={memoryRequestPercentage}
          isOverRequest={props.currentMemoryRequestMiB > 0 && props.peakMemoryMiB > props.currentMemoryRequestMiB}
        />
      </div>
    </section>
  );
}
