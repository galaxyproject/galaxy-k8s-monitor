import React, { useId } from 'react';
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
import {
  ACTIVE_SAMPLE_LINE_COLOR,
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_SELECTION_FILL,
  getGroupColor,
  REQUEST_LINE_COLOR,
  type GroupColorMap
} from '../lib/colors';

type Point = Record<string, number | string>;

export type ZoomRange = {
  startSampleIndex: number;
  endSampleIndex: number;
};

type Props = {
  title: string;
  data: Point[];
  podGroups: string[];
  metric: 'cpu' | 'memory';
  groupColorMap?: GroupColorMap;
  onPointClick?: (sampleIndex: number) => void;
  onPinTimestamp?: (timestamp: string | null) => void;
  pinnedTimestamp?: string | null;
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
  payload?: Array<{ name: string; value: number; color: string; dataKey?: string; payload: Point }>;
  label?: string;
  metric: 'cpu' | 'memory';
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const totalKey = metric === 'cpu' ? 'totalCPU' : 'totalMemoryMiB';
  const requestKey = metric === 'cpu' ? 'totalCpuRequest' : 'totalMemRequestMiB';
  const unit = metric === 'cpu' ? 'm' : ' MiB';
  const point = payload[0].payload;
  const total = (point[totalKey] as number) ?? 0;
  const totalRequest = (point[requestKey] as number) ?? 0;
  const isOverRequest = totalRequest > 0 && total > totalRequest;
  const timestamp = (point.timestamp as string | undefined) ?? '-';
  const formattedTimestamp = timestamp === '-' ? timestamp : new Date(timestamp).toLocaleString();

  const podEntries = payload.filter(entry => entry.dataKey !== requestKey);

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-meta">Elapsed time: {label}</div>
      <div className="chart-tooltip-meta">Timestamp: {formattedTimestamp}</div>
      <div className="chart-tooltip-total">
        <div>
          Total usage: {total.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}
        </div>
        <div style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--monitor-grey)', marginTop: 2 }}>
          Total request: {totalRequest.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}
          {isOverRequest && (
            <span className="text-overdraw" style={{ marginLeft: 6 }}>
              (Over request)
            </span>
          )}
        </div>
      </div>
      <div className="chart-tooltip-list">
        {podEntries.map(entry => (
          <div key={entry.name} className="chart-tooltip-row">
            <span className="chart-tooltip-series">
              <span
                className="color-swatch"
                style={{ background: entry.color }}
                aria-hidden="true"
              />
              <span>{entry.name}</span>
            </span>
            <strong>
              {Number(entry.value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}
            </strong>
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
  groupColorMap,
  onPointClick,
  onPinTimestamp,
  pinnedTimestamp,
  activeSampleIndex,
  zoomRange,
  onZoomRangeChange
}: Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [dragStartSampleIndex, setDragStartSampleIndex] = React.useState<number | null>(null);
  const [dragEndSampleIndex, setDragEndSampleIndex] = React.useState<number | null>(null);
  const suppressNextClickRef = React.useRef(false);
  const panelBodyId = useId();
  const pinSelectId = useId();

  const unit = metric === 'cpu' ? 'm' : ' MiB';
  const requestKey = metric === 'cpu' ? 'totalCpuRequest' : 'totalMemRequestMiB';
  const field = metric === 'cpu' ? 'cpu' : 'memoryMiB';
  const requestField = metric === 'cpu' ? 'cpuRequest' : 'memoryRequestMiB';

  const displayedData = React.useMemo(() => {
    if (!zoomRange) {
      return data;
    }

    return data.filter(point => {
      const sampleIndex = point.sampleIndex;
      return (
        typeof sampleIndex === 'number' &&
        sampleIndex >= zoomRange.startSampleIndex &&
        sampleIndex <= zoomRange.endSampleIndex
      );
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

  const zoomWindowLabel = React.useMemo(() => {
    if (!zoomRange) {
      return null;
    }
    const startLabel = getRelativeTimeBySampleIndex(zoomRange.startSampleIndex) ?? `#${zoomRange.startSampleIndex}`;
    const endLabel = getRelativeTimeBySampleIndex(zoomRange.endSampleIndex) ?? `#${zoomRange.endSampleIndex}`;
    return `${startLabel} – ${endLabel}`;
  }, [zoomRange, data]);

  const tableRows = React.useMemo(() => {
    const latestPoint = displayedData[displayedData.length - 1];
    return podGroups.map((group, index) => {
      const color = getGroupColor(groupColorMap, group, index);
      const values = displayedData.map(point => Number(point[`${group}.${field}`] ?? 0));
      const latest = latestPoint ? Number(latestPoint[`${group}.${field}`] ?? 0) : 0;
      const latestReq = latestPoint ? Number(latestPoint[`${group}.${requestField}`] ?? 0) : 0;
      const average = values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0;
      const peak = values.reduce((max, val) => Math.max(max, val), 0);
      const isOver = latestReq > 0 && latest > latestReq;

      return {
        group,
        color,
        latest,
        average,
        peak,
        latestReq,
        isOver
      };
    });
  }, [displayedData, podGroups, groupColorMap, field, requestField]);

  const activePoint =
    activeSampleIndex !== undefined && activeSampleIndex >= 0
      ? displayedData.find(point => point.sampleIndex === activeSampleIndex)
      : undefined;
  const activeTimestampValue = (activePoint?.timestamp as string | undefined) ?? '';

  return (
    <section className="panel" aria-label={title}>
      <div className="panel-header" data-collapsed={collapsed ? 'true' : 'false'}>
        <div className="panel-title-group">
          <h3 className="panel-title">{title}</h3>
          <span className="panel-subtitle">
            Drag across chart to zoom · Click a datapoint to pin radar
          </span>
        </div>

        <div className="panel-header-actions" data-no-print>
          {zoomRange && zoomWindowLabel && (
            <>
              <span className="badge-scope" title="Active zoom window">
                Zoom: {zoomWindowLabel}
              </span>
              <button
                type="button"
                className="btn-compact"
                onClick={() => {
                  onZoomRangeChange?.(null);
                  setDragStartSampleIndex(null);
                  setDragEndSampleIndex(null);
                }}
              >
                Reset zoom
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-compact"
            aria-expanded={!collapsed}
            aria-controls={panelBodyId}
            onClick={() => setCollapsed(previous => !previous)}
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div id={panelBodyId}>
          <div className="panel-body">
            <div style={{ height: 320, position: 'relative' }}>
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

                    const point = state.activePayload?.[0]?.payload;
                    const timestamp = point?.timestamp;
                    if (typeof timestamp === 'string' && onPinTimestamp) {
                      onPinTimestamp(timestamp);
                      return;
                    }

                    const sampleIndex = getSampleIndexFromState(state);
                    if (typeof sampleIndex === 'number' && onPointClick) {
                      onPointClick(sampleIndex);
                    }
                  }}
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
                    tickFormatter={(value: number) => value.toLocaleString()}
                  />
                  <Tooltip
                    content={<CumulativeTooltip metric={metric} />}
                    formatter={(value: number) => formatValue(value)}
                    offset={24}
                    wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 13, paddingTop: 6 }} />

                  {dragStartSampleIndex !== null && dragEndSampleIndex !== null && (
                    <ReferenceArea
                      x1={getRelativeTimeBySampleIndex(Math.min(dragStartSampleIndex, dragEndSampleIndex)) ?? undefined}
                      x2={getRelativeTimeBySampleIndex(Math.max(dragStartSampleIndex, dragEndSampleIndex)) ?? undefined}
                      fill={CHART_SELECTION_FILL}
                      fillOpacity={0.18}
                    />
                  )}

                  {activeSampleIndex !== undefined && activeSampleIndex >= 0 && (
                    (() => {
                      const activePt = displayedData.find(point => point.sampleIndex === activeSampleIndex);
                      const relativeTime = activePt?.relativeTime;

                      if (typeof relativeTime !== 'string') {
                        return null;
                      }

                      return (
                        <ReferenceLine
                          x={relativeTime}
                          stroke={ACTIVE_SAMPLE_LINE_COLOR}
                          strokeDasharray="3 3"
                          strokeWidth={1.5}
                          strokeOpacity={0.85}
                        />
                      );
                    })()
                  )}

                  {podGroups.map((group, index) => {
                    const seriesColor = getGroupColor(groupColorMap, group, index);
                    return (
                      <Area
                        key={group}
                        dataKey={`${group}.${field}`}
                        stackId="usage"
                        stroke={seriesColor}
                        strokeWidth={1.5}
                        fill={seriesColor}
                        fillOpacity={0.58}
                        name={group}
                        isAnimationActive={false}
                      />
                    );
                  })}

                  <Line
                    type="monotone"
                    dataKey={requestKey}
                    stroke={REQUEST_LINE_COLOR}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    name="Total request"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <details className="inline-details" data-no-print>
            <summary>Tabular summary &amp; keyboard sample pinning ({title})</summary>

            {displayedData.length > 0 && (onPinTimestamp || onPointClick) && (
              <div className="details-controls">
                <label htmlFor={pinSelectId}>
                  Inspect / pin sample:
                  <select
                    id={pinSelectId}
                    value={pinnedTimestamp ?? activeTimestampValue}
                    onChange={event => {
                      const nextTs = event.target.value;
                      if (onPinTimestamp) {
                        onPinTimestamp(nextTs || null);
                      } else if (onPointClick) {
                        const found = displayedData.find(pt => pt.timestamp === nextTs);
                        if (found && typeof found.sampleIndex === 'number') {
                          onPointClick(found.sampleIndex);
                        }
                      }
                    }}
                  >
                    {displayedData.map(point => {
                      const ts = String(point.timestamp ?? '');
                      const rel = String(point.relativeTime ?? '');
                      const formatted = ts ? new Date(ts).toLocaleTimeString() : rel;
                      return (
                        <option key={ts || String(point.sampleIndex)} value={ts}>
                          {rel} ({formatted})
                        </option>
                      );
                    })}
                  </select>
                </label>
                {pinnedTimestamp && onPinTimestamp && (
                  <button
                    type="button"
                    className="btn-compact"
                    onClick={() => onPinTimestamp(null)}
                  >
                    Unpin (follow latest)
                  </button>
                )}
              </div>
            )}

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Pod Group</th>
                    <th scope="col" className="num">Latest</th>
                    <th scope="col" className="num">Average</th>
                    <th scope="col" className="num">Peak</th>
                    <th scope="col" className="num">Request</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(row => (
                    <tr key={row.group}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span
                            className="color-swatch"
                            style={{ background: row.color }}
                            aria-hidden="true"
                          />
                          <strong>{row.group}</strong>
                        </span>
                      </td>
                      <td className="num">{formatValue(row.latest)}</td>
                      <td className="num">{formatValue(row.average)}</td>
                      <td className="num">{formatValue(row.peak)}</td>
                      <td className="num">
                        {row.latestReq > 0 ? formatValue(row.latestReq) : 'No request'}
                      </td>
                      <td className={row.isOver ? 'text-overdraw' : undefined}>
                        {row.latestReq <= 0
                          ? 'No request configured'
                          : row.isOver
                            ? 'Over request'
                            : 'Within request'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
