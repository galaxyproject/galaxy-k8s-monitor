package model

import "time"

type PodSample struct {
	Name       string `json:"name"`
	CPUUsage   int64  `json:"cpuUsageMillicores"`
	CPURequest int64  `json:"cpuRequestMillicores"`
	MemUsage   int64  `json:"memUsageBytes"`
	MemRequest int64  `json:"memRequestBytes"`
}

type Sample struct {
	Timestamp                 time.Time   `json:"timestamp"`
	Pods                      []PodSample `json:"pods"`
	ClusterCPUCapacityMilli   int64       `json:"clusterCpuCapacityMillicores"`
	ClusterMemoryCapacityByte int64       `json:"clusterMemCapacityBytes"`
}
