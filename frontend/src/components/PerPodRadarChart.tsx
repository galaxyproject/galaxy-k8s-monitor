import React from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip
} from 'recharts';
import { CHART_AXIS_COLOR, CHART_GRID_COLOR, OVERDRAW_COLOR } from '../lib/colors';

export type RadarRow = {
  name: string;
  usage: number;
  request: number;
  usagePctOfRequest: number;
  rawPctOfRequest?: number;
  hasRequest?: boolean;
};

type Props = {
  title: string;
  rows: RadarRow[];
  unit: string;
  color: string;
  isPinned: boolean;
};

function RadarTooltip({
  active,
  payload,
  unit
}: {
  active?: boolean;
  payload?: Array<{ payload: RadarRow }>;
  unit: string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const row = payload[0].payload;
  const hasRequest = row.hasRequest ?? row.request > 0;
  const rawPct =
    row.rawPctOfRequest ?? (hasRequest ? (row.usage / row.request) * 100 : 0);
  const isOverRequest = hasRequest && row.usage > row.request;
  const usageLabel = `${row.usage.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;
  const requestLabel = hasRequest
    ? `${row.request.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`
    : 'No request';

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-total">{row.name}</div>
      <div className="chart-tooltip-list">
        <div className="chart-tooltip-row">
          <span>Usage</span>
          <strong className={isOverRequest ? 'text-overdraw' : undefined}>{usageLabel}</strong>
        </div>
        <div className="chart-tooltip-row">
          <span>Request</span>
          <strong>{requestLabel}</strong>
        </div>
        <div className="chart-tooltip-row">
          <span>% of request</span>
          <strong className={isOverRequest ? 'text-overdraw' : undefined}>
            {hasRequest ? `${rawPct.toFixed(1)}%` : 'No request'}
          </strong>
        </div>
        {isOverRequest && (
          <div className="chart-tooltip-row text-overdraw">
            <span>Status</span>
            <strong>Over request (capped at 100% on radar)</strong>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PerPodRadarChart({ title, rows, unit, color, isPinned }: Props) {
  const overRequestRows = rows.filter(row => {
    const hasReq = row.hasRequest ?? row.request > 0;
    return hasReq && row.usage > row.request;
  });

  const noRequestRows = rows.filter(row => {
    const hasReq = row.hasRequest ?? row.request > 0;
    return !hasReq;
  });

  const formatValue = (val: number) =>
    `${val.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;

  return (
    <section
      className="panel"
      data-pinned={isPinned ? 'true' : 'false'}
      aria-label={title}
    >
      <div className="panel-header">
        <div className="panel-title-group">
          <h4 className="panel-title" style={{ fontSize: '1.05rem' }}>
            {title}
          </h4>
          {isPinned && <span className="badge-pinned">Pinned</span>}
        </div>
      </div>

      <div className="panel-body">
        {rows.length === 0 ? (
          <div style={{ color: 'var(--monitor-grey)', fontSize: '0.9rem' }}>
            No pod groups selected.
          </div>
        ) : rows.length < 3 ? (
          <div>
            <p className="panel-subtitle" style={{ marginBottom: '0.75rem' }}>
              Showing horizontal request comparison for {rows.length}{' '}
              {rows.length === 1 ? 'pod group' : 'pod groups'} (radar polygon requires 3 or more
              groups).
            </p>
            <div className="radar-fallback-list">
              {rows.map(row => {
                const hasReq = row.hasRequest ?? row.request > 0;
                const rawPct =
                  row.rawPctOfRequest ?? (hasReq ? (row.usage / row.request) * 100 : 0);
                const clampedPct = hasReq ? Math.max(0, Math.min(100, rawPct)) : 0;
                const isOver = hasReq && row.usage > row.request;

                return (
                  <div key={row.name} className="radar-fallback-item">
                    <div className="radar-fallback-head">
                      <strong>{row.name}</strong>
                      <span className={isOver ? 'text-overdraw tabular-nums' : 'tabular-nums'}>
                        {formatValue(row.usage)} /{' '}
                        {hasReq ? formatValue(row.request) : 'No request'}{' '}
                        {hasReq ? `(${rawPct.toFixed(1)}%)` : '(No request)'}
                        {isOver ? ' · Over request' : ''}
                      </span>
                    </div>
                    <div className="stat-meter">
                      <div
                        className="stat-meter-fill"
                        style={{
                          width: `${clampedPct}%`,
                          background: isOver ? OVERDRAW_COLOR : color
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <div style={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={rows} margin={{ top: 12, right: 28, bottom: 12, left: 28 }}>
                  <PolarGrid stroke={CHART_GRID_COLOR} />
                  <PolarAngleAxis
                    dataKey="name"
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }}
                  />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 100]}
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                    tickFormatter={value => `${value}%`}
                  />
                  <Tooltip
                    content={<RadarTooltip unit={unit} />}
                    offset={24}
                    wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                  />
                  <Radar
                    name="Usage (% of request)"
                    dataKey="usagePctOfRequest"
                    stroke={color}
                    strokeWidth={2}
                    fill={color}
                    fillOpacity={0.32}
                    isAnimationActive={false}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {(overRequestRows.length > 0 || noRequestRows.length > 0) && (
              <div
                style={{
                  marginTop: '0.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  fontSize: '0.82rem'
                }}
              >
                {overRequestRows.length > 0 && (
                  <div className="text-overdraw">
                    Over request (&gt;100%):{' '}
                    {overRequestRows
                      .map(row => {
                        const rawPct =
                          row.rawPctOfRequest ?? (row.usage / row.request) * 100;
                        return `${row.name} (${rawPct.toFixed(0)}%)`;
                      })
                      .join(', ')}
                  </div>
                )}
                {noRequestRows.length > 0 && (
                  <div style={{ color: 'var(--monitor-grey)' }}>
                    No request configured (plotted at 0%):{' '}
                    {noRequestRows
                      .map(row => `${row.name} (${formatValue(row.usage)})`)
                      .join(', ')}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {rows.length > 0 && (
        <details className="inline-details" data-no-print>
          <summary>Tabular summary ({title})</summary>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Pod Group</th>
                  <th scope="col" className="num">Usage</th>
                  <th scope="col" className="num">Request</th>
                  <th scope="col" className="num">% of Request</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const hasReq = row.hasRequest ?? row.request > 0;
                  const rawPct =
                    row.rawPctOfRequest ?? (hasReq ? (row.usage / row.request) * 100 : 0);
                  const isOver = hasReq && row.usage > row.request;

                  return (
                    <tr key={row.name}>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td className={`num${isOver ? ' text-overdraw' : ''}`}>
                        {formatValue(row.usage)}
                      </td>
                      <td className="num">
                        {hasReq ? formatValue(row.request) : 'No request'}
                      </td>
                      <td className={`num${isOver ? ' text-overdraw' : ''}`}>
                        {hasReq ? `${rawPct.toFixed(1)}%` : 'No request'}
                      </td>
                      <td className={isOver ? 'text-overdraw' : undefined}>
                        {!hasReq
                          ? 'No request'
                          : isOver
                            ? 'Over request'
                            : 'Within request'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
