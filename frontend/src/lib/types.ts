export type PodSample = {
  name: string;
  cpuUsageMillicores: number;
  cpuRequestMillicores: number;
  memUsageBytes: number;
  memRequestBytes: number;
};

export type DiskSample = {
  nodeCapacityBytes: number;
  nodeUsedBytes: number;
  nodeAvailableBytes: number;
  imageUsedBytes: number;
  galaxyPvcCapacityBytes?: number;
  galaxyPvcUsedBytes?: number;
  galaxyPvcAvailableBytes?: number;
  diskPressure: boolean;
  ioPsiSomeAvg10: number;
  ioPsiFullAvg10: number;
};

export type Sample = {
  timestamp: string;
  pods: PodSample[];
  clusterCpuCapacityMillicores: number;
  clusterMemCapacityBytes: number;
  disk?: DiskSample;
};

export type ConfigResponse = {
  namespace: string;
  intervalSeconds: number;
  retentionHours: number;
  basePath: string;
  podGroups: string[];
};
