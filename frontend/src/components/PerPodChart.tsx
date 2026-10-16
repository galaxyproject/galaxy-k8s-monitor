import React, { useId } from 'react';
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
import {
  ACTIVE_SAMPLE_LINE_COLOR,
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  OVERDRAW_COLOR,
  REQUEST_LINE_COLOR
} from '../lib/colors';
import { formatElapsedAxisTick } from '../lib/units';

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
  onPinTimestamp?: (timestamp: string | null) => void;
  activeRelativeTime?: string;
  zoomRange?: { startSampleIndex: number; endSampleIndex: number } | null;
};

function PerPodTooltip({
  active,
  payload,
  label,
  unit,
  podName,
  podColor,
  request
}: {
  active?: boolean;
  payload?: Array<{ payload: { currentUsage?: number; timestamp?: string } }>;
  label?: string;
  unit: string;
  podName: string;
  podColor: string;
  request: number;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const currentUsage = payload[0].payload.currentUsage ?? 0;
  const timestamp = payload[0].payload.timestamp ?? '-';
  const formattedTimestamp = timestamp === '-' ? timestamp : new Date(timestamp).toLocaleString();
  const hasRequest = request > 0;
  const pctOfRequest = hasRequest ? Math.round((currentUsage / request) * 100) : null;
  const isOverRequest = hasRequest && currentUsage > request;
  const overAmount = isOverRequest ? currentUsage - request : 0;

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-meta">
        Elapsed time: {label ? formatElapsedAxisTick(String(label)) : '-'}
      </div>
      <div className="chart-tooltip-meta">Timestamp: {formattedTimestamp}</div>
      <div className="chart-tooltip-total" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="color-swatch" style={{ background: podColor }} aria-hidden="true" />
        <span>{podName}</span>
      </div>
      <div className="chart-tooltip-list">
        <div className="chart-tooltip-row">
          <span>Current usage</span>
          <strong className={isOverRequest ? 'text-overdraw' : undefined}>
            {currentUsage.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}
          </strong>
        </div>
        <div className="chart-tooltip-row">
          <span>Request</span>
          <strong>
            {hasRequest
              ? `${request.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`
              : 'No request'}
          </strong>
        </div>
        <div className="chart-tooltip-row">
          <span>% of request</span>
          <strong className={isOverRequest ? 'text-overdraw' : undefined}>
            {pctOfRequest !== null ? `${pctOfRequest}%` : 'n/a'}
          </strong>
        </div>
        {isOverRequest && (
          <div className="chart-tooltip-row text-overdraw">
            <span>Over request</span>
            <strong>
              +{overAmount.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit}
            </strong>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PerPodChart({
  title,
  series,
  unit,
  onPointClick,
  onPinTimestamp,
  activeRelativeTime,
  zoomRange
}: Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  const panelBodyId = useId();

  const formatNumber = (value: number): string =>
    value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const formatValue = (value: number): string => `${formatNumber(value)}${unit}`;
  const percentOfRequest = (value: number, request: number): string => {
    if (request <= 0) {
      return 'n/a';
    }

    return `${Math.round((value / request) * 100)}%`;
  };

  const displayedPointsFor = (seriesRow: Series) =>
    zoomRange
      ? seriesRow.points.filter(
          point =>
            point.sampleIndex >= zoomRange.startSampleIndex &&
            point.sampleIndex <= zoomRange.endSampleIndex
        )
      : seriesRow.points;

  const timelinePoints = series.length > 0 ? displayedPointsFor(series[0]) : [];

  const withInverseOverflow = (seriesRow: Series) => {
    const visiblePoints = displayedPointsFor(seriesRow);

    if (visiblePoints.length === 0) {
      return [] as Array<
        Series['points'][number] & {
          displayUsage: number;
          currentUsage: number;
          overflowFloor: number;
        }
      >;
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

  const computedRows = series.map(podSeries => {
    const displayedPoints = displayedPointsFor(podSeries);
    const currentUsage = displayedPoints[displayedPoints.length - 1]?.usage ?? 0;
    const maxRecorded = displayedPoints.reduce((max, point) => Math.max(max, point.usage), 0);
    const averageUsage =
      displayedPoints.length > 0
        ? displayedPoints.reduce((sum, point) => sum + point.usage, 0) / displayedPoints.length
        : 0;
    const sortedUsage = displayedPoints
      .map(point => point.usage)
      .sort((left, right) => left - right);
    const p95Usage = sortedUsage[Math.ceil(sortedUsage.length * 0.95) - 1] ?? 0;

    return {
      podSeries,
      currentUsage,
      averageUsage,
      p95Usage,
      maxRecorded
    };
  });

  return (
    <section className="panel" aria-label={title}>
      <div className="panel-header" data-collapsed={collapsed ? 'true' : 'false'}>
        <div className="panel-title-group">
          <h3 className="panel-title">{title}</h3>
          <div className="chart-key" aria-label="Horizon chart encoding key">
            <span className="chart-key-item">
              <span className="key-line-dashed" aria-hidden="true" />
              <span>Request ceiling (100%)</span>
            </span>
            <span className="chart-key-item">
              <span className="key-swatch-overdraw" aria-hidden="true" />
              <span>Over request (mirrored downward)</span>
            </span>
          </div>
        </div>

        <div className="panel-header-actions" data-no-print>
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
            <div className="horizon-list">
              {computedRows.map(({ podSeries, currentUsage, averageUsage, p95Usage, maxRecorded }) => {
                const summaryMetrics = [
                  { label: 'Current', description: 'Current usage', value: currentUsage },
                  {
                    label: 'Avg',
                    description: 'Average usage over the displayed time range',
                    value: averageUsage
                  },
                  {
                    label: 'P95',
                    description:
                      '95th percentile usage over the displayed time range (nearest rank)',
                    value: p95Usage
                  },
                  {
                    label: 'Max',
                    description: 'Maximum usage over the displayed time range',
                    value: maxRecorded
                  }
                ];

                return (
                  <div key={podSeries.name} className="horizon-row">
                    <div className="horizon-summary">
                      <div className="horizon-pod-header">
                        <div className="horizon-pod-title" title={podSeries.name}>
                          <span
                            className="color-swatch"
                            style={{ background: podSeries.color }}
                            aria-hidden="true"
                          />
                          <span className="horizon-pod-name">{podSeries.name}</span>
                        </div>
                        <div
                          className="horizon-pod-req"
                          title={
                            podSeries.request > 0
                              ? `Request: ${formatValue(podSeries.request)}. All usage values are in ${unit.trim()}.`
                              : `No resource request configured for ${podSeries.name}.`
                          }
                        >
                          {podSeries.request > 0
                            ? `Req: ${formatValue(podSeries.request)}`
                            : 'Req: none'}
                        </div>
                      </div>

                      <div className="horizon-metrics-grid">
                        {summaryMetrics.map(metric => {
                          const isOverRequest =
                            podSeries.request > 0 && metric.value > podSeries.request;
                          const percentage = percentOfRequest(metric.value, podSeries.request);
                          const description = `${metric.description}: ${formatValue(metric.value)}. ${
                            podSeries.request > 0
                              ? `${percentage} of request.${isOverRequest ? ' Over request.' : ''}`
                              : 'No request configured.'
                          }`;

                          return (
                            <div
                              key={metric.label}
                              title={description}
                              className="horizon-metric-cell"
                            >
                              <div className="horizon-metric-label">{metric.label}</div>
                              <div
                                className={`horizon-metric-val${isOverRequest ? ' text-overdraw' : ''}`}
                              >
                                {formatNumber(metric.value)}
                              </div>
                              <div
                                className={`horizon-metric-pct${isOverRequest ? ' text-overdraw' : ''}`}
                              >
                                {percentage}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ height: 68, minWidth: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={withInverseOverflow(podSeries)}
                          margin={{ top: 6, right: 8, left: 8, bottom: 2 }}
                          onClick={(state: {
                            activePayload?: Array<{
                              payload?: { sampleIndex?: number; timestamp?: string };
                            }>;
                          }) => {
                            const payload = state.activePayload?.[0]?.payload;
                            if (typeof payload?.timestamp === 'string' && onPinTimestamp) {
                              onPinTimestamp(payload.timestamp);
                              return;
                            }

                            const sampleIndex = payload?.sampleIndex;
                            if (typeof sampleIndex === 'number' && onPointClick) {
                              onPointClick(sampleIndex);
                            }
                          }}
                        >
                          <CartesianGrid
                            stroke={CHART_GRID_COLOR}
                            strokeDasharray="2 2"
                            vertical={false}
                          />
                          <XAxis dataKey="relativeTime" hide />
                          <YAxis
                            hide
                            domain={[
                              0,
                              podSeries.request > 0 ? podSeries.request : podSeries.axisCeiling
                            ]}
                          />
                          <Tooltip
                            content={
                              <PerPodTooltip
                                unit={unit}
                                podName={podSeries.name}
                                podColor={podSeries.color}
                                request={podSeries.request}
                              />
                            }
                            offset={20}
                            wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                          />
                          {podSeries.request > 0 && (
                            <ReferenceLine
                              y={podSeries.request}
                              stroke={REQUEST_LINE_COLOR}
                              strokeDasharray="4 4"
                              strokeWidth={1.5}
                              strokeOpacity={0.85}
                            />
                          )}
                          {activeRelativeTime && (
                            <ReferenceLine
                              x={activeRelativeTime}
                              stroke={ACTIVE_SAMPLE_LINE_COLOR}
                              strokeDasharray="2 3"
                              strokeWidth={1.5}
                              strokeOpacity={0.8}
                            />
                          )}
                          <Area
                            type="monotone"
                            dataKey="displayUsage"
                            stroke="none"
                            fill={podSeries.color}
                            fillOpacity={0.32}
                            isAnimationActive={false}
                          />
                          {podSeries.request > 0 && (
                            <Area
                              type="monotone"
                              dataKey="overflowFloor"
                              stroke="none"
                              fill={OVERDRAW_COLOR}
                              fillOpacity={0.38}
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
              })}

              {timelinePoints.length > 0 && (
                <div className="horizon-axis-row">
                  <div style={{ fontSize: '0.82rem', color: 'var(--monitor-grey)', fontWeight: 700 }}>
                    Elapsed time
                  </div>
                  <div style={{ height: 36, minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={timelinePoints}
                        margin={{ top: 0, right: 8, left: 8, bottom: 2 }}
                      >
                        <XAxis
                          dataKey="relativeTime"
                          height={30}
                          stroke={CHART_AXIS_COLOR}
                          tick={({ x, y, payload }) => (
                            <text
                              x={x}
                              y={y}
                              dy="0.71em"
                              fontSize={13}
                              fill={CHART_AXIS_COLOR}
                              textAnchor={
                                payload.value === timelinePoints[0].relativeTime
                                  ? 'start'
                                  : payload.value ===
                                      timelinePoints[timelinePoints.length - 1].relativeTime
                                    ? 'end'
                                    : 'middle'
                              }
                            >
                              {formatElapsedAxisTick(String(payload.value))}
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
          </div>

          <details className="inline-details" data-no-print>
            <summary>Tabular summary ({title})</summary>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Pod Group</th>
                    <th scope="col" className="num">Current</th>
                    <th scope="col" className="num">Avg</th>
                    <th scope="col" className="num">P95</th>
                    <th scope="col" className="num">Max</th>
                    <th scope="col" className="num">Request</th>
                    <th scope="col" className="num">Max % of Req</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {computedRows.map(({ podSeries, currentUsage, averageUsage, p95Usage, maxRecorded }) => {
                    const isMaxOver = podSeries.request > 0 && maxRecorded > podSeries.request;
                    const isCurrentOver =
                      podSeries.request > 0 && currentUsage > podSeries.request;

                    return (
                      <tr key={podSeries.name}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span
                              className="color-swatch"
                              style={{ background: podSeries.color }}
                              aria-hidden="true"
                            />
                            <strong>{podSeries.name}</strong>
                          </span>
                        </td>
                        <td className={`num${isCurrentOver ? ' text-overdraw' : ''}`}>
                          {formatValue(currentUsage)}
                        </td>
                        <td className="num">{formatValue(averageUsage)}</td>
                        <td className="num">{formatValue(p95Usage)}</td>
                        <td className={`num${isMaxOver ? ' text-overdraw' : ''}`}>
                          {formatValue(maxRecorded)}
                        </td>
                        <td className="num">
                          {podSeries.request > 0 ? formatValue(podSeries.request) : 'No request'}
                        </td>
                        <td className={`num${isMaxOver ? ' text-overdraw' : ''}`}>
                          {percentOfRequest(maxRecorded, podSeries.request)}
                        </td>
                        <td className={isMaxOver ? 'text-overdraw' : undefined}>
                          {podSeries.request <= 0
                            ? 'No request configured'
                            : isCurrentOver
                              ? 'Currently over request'
                              : isMaxOver
                                ? 'Peak exceeded request'
                                : 'Within request'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
