export const bytesToMiB = (bytes: number): number => bytes / (1024 * 1024);

export const bytesToGiB = (bytes: number): number => bytes / (1024 * 1024 * 1024);

export const miBToGiB = (valueMiB: number): number => valueMiB / 1024;

export const formatMillicores = (value: number): string => `${Math.round(value).toLocaleString()}m`;

export const formatMiB = (value: number): string => `${value.toFixed(1)} MiB`;

export const formatGiB = (valueGiB: number): string =>
  `${valueGiB.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} GiB`;

export const formatGiBFromMiB = (valueMiB: number): string =>
  `${miBToGiB(valueMiB).toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB`;

export const formatAdaptiveMemoryFromMiB = (valueMiB: number): string => {
  if (Math.abs(valueMiB) > 0 && Math.abs(valueMiB) < 1024) {
    return `${Math.round(valueMiB).toLocaleString()} MiB`;
  }
  return formatGiBFromMiB(valueMiB);
};

export const formatRelativeDuration = (seconds: number): string => {
  const clamped = Math.max(0, Math.round(seconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

export const formatRelativeTime = (timestamp: string, firstTimestamp: string): string => {
  const first = new Date(firstTimestamp).getTime();
  const current = new Date(timestamp).getTime();
  const diffSeconds = Math.max(0, Math.floor((current - first) / 1000));
  return formatRelativeDuration(diffSeconds);
};

export const formatElapsedAxisTick = (label: string): string =>
  label.replace(/^(\d+h\s+\d+m)\s+\d+s$/, '$1');

