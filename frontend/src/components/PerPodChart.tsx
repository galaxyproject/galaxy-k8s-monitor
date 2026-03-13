import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

type Series = {
  name: string;
  color: string;
  request: number;
  maxRecorded: number;
  axisCeiling: number;
  points: { sampleIndex: number; relativeTime: string; timestamp: string; usage: number }[];
};

type Props = {
  title: string;
  series: Series[];
  unit: string;
  onPointClick?: (sampleIndex: number) => void;
  activeRelativeTime?: string;
  zoomRange?: { startSampleIndex: number; endSampleIndex: number } | null;
};

function PerPodTooltip({
  active,
  payload,
  label,
  unit
}: {
  active?: boolean;
  payload?: Array<{ payload: { currentUsage?: number; timestamp?: string } }>;
  label?: string;
  unit: string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const currentUsage = payload[0].payload.currentUsage ?? 0;
  const timestamp = payload[0].payload.timestamp ?? '-';
  const formattedTimestamp = timestamp === '-' ? timestamp : new Date(timestamp).toLocaleString();

  return (
    <div style={{ background: '#fff', border: '1px solid #dbe1ea', borderRadius: 8, padding: 10, minWidth: 180 }}>
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Datapoint time: {label}</div>
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 6 }}>Timestamp: {formattedTimestamp}</div>
      <div style={{ fontSize: 12 }}>
        Current usage: {currentUsage.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}
      </div>
    </div>
  );
}

export default function PerPodChart({ title, series, unit, onPointClick, activeRelativeTime, zoomRange }: Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  const formatValue = (value: number): string => `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;
  const percentOfRequest = (value: number, request: number): string => {
    if (request <= 0) {
      return 'n/a';
    }

    return `${Math.round((value / request) * 100)}%`;
  };

  const withInverseOverflow = (seriesRow: Series) => {
    const visiblePoints = zoomRange
      ? seriesRow.points.filter(
          point => point.sampleIndex >= zoomRange.startSampleIndex && point.sampleIndex <= zoomRange.endSampleIndex
        )
      : seriesRow.points;

    if (visiblePoints.length === 0) {
      return [] as Array<Series['points'][number] & { displayUsage: number; currentUsage: number; overflowFloor: number }>;
    }

    if (seriesRow.request <= 0) {
      return visiblePoints.map(point => ({
        ...point,
        displayUsage: point.usage,
        currentUsage: point.usage,
        overflowFloor: seriesRow.axisCeiling
      }));
    }

    return visiblePoints.map(point => {
      if (point.usage <= seriesRow.request) {
        return {
          ...point,
          displayUsage: point.usage,
          currentUsage: point.usage,
          overflowFloor: seriesRow.request
        };
      }

      const overflowAmount = point.usage - seriesRow.request;
      const inverseValue = Math.max(seriesRow.request - overflowAmount, 0);

      return {
        ...point,
        displayUsage: inverseValue,
        currentUsage: point.usage,
        overflowFloor: inverseValue
      };
    });
  };

  return (
    <section style={{ background: '#fff', border: '1px solid #dbe1ea', borderRadius: 8, padding: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: collapsed ? 0 : 8 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button
          type="button"
          onClick={() => setCollapsed(previous => !previous)}
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
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && (
      <div style={{ display: 'grid', gap: 8 }}>
        {series.map((podSeries, index) => (
          (() => {
            const displayedPoints = zoomRange
              ? podSeries.points.filter(
                  point => point.sampleIndex >= zoomRange.startSampleIndex && point.sampleIndex <= zoomRange.endSampleIndex
                )
              : podSeries.points;

            const currentUsage = displayedPoints[displayedPoints.length - 1]?.usage ?? 0;
            const maxRecorded = displayedPoints.reduce((max, point) => Math.max(max, point.usage), 0);
            const isCurrentOverRequest = podSeries.request > 0 && currentUsage > podSeries.request;
            const isMaxOverRequest = podSeries.request > 0 && maxRecorded > podSeries.request;

            return (
          <div
            key={podSeries.name}
            style={{
              display: 'grid',
              gridTemplateColumns: '180px minmax(0, 1fr)',
              alignItems: 'center',
              gap: 8,
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '6px 8px'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {podSeries.name}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Current: <span style={{ color: isCurrentOverRequest ? '#FC3841' : 'inherit' }}>{formatValue(currentUsage)} ({percentOfRequest(currentUsage, podSeries.request)})</span> · Req: {formatValue(podSeries.request)} · <span title="Max recorded value">Max: <span style={{ color: isMaxOverRequest ? '#FC3841' : 'inherit' }}>{formatValue(maxRecorded)} ({percentOfRequest(maxRecorded, podSeries.request)})</span></span>
              </div>
            </div>

            <div style={{ height: 64 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={withInverseOverflow(podSeries)}
                  margin={{ top: 6, right: 8, left: 8, bottom: 2 }}
                  onClick={(state: { activePayload?: Array<{ payload?: { sampleIndex?: number } }> }) => {
                    const sampleIndex = state.activePayload?.[0]?.payload?.sampleIndex;

                    if (typeof sampleIndex === 'number' && onPointClick) {
                      onPointClick(sampleIndex);
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="2 2" vertical={false} />
                  <XAxis
                    dataKey="relativeTime"
                    hide={index !== series.length - 1}
                    interval="preserveStartEnd"
                    minTickGap={36}
                  />
                  <YAxis hide domain={[0, podSeries.request > 0 ? podSeries.request : podSeries.axisCeiling]} />
                  <Tooltip
                    content={<PerPodTooltip unit={unit} />}
                    offset={80}
                  />
                  {podSeries.request > 0 && (
                    <ReferenceLine
                      y={podSeries.request}
                      stroke={podSeries.color}
                      strokeDasharray="4 4"
                      strokeOpacity={0.9}
                    />
                  )}
                  {activeRelativeTime && (
                    <ReferenceLine
                      x={activeRelativeTime}
                      stroke="#111827"
                      strokeDasharray="2 3"
                      strokeOpacity={0.7}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="displayUsage"
                    stroke="none"
                    fill={podSeries.color}
                    fillOpacity={0.35}
                    isAnimationActive={false}
                  />
                  {podSeries.request > 0 && (
                    <Area
                      type="monotone"
                      dataKey="overflowFloor"
                      stroke="none"
                      fill="#FC3841"
                      fillOpacity={0.35}
                      baseValue={podSeries.request}
                      isAnimationActive={false}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="displayUsage"
                    stroke={podSeries.color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
            );
          })()
        ))}
      </div>
      )}
    </section>
  );
}
