export const bytesToMiB = (bytes: number): number => bytes / (1024 * 1024);

export const formatMillicores = (value: number): string => `${Math.round(value)}m`;

export const formatMiB = (value: number): string => `${value.toFixed(1)} MiB`;
