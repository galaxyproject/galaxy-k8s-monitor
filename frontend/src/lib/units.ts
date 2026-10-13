export const bytesToMiB = (bytes: number): number => bytes / (1024 * 1024);

export const miBToGiB = (valueMiB: number): number => valueMiB / 1024;

export const formatMillicores = (value: number): string => `${Math.round(value).toLocaleString()}m`;

export const formatMiB = (value: number): string => `${value.toFixed(1)} MiB`;

export const formatGiBFromMiB = (valueMiB: number): string =>
  `${miBToGiB(valueMiB).toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB`;

export const formatAdaptiveMemoryFromMiB = (valueMiB: number): string => {
  if (Math.abs(valueMiB) > 0 && Math.abs(valueMiB) < 1024) {
    return `${Math.round(valueMiB).toLocaleString()} MiB`;
  }
  return formatGiBFromMiB(valueMiB);
};
