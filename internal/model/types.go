package model

import "time"

type PodSample struct {
	Name       string `json:"name"`
	CPUUsage   int64  `json:"cpuUsageMillicores"`
	CPURequest int64  `json:"cpuRequestMillicores"`
	MemUsage   int64  `json:"memUsageBytes"`
	MemRequest int64  `json:"memRequestBytes"`
}

type DiskSample struct {
	NodeCapacityBytes       int64   `json:"nodeCapacityBytes"`
	NodeUsedBytes           int64   `json:"nodeUsedBytes"`
	NodeAvailableBytes      int64   `json:"nodeAvailableBytes"`
	ImageUsedBytes          int64   `json:"imageUsedBytes"`
	GalaxyPVCCapacityBytes  int64   `json:"galaxyPvcCapacityBytes,omitempty"`
	GalaxyPVCUsedBytes      int64   `json:"galaxyPvcUsedBytes,omitempty"`
	GalaxyPVCAvailableBytes int64   `json:"galaxyPvcAvailableBytes,omitempty"`
	PostgresCapacityBytes   int64   `json:"postgresCapacityBytes,omitempty"`
	PostgresUsedBytes       int64   `json:"postgresUsedBytes,omitempty"`
	PostgresAvailableBytes  int64   `json:"postgresAvailableBytes,omitempty"`
	DiskPressure            bool    `json:"diskPressure"`
	IOPsiSomeAvg10          float64 `json:"ioPsiSomeAvg10"`
	IOPsiFullAvg10          float64 `json:"ioPsiFullAvg10"`
}

type NetworkSample struct {
	RxBytes   int64 `json:"rxBytes"`
	TxBytes   int64 `json:"txBytes"`
	RxDropped int64 `json:"rxDropped,omitempty"`
	TxDropped int64 `json:"txDropped,omitempty"`
	RxErrors  int64 `json:"rxErrors,omitempty"`
	TxErrors  int64 `json:"txErrors,omitempty"`
}

type Sample struct {
	Timestamp                 time.Time      `json:"timestamp"`
	Pods                      []PodSample    `json:"pods"`
	ClusterCPUCapacityMilli   int64          `json:"clusterCpuCapacityMillicores"`
	ClusterMemoryCapacityByte int64          `json:"clusterMemCapacityBytes"`
	Disk                      *DiskSample    `json:"disk,omitempty"`
	Network                   *NetworkSample `json:"network,omitempty"`
}

