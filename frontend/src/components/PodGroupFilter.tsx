import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { getGroupColor, type GroupColorMap } from '../lib/colors';

export type Timeframe = '10m' | '1h' | '8h' | 'all';

const GALAXY_TARGET_GROUPS = new Set(['galaxy-web', 'galaxy-workflow', 'galaxy-job']);

export function isGalaxyGroup(group: string): boolean {
  return GALAXY_TARGET_GROUPS.has(group) || group.startsWith('galaxy-');
}

type Props = {
  podGroups: string[];
  selectedGroups: Set<string>;
  selectedTimeframe: Timeframe;
  groupColorMap?: GroupColorMap;
  onToggleGroup: (name: string) => void;
  onSelectOnly: (name: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectGalaxy: () => void;
  onTimeframeChange: (timeframe: Timeframe) => void;
};

const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = [
  { value: '10m', label: '10 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '8h', label: '8 hours' },
  { value: 'all', label: 'All' }
];

export default function PodGroupFilter({
  podGroups,
  selectedGroups,
  selectedTimeframe,
  groupColorMap,
  onToggleGroup,
  onSelectOnly,
  onSelectAll,
  onSelectNone,
  onSelectGalaxy,
  onTimeframeChange
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');

  const galaxyGroups = useMemo(
    () => podGroups.filter(isGalaxyGroup),
    [podGroups]
  );
  const hasGalaxyGroups = galaxyGroups.length > 0;

  const isAllPresetActive =
    podGroups.length > 0 &&
    selectedGroups.size === podGroups.length &&
    podGroups.every(group => selectedGroups.has(group));

  const isNonePresetActive =
    podGroups.length > 0 && selectedGroups.size === 0;

  const isGalaxyPresetActive =
    hasGalaxyGroups &&
    selectedGroups.size === galaxyGroups.length &&
    galaxyGroups.every(group => selectedGroups.has(group));

  const visiblePodGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return podGroups;
    }
    return podGroups.filter(group => group.toLowerCase().includes(query));
  }, [podGroups, searchQuery]);

  const showSearchInput = podGroups.length > 5 || searchQuery.trim().length > 0;

  return (
    <aside className="sidebar" aria-label="Timeframe and pod group filters">
      <div className="control-group">
        <div className="control-group-header">
          <h2>Timeframe</h2>
        </div>
        <div className="chip-grid-2" role="group" aria-label="Timeframe">
          {TIMEFRAME_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className="chip-button"
              aria-pressed={selectedTimeframe === option.value}
              onClick={() => onTimeframeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <div className="control-group-header">
          <h2>Pod groups</h2>
          <span
            className="count-pill"
            aria-label={`${selectedGroups.size} of ${podGroups.length} pod groups selected`}
          >
            {selectedGroups.size}/{podGroups.length}
          </span>
        </div>

        <div className="chip-row" role="group" aria-label="Pod group presets">
          <button
            type="button"
            className="chip-button"
            aria-pressed={isAllPresetActive}
            disabled={podGroups.length === 0}
            onClick={onSelectAll}
          >
            All
          </button>
          <button
            type="button"
            className="chip-button"
            aria-pressed={isNonePresetActive}
            disabled={podGroups.length === 0}
            onClick={onSelectNone}
          >
            None
          </button>
          <button
            type="button"
            className="chip-button"
            aria-pressed={isGalaxyPresetActive}
            disabled={!hasGalaxyGroups}
            title={
              hasGalaxyGroups
                ? `Select Galaxy pod groups (${galaxyGroups.join(', ')})`
                : 'No Galaxy pod groups (galaxy-web, galaxy-workflow, galaxy-job, or galaxy-*) are present in this dataset'
            }
            onClick={onSelectGalaxy}
          >
            Galaxy
          </button>
        </div>

        {showSearchInput && (
          <div className="filter-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Filter pod groups…"
              aria-label="Filter pod groups by name"
            />
            {searchQuery && (
              <button
                type="button"
                className="filter-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear pod group search"
                title="Clear search"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {podGroups.length === 0 ? (
          <div style={{ fontSize: '0.86rem', color: 'var(--monitor-grey)', padding: '0.25rem 0' }}>
            No pod groups available yet.
          </div>
        ) : visiblePodGroups.length === 0 ? (
          <div style={{ fontSize: '0.86rem', color: 'var(--monitor-grey)', padding: '0.25rem 0' }}>
            No pod groups match “{searchQuery.trim()}”.
          </div>
        ) : (
          <div className="pod-group-list" role="group" aria-label="Pod group selection">
            {visiblePodGroups.map(group => {
              const originalIndex = podGroups.indexOf(group);
              const swatchColor = getGroupColor(groupColorMap, group, Math.max(0, originalIndex));
              const isSelected = selectedGroups.has(group);
              const isSoleSelected = selectedGroups.size === 1 && isSelected;

              return (
                <div
                  key={group}
                  className="pod-group-row"
                  data-selected={isSelected ? 'true' : 'false'}
                >
                  <label className="pod-group-label">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleGroup(group)}
                    />
                    <span
                      className="color-swatch"
                      style={{ background: swatchColor }}
                      aria-hidden="true"
                    />
                    <span className="pod-group-name" title={group}>
                      {group}
                    </span>
                  </label>

                  <button
                    type="button"
                    className="pod-only-btn"
                    data-sole={isSoleSelected ? 'true' : 'false'}
                    onClick={() => (isSoleSelected ? onSelectAll() : onSelectOnly(group))}
                    aria-label={
                      isSoleSelected
                        ? `Restore all pod groups (currently showing only ${group})`
                        : `Select only ${group}`
                    }
                    title={
                      isSoleSelected
                        ? 'Restore all pod groups'
                        : `Show only ${group}`
                    }
                  >
                    {isSoleSelected ? 'All' : 'Only'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
