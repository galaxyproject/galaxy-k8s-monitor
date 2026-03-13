import React from 'react';
import { POD_GROUP_PALETTE } from '../lib/colors';

type Timeframe = '10m' | '1h' | '8h' | 'all';

type Props = {
  podGroups: string[];
  selectedGroups: Set<string>;
  selectedTimeframe: Timeframe;
  onToggleGroup: (name: string) => void;
  onSelectOnly: (name: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectGalaxy: () => void;
  onTimeframeChange: (timeframe: Timeframe) => void;
};

export default function PodGroupFilter({
  podGroups,
  selectedGroups,
  selectedTimeframe,
  onToggleGroup,
  onSelectOnly,
  onSelectAll,
  onSelectNone,
  onSelectGalaxy,
  onTimeframeChange
}: Props) {
  const [hoveredGroup, setHoveredGroup] = React.useState<string | null>(null);

  return (
    <aside style={{ width: '100%', boxSizing: 'border-box', background: '#fff', border: '1px solid #dbe1ea', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong>Pod Groups</strong>
        <span style={{ color: '#4b5563', fontSize: 12 }}>{selectedGroups.size}/{podGroups.length}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <button
          onClick={onSelectAll}
          style={{
            padding: '5px 12px',
            cursor: 'pointer',
            border: '1px solid #60A3BC',
            borderRadius: 999,
            background: '#E8F3F7',
            color: '#1f4f63',
            fontSize: 12,
            fontWeight: 600
          }}
        >
          All
        </button>
        <button
          onClick={onSelectNone}
          style={{
            padding: '5px 12px',
            cursor: 'pointer',
            border: '1px solid #E66767',
            borderRadius: 999,
            background: '#FDECEC',
            color: '#7f1d1d',
            fontSize: 12,
            fontWeight: 600
          }}
        >
          None
        </button>
        <button
          onClick={onSelectGalaxy}
          style={{
            padding: '5px 12px',
            cursor: 'pointer',
            border: '1px solid #A29BFE',
            borderRadius: 999,
            background: '#F1EEFF',
            color: '#4c1d95',
            fontSize: 12,
            fontWeight: 600
          }}
        >
          Galaxy
        </button>
      </div>

      <div style={{ maxHeight: '72vh', overflowY: 'auto' }}>
        {podGroups.map((group, index) => (
          <div
            key={group}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}
            onMouseEnter={() => setHoveredGroup(group)}
            onMouseLeave={() => setHoveredGroup(current => (current === group ? null : current))}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
              <input
                type="checkbox"
                checked={selectedGroups.has(group)}
                onChange={() => onToggleGroup(group)}
              />
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: POD_GROUP_PALETTE[index % POD_GROUP_PALETTE.length],
                  display: 'inline-block'
                }}
              />
              <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group}</span>
            </label>

            <button
              type="button"
              onClick={() => onSelectOnly(group)}
              style={{
                visibility: hoveredGroup === group ? 'visible' : 'hidden',
                border: 'none',
                background: 'transparent',
                color: '#2563eb',
                cursor: 'pointer',
                fontSize: 12,
                padding: '0 8px 0 0',
                lineHeight: 1.2
              }}
              aria-label={`Select only ${group}`}
            >
              Only
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ marginBottom: 6 }}>
          <strong>Timeframe</strong>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            { value: '10m', label: '10 minutes' },
            { value: '1h', label: '1 hour' },
            { value: '8h', label: '8 hours' },
            { value: 'all', label: 'All' }
          ].map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => onTimeframeChange(option.value as Timeframe)}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                background: selectedTimeframe === option.value ? '#e2e8f0' : '#fff',
                fontWeight: selectedTimeframe === option.value ? 600 : 400,
                fontSize: 12,
                textAlign: 'left'
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
