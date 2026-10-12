import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
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

// Keep the timeline's plot column aligned with every bordered pod row.
const rowLayout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '220px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 8,
  border: '1px solid transparent',
  padding: '6px 8px'
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
  const formatNumber = (value: number): string => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const formatValue = (value: number): string => `${formatNumber(value)}${unit}`;
  const percentOfRequest = (value: number, request: number): string => {
    if (request <= 0) {
      return 'n/a';
    }

    return `${Math.round((value / request) * 100)}%`;
  };

  const displayedPointsFor = (seriesRow: Series) => zoomRange
    ? seriesRow.points.filter(
        point => point.sampleIndex >= zoomRange.startSampleIndex && point.sampleIndex <= zoomRange.endSampleIndex
      )
    : seriesRow.points;

  const timelinePoints = series.length > 0 ? displayedPointsFor(series[0]) : [];

  const withInverseOverflow = (seriesRow: Series) => {
    const visiblePoints = displayedPointsFor(seriesRow);

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
        {series.map(podSeries => (
          (() => {
            const displayedPoints = displayedPointsFor(podSeries);

            const currentUsage = displayedPoints[displayedPoints.length - 1]?.usage ?? 0;
            const maxRecorded = displayedPoints.reduce((max, point) => Math.max(max, point.usage), 0);
            const averageUsage = displayedPoints.length > 0
              ? displayedPoints.reduce((sum, point) => sum + point.usage, 0) / displayedPoints.length
              : 0;
            const sortedUsage = displayedPoints.map(point => point.usage).sort((left, right) => left - right);
            const p95Usage = sortedUsage[Math.ceil(sortedUsage.length * 0.95) - 1] ?? 0;
            const summaryMetrics = [
              { label: 'Current', description: 'Current usage', value: currentUsage },
              { label: 'Avg', description: 'Average usage over the displayed time range', value: averageUsage },
              { label: 'P95', description: '95th percentile usage over the displayed time range (nearest rank)', value: p95Usage },
              { label: 'Max', description: 'Maximum usage over the displayed time range', value: maxRecorded }
            ];

            return (
          <div
            key={podSeries.name}
            style={{
              ...rowLayout,
              border: '1px solid #e2e8f0',
              borderRadius: 8
            }}
          >
            <div style={{ minWidth: 0, height: 64, display: 'grid', gridTemplateRows: '18px 1fr', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, lineHeight: '18px' }}>
                <div title={podSeries.name} style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {podSeries.name}
                </div>
                <div title={`Request: ${formatValue(podSeries.request)}. All usage values are in ${unit.trim()}.`} style={{ flexShrink: 0, fontSize: 10, color: '#64748b', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  Req: {formatValue(podSeries.request)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
                {summaryMetrics.map(metric => {
                  const isOverRequest = podSeries.request > 0 && metric.value > podSeries.request;
                  const percentage = percentOfRequest(metric.value, podSeries.request);
                  const description = `${metric.description}: ${formatValue(metric.value)}. ${podSeries.request > 0 ? `${percentage} of request.` : 'No request configured.'}`;

                  return (
                    <div key={metric.label} title={description} style={{ minWidth: 0, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: 10, lineHeight: '12px', color: '#64748b' }}>{metric.label}</div>
                      <div style={{ fontSize: 12, lineHeight: '16px', fontWeight: 600, color: isOverRequest ? '#FC3841' : '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {formatNumber(metric.value)}
                      </div>
                      <div style={{ fontSize: 10, lineHeight: '12px', color: isOverRequest ? '#FC3841' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {percentage}
                      </div>
                    </div>
                  );
                })}
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
                    hide
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
        {timelinePoints.length > 0 && (
          <div style={rowLayout}>
            <div style={{ fontSize: 12, color: '#64748b' }}>Elapsed time</div>
            <div style={{ height: 36, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelinePoints} margin={{ top: 0, right: 8, left: 8, bottom: 2 }}>
                  <XAxis
                    dataKey="relativeTime"
                    height={30}
                    tick={({ x, y, payload }) => (
                      <text
                        x={x}
                        y={y}
                        dy="0.71em"
                        fontSize={12}
                        fill="#666"
                        textAnchor={payload.value === timelinePoints[0].relativeTime
                          ? 'start'
                          : payload.value === timelinePoints[timelinePoints.length - 1].relativeTime ? 'end' : 'middle'}
                      >
                        {payload.value}
                      </text>
                    )}
                    interval="preserveStartEnd"
                    minTickGap={36}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
      )}
    </section>
  );
}
