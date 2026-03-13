import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { POD_GROUP_PALETTE } from '../lib/colors';

type Point = Record<string, number | string>;

type ZoomRange = {
  startSampleIndex: number;
  endSampleIndex: number;
};

type Props = {
  title: string;
  data: Point[];
  podGroups: string[];
  metric: 'cpu' | 'memory';
  onPointClick?: (sampleIndex: number) => void;
  activeSampleIndex?: number;
  zoomRange?: ZoomRange | null;
  onZoomRangeChange?: (range: ZoomRange | null) => void;
};

function CumulativeTooltip({
  active,
  payload,
  label,
  metric
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; payload: Point }>;
  label?: string;
  metric: 'cpu' | 'memory';
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const totalKey = metric === 'cpu' ? 'totalCPU' : 'totalMemoryMiB';
  const unit = metric === 'cpu' ? 'm' : ' MiB';
  const total = (payload[0].payload[totalKey] as number) ?? 0;
  const timestamp = (payload[0].payload.timestamp as string | undefined) ?? '-';
  const formattedTimestamp = timestamp === '-' ? timestamp : new Date(timestamp).toLocaleString();

  return (
    <div style={{ background: '#fff', border: '1px solid #dbe1ea', borderRadius: 8, padding: 10, minWidth: 220 }}>
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Datapoint time: {label}</div>
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 6 }}>Timestamp: {formattedTimestamp}</div>
      <div style={{ fontSize: 12, marginBottom: 8 }}>
        Sum: {total.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {payload.map(entry => (
          <div key={entry.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
            <span style={{ color: entry.color }}>{entry.name}</span>
            <span>{entry.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CumulativeChart({
  title,
  data,
  podGroups,
  metric,
  onPointClick,
  activeSampleIndex,
  zoomRange,
  onZoomRangeChange
}: Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [dragStartSampleIndex, setDragStartSampleIndex] = React.useState<number | null>(null);
  const [dragEndSampleIndex, setDragEndSampleIndex] = React.useState<number | null>(null);
  const suppressNextClickRef = React.useRef(false);

  const unit = metric === 'cpu' ? 'm' : ' MiB';
  const requestKey = metric === 'cpu' ? 'totalCpuRequest' : 'totalMemRequestMiB';
  const field = metric === 'cpu' ? 'cpu' : 'memoryMiB';

  const displayedData = React.useMemo(() => {
    if (!zoomRange) {
      return data;
    }

    return data.filter(point => {
      const sampleIndex = point.sampleIndex;
      return typeof sampleIndex === 'number' && sampleIndex >= zoomRange.startSampleIndex && sampleIndex <= zoomRange.endSampleIndex;
    });
  }, [data, zoomRange]);

  const getSampleIndexFromState = (state: { activePayload?: Array<{ payload?: Point }> }): number | null => {
    const point = state.activePayload?.[0]?.payload;
    const sampleIndex = point?.sampleIndex;
    return typeof sampleIndex === 'number' ? sampleIndex : null;
  };

  const getRelativeTimeBySampleIndex = (sampleIndex: number): string | null => {
    const point = data.find(entry => entry.sampleIndex === sampleIndex);
    const relativeTime = point?.relativeTime;
    return typeof relativeTime === 'string' ? relativeTime : null;
  };

  const xAxisTicks = React.useMemo(() => {
    const maxTickCount = 10;

    if (displayedData.length === 0) {
      return [] as string[];
    }

    if (displayedData.length <= maxTickCount) {
      return displayedData
        .map(point => point.relativeTime)
        .filter((value): value is string => typeof value === 'string');
    }

    const step = Math.ceil((displayedData.length - 1) / (maxTickCount - 1));
    const ticks: string[] = [];

    for (let index = 0; index < displayedData.length; index += step) {
      const value = displayedData[index].relativeTime;
      if (typeof value === 'string') {
        ticks.push(value);
      }
    }

    const lastValue = displayedData[displayedData.length - 1].relativeTime;
    if (typeof lastValue === 'string' && ticks[ticks.length - 1] !== lastValue) {
      ticks.push(lastValue);
    }

    return ticks;
  }, [displayedData]);

  const formatValue = (value: number): string =>
    `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;

  return (
    <section style={{ background: '#fff', border: '1px solid #dbe1ea', borderRadius: 8, padding: 12 }}>
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
        <div style={{ height: 320, marginBottom: 36, position: 'relative' }}>
          {zoomRange && (
            <button
              type="button"
              onClick={() => {
                onZoomRangeChange?.(null);
                setDragStartSampleIndex(null);
                setDragEndSampleIndex(null);
              }}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 2,
                border: '1px solid #cbd5e1',
                background: 'rgba(248, 250, 252, 0.95)',
                borderRadius: 999,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
                color: '#334155',
                fontWeight: 600
              }}
            >
              Reset zoom
            </button>
          )}

          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={displayedData}
              margin={{ top: 8, right: 20, left: 8, bottom: 8 }}
              onMouseDown={(state: { activePayload?: Array<{ payload?: Point }> }) => {
                const sampleIndex = getSampleIndexFromState(state);
                if (sampleIndex === null) {
                  return;
                }

                setDragStartSampleIndex(sampleIndex);
                setDragEndSampleIndex(sampleIndex);
              }}
              onMouseMove={(state: { activePayload?: Array<{ payload?: Point }> }) => {
                if (dragStartSampleIndex === null) {
                  return;
                }

                const sampleIndex = getSampleIndexFromState(state);
                if (sampleIndex === null) {
                  return;
                }

                setDragEndSampleIndex(sampleIndex);
              }}
              onMouseUp={(state: { activePayload?: Array<{ payload?: Point }> }) => {
                if (dragStartSampleIndex === null) {
                  return;
                }

                const fallbackSampleIndex = getSampleIndexFromState(state);
                const endSampleIndex = dragEndSampleIndex ?? fallbackSampleIndex;

                if (endSampleIndex !== null && endSampleIndex !== dragStartSampleIndex) {
                  const start = Math.min(dragStartSampleIndex, endSampleIndex);
                  const end = Math.max(dragStartSampleIndex, endSampleIndex);
                  onZoomRangeChange?.({ startSampleIndex: start, endSampleIndex: end });
                  suppressNextClickRef.current = true;
                }

                setDragStartSampleIndex(null);
                setDragEndSampleIndex(null);
              }}
              onClick={(state: { activePayload?: Array<{ payload?: Point }> }) => {
                if (suppressNextClickRef.current) {
                  suppressNextClickRef.current = false;
                  return;
                }

                const sampleIndex = getSampleIndexFromState(state);
                if (typeof sampleIndex === 'number' && onPointClick) {
                  onPointClick(sampleIndex);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="relativeTime" ticks={xAxisTicks} interval={0} minTickGap={36} />
              <YAxis tickFormatter={(value: number) => value.toLocaleString()} />
              <Tooltip content={<CumulativeTooltip metric={metric} />} formatter={(value: number) => formatValue(value)} offset={80} />
              <Legend />

              {dragStartSampleIndex !== null && dragEndSampleIndex !== null && (
                <ReferenceArea
                  x1={getRelativeTimeBySampleIndex(Math.min(dragStartSampleIndex, dragEndSampleIndex)) ?? undefined}
                  x2={getRelativeTimeBySampleIndex(Math.max(dragStartSampleIndex, dragEndSampleIndex)) ?? undefined}
                  fill="#94a3b8"
                  fillOpacity={0.2}
                />
              )}

              {activeSampleIndex !== undefined && activeSampleIndex >= 0 && (
                (() => {
                  const activePoint = displayedData.find(point => point.sampleIndex === activeSampleIndex);
                  const relativeTime = activePoint?.relativeTime;

                  if (typeof relativeTime !== 'string') {
                    return null;
                  }

                  return (
                    <ReferenceLine
                      x={relativeTime}
                      stroke="#111827"
                      strokeDasharray="2 3"
                      strokeOpacity={0.75}
                    />
                  );
                })()
              )}

              {podGroups.map((group, index) => (
                <Area
                  key={group}
                  dataKey={`${group}.${field}`}
                  stackId="usage"
                  stroke={POD_GROUP_PALETTE[index % POD_GROUP_PALETTE.length]}
                  fill={POD_GROUP_PALETTE[index % POD_GROUP_PALETTE.length]}
                  name={group}
                  isAnimationActive={false}
                />
              ))}

              <Line
                type="monotone"
                dataKey={requestKey}
                stroke="#111827"
                strokeDasharray="6 6"
                dot={false}
                name="Total request"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
