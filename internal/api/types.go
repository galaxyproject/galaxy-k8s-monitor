package api

import "galaxy-k8s-monitor/internal/model"

type PodSample = model.PodSample
type Sample = model.Sample

type ConfigResponse struct {
	Namespace      string   `json:"namespace"`
	IntervalSecond int      `json:"intervalSeconds"`
	RetentionHours int      `json:"retentionHours"`
	BasePath       string   `json:"basePath"`
	PodGroups      []string `json:"podGroups"`
}
