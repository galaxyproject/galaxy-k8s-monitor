export type PodSample = {
  name: string;
  cpuUsageMillicores: number;
  cpuRequestMillicores: number;
  memUsageBytes: number;
  memRequestBytes: number;
};

export type Sample = {
  timestamp: string;
  pods: PodSample[];
  clusterCpuCapacityMillicores: number;
  clusterMemCapacityBytes: number;
};

export type ConfigResponse = {
  namespace: string;
  intervalSeconds: number;
  retentionHours: number;
  basePath: string;
  podGroups: string[];
};
