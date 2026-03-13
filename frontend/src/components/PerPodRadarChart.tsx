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

type RadarRow = {
  name: string;
  usage: number;
  request: number;
  usagePctOfRequest: number;
};

type Props = {
  title: string;
  rows: RadarRow[];
  unit: string;
  color: string;
  isPinned: boolean;
};

export default function PerPodRadarChart({ title, rows, unit, color, isPinned }: Props) {
  return (
    <section style={{ background: isPinned ? '#e5e7eb' : '#fff', border: '1px solid #dbe1ea', borderRadius: 8, padding: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      <div style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={rows} margin={{ top: 8, right: 20, bottom: 8, left: 20 }}>
            <PolarGrid />
            <PolarAngleAxis dataKey="name" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fontSize: 10 }}
              tickFormatter={value => `${value}%`}
            />
            <Tooltip
              offset={80}
              formatter={(value: number, _name, entry) => {
                const row = entry.payload as RadarRow;
                const usageLabel = `${row.usage.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;
                const requestLabel = `${row.request.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;
                return [`${usageLabel} / ${requestLabel}`, 'Usage / Request'];
              }}
            />
            <Radar
              name="Usage (% of request)"
              dataKey="usagePctOfRequest"
              stroke={color}
              fill={color}
              fillOpacity={0.35}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
