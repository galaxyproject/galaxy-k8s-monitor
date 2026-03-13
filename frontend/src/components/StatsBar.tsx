import React from 'react';
import { POD_GROUP_PALETTE } from '../lib/colors';

type Props = {
  currentCPU: number;
  currentMemoryMiB: number;
  currentCPURequest: number;
  currentMemoryRequestMiB: number;
  peakCPU: number;
  peakMemoryMiB: number;
  clusterCPUCapacityMillicores: number;
  clusterMemoryCapacityMiB: number;
};

function UtilizationCard({
  label,
  value,
  percentage,
  fillColor,
  markerPercentage,
  markerTitle
}: {
  label: string;
  value: string;
  percentage: number;
  fillColor: string;
  markerPercentage?: number;
  markerTitle?: string;
}) {
  const [showMarkerTooltip, setShowMarkerTooltip] = React.useState(false);
  const safePercentage = Math.max(0, Math.min(100, percentage));
  const safeMarkerPercentage = markerPercentage === undefined
    ? null
    : Math.max(0, Math.min(100, markerPercentage));

  return (
    <div style={{ boxSizing: 'border-box', background: '#fff', border: '1px solid #dbe1ea', borderRadius: 8, padding: 12, minWidth: 0, width: '100%' }}>
      <div style={{ color: '#4b5563', fontSize: 12 }}>{label}</div>
      <div
        style={{
          marginTop: 8,
          height: 18,
          position: 'relative',
          borderRadius: 6,
          background: '#e5e7eb',
          overflow: 'hidden',
          border: '1px solid #cbd5e1'
        }}
      >
        <div
          style={{
            width: `${safePercentage}%`,
            height: '100%',
            background: fillColor,
            transition: 'width 180ms ease-out'
          }}
        />
        {safeMarkerPercentage !== null && (
          <div
            title={markerTitle ?? 'Cumulative request marker'}
            onMouseEnter={() => setShowMarkerTooltip(true)}
            onMouseLeave={() => setShowMarkerTooltip(false)}
            style={{
              position: 'absolute',
              top: -1,
              bottom: -1,
              left: `calc(${safeMarkerPercentage}% - 1px)`,
              width: 2,
              background: '#111827',
              opacity: 0.9,
              pointerEvents: 'auto'
            }}
          />
        )}
        {safeMarkerPercentage !== null && showMarkerTooltip && (
          <div
            style={{
              position: 'absolute',
              left: `calc(${safeMarkerPercentage}% - 70px)`,
              bottom: 22,
              width: 140,
              textAlign: 'center',
              fontSize: 11,
              lineHeight: 1.25,
              padding: '4px 6px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#111827',
              color: '#f8fafc',
              zIndex: 2,
              pointerEvents: 'none'
            }}
          >
            {markerTitle ?? 'Cumulative request marker'}
          </div>
        )}
      </div>
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            lineHeight: 1.25
          }}
        >
          {value}
        </div>
        <div style={{ color: '#4b5563', fontSize: 12 }}>{safePercentage.toFixed(1)}%</div>
      </div>
    </div>
  );
}

function miBToGB(valueMiB: number): number {
  return valueMiB / 1024;
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, width: '100%' }}>
      <UtilizationCard
        label="Current Total CPU"
        value={`${Math.round(props.currentCPU).toLocaleString()}m / ${Math.round(props.clusterCPUCapacityMillicores).toLocaleString()}m`}
        percentage={cpuPercentage}
        fillColor={POD_GROUP_PALETTE[6]}
        markerPercentage={cpuRequestPercentage}
        markerTitle={`Cumulative request: ${Math.round(props.currentCPURequest).toLocaleString()}m`}
      />
      <UtilizationCard
        label="Max Total CPU"
        value={`${Math.round(props.peakCPU).toLocaleString()}m / ${Math.round(props.clusterCPUCapacityMillicores).toLocaleString()}m`}
        percentage={peakCPUPercentage}
        fillColor={POD_GROUP_PALETTE[0]}
        markerPercentage={cpuRequestPercentage}
        markerTitle={`Cumulative request: ${Math.round(props.currentCPURequest).toLocaleString()}m`}
      />
      <UtilizationCard
        label="Current Total Memory"
        value={`${miBToGB(props.currentMemoryMiB).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB / ${miBToGB(props.clusterMemoryCapacityMiB).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB`}
        percentage={memoryPercentage}
        fillColor={POD_GROUP_PALETTE[2]}
        markerPercentage={memoryRequestPercentage}
        markerTitle={`Cumulative request: ${miBToGB(props.currentMemoryRequestMiB).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB`}
      />
      <UtilizationCard
        label="Max Total Memory"
        value={`${miBToGB(props.peakMemoryMiB).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB / ${miBToGB(props.clusterMemoryCapacityMiB).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB`}
        percentage={peakMemoryPercentage}
        fillColor={POD_GROUP_PALETTE[4]}
        markerPercentage={memoryRequestPercentage}
        markerTitle={`Cumulative request: ${miBToGB(props.currentMemoryRequestMiB).toLocaleString(undefined, { maximumFractionDigits: 2 })} GB`}
      />
    </div>
  );
}
