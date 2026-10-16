package collector

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"galaxy-k8s-monitor/internal/model"
	"galaxy-k8s-monitor/internal/store"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	metricsclientset "k8s.io/metrics/pkg/client/clientset/versioned"
)

type kubeletStatsSummary struct {
	Node struct {
		Fs *struct {
			AvailableBytes int64 `json:"availableBytes"`
			CapacityBytes  int64 `json:"capacityBytes"`
			UsedBytes      int64 `json:"usedBytes"`
		} `json:"fs"`
		Runtime *struct {
			ImageFs *struct {
				UsedBytes int64 `json:"usedBytes"`
			} `json:"imageFs"`
		} `json:"runtime"`
		SystemContainers []struct {
			Name string `json:"name"`
			IO   *struct {
				PSI *struct {
					Full struct {
						Avg10 float64 `json:"avg10"`
					} `json:"full"`
					Some struct {
						Avg10 float64 `json:"avg10"`
					} `json:"some"`
				} `json:"psi"`
			} `json:"io"`
		} `json:"systemContainers"`
	} `json:"node"`
	Pods []struct {
		Volumes []struct {
			Name           string `json:"name"`
			AvailableBytes int64  `json:"availableBytes"`
			CapacityBytes  int64  `json:"capacityBytes"`
			UsedBytes      int64  `json:"usedBytes"`
			PVCRef         *struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"pvcRef"`
		} `json:"volume"`
	} `json:"pods"`
}

type Collector struct {
	coreClient    kubernetes.Interface
	metricsClient metricsclientset.Interface
	namespace     string
	store         *store.RingBuffer
	interval      time.Duration
	onSample      func(model.Sample)
}

func New(
	coreClient kubernetes.Interface,
	metricsClient metricsclientset.Interface,
	namespace string,
	store *store.RingBuffer,
	interval time.Duration,
	onSample func(model.Sample),
) *Collector {
	return &Collector{
		coreClient:    coreClient,
		metricsClient: metricsClient,
		namespace:     namespace,
		store:         store,
		interval:      interval,
		onSample:      onSample,
	}
}

func (collector *Collector) Run(ctx context.Context) {
	ticker := time.NewTicker(collector.interval)
	defer ticker.Stop()

	collector.collectOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			collector.collectOnce(ctx)
		}
	}
}

func (collector *Collector) collectDiskSample(ctx context.Context, nodeList *corev1.NodeList) *model.DiskSample {
	if nodeList == nil || len(nodeList.Items) == 0 {
		return nil
	}

	disk := &model.DiskSample{}
	hasData := false

	for _, node := range nodeList.Items {
		for _, cond := range node.Status.Conditions {
			if cond.Type == corev1.NodeDiskPressure && cond.Status == corev1.ConditionTrue {
				disk.DiskPressure = true
				hasData = true
			}
		}

		restClient := collector.coreClient.CoreV1().RESTClient()
		if restClient == nil {
			continue
		}

		raw, err := restClient.Get().
			Resource("nodes").
			Name(node.Name).
			SubResource("proxy", "stats", "summary").
			DoRaw(ctx)
		if err != nil {
			continue
		}

		var summary kubeletStatsSummary
		if err := json.Unmarshal(raw, &summary); err != nil {
			continue
		}

		if summary.Node.Fs != nil && summary.Node.Fs.CapacityBytes > 0 {
			disk.NodeCapacityBytes += summary.Node.Fs.CapacityBytes
			disk.NodeUsedBytes += summary.Node.Fs.UsedBytes
			disk.NodeAvailableBytes += summary.Node.Fs.AvailableBytes
			hasData = true
		}

		if summary.Node.Runtime != nil && summary.Node.Runtime.ImageFs != nil {
			disk.ImageUsedBytes += summary.Node.Runtime.ImageFs.UsedBytes
			hasData = true
		}

		for _, sysContainer := range summary.Node.SystemContainers {
			if sysContainer.Name == "pods" && sysContainer.IO != nil && sysContainer.IO.PSI != nil {
				if sysContainer.IO.PSI.Some.Avg10 > disk.IOPsiSomeAvg10 {
					disk.IOPsiSomeAvg10 = sysContainer.IO.PSI.Some.Avg10
				}
				if sysContainer.IO.PSI.Full.Avg10 > disk.IOPsiFullAvg10 {
					disk.IOPsiFullAvg10 = sysContainer.IO.PSI.Full.Avg10
				}
				hasData = true
			}
		}

		for _, pod := range summary.Pods {
			for _, vol := range pod.Volumes {
				if vol.PVCRef != nil &&
					vol.PVCRef.Namespace == collector.namespace &&
					vol.PVCRef.Name == "galaxy-galaxy-pvc" &&
					vol.CapacityBytes > 0 {
					disk.GalaxyPVCCapacityBytes = vol.CapacityBytes
					disk.GalaxyPVCUsedBytes = vol.UsedBytes
					disk.GalaxyPVCAvailableBytes = vol.AvailableBytes
					hasData = true
					break
				}
			}
			if disk.GalaxyPVCCapacityBytes > 0 {
				break
			}
		}
	}

	if !hasData {
		return nil
	}
	return disk
}

func (collector *Collector) collectOnce(ctx context.Context) {
	podList, err := collector.coreClient.CoreV1().Pods(collector.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return
	}

	metricsList, err := collector.metricsClient.MetricsV1beta1().PodMetricses(collector.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return
	}

	nodeList, err := collector.coreClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		nodeList = nil
	}

	timestamp := time.Now().UTC()
	groups := map[string]*model.PodSample{}

	requestsByPod := map[string]corev1.ResourceList{}
	var clusterCPUCapacityMilli int64
	var clusterMemoryCapacityByte int64

	if nodeList != nil {
		for _, node := range nodeList.Items {
			cpuAllocatable := node.Status.Allocatable[corev1.ResourceCPU]
			memAllocatable := node.Status.Allocatable[corev1.ResourceMemory]
			clusterCPUCapacityMilli += cpuAllocatable.MilliValue()
			clusterMemoryCapacityByte += memAllocatable.Value()
		}
	}

	for _, pod := range podList.Items {
		cpuRequest := resource.NewMilliQuantity(0, resource.DecimalSI)
		memoryRequest := resource.NewQuantity(0, resource.BinarySI)

		for _, container := range pod.Spec.Containers {
			if quantity, ok := container.Resources.Requests[corev1.ResourceCPU]; ok {
				cpuRequest.Add(quantity)
			}
			if quantity, ok := container.Resources.Requests[corev1.ResourceMemory]; ok {
				memoryRequest.Add(quantity)
			}
		}

		requestsByPod[pod.Name] = corev1.ResourceList{
			corev1.ResourceCPU:    *cpuRequest,
			corev1.ResourceMemory: *memoryRequest,
		}
	}

	for _, podMetric := range metricsList.Items {
		groupName := GroupPodName(podMetric.Name)
		entry := groups[groupName]
		if entry == nil {
			entry = &model.PodSample{Name: groupName}
			groups[groupName] = entry
		}

		var podCPUUsage int64
		var podMemoryUsage int64
		for _, container := range podMetric.Containers {
			podCPUUsage += container.Usage.Cpu().MilliValue()
			podMemoryUsage += container.Usage.Memory().Value()
		}

		entry.CPUUsage += podCPUUsage
		entry.MemUsage += podMemoryUsage

		if requestList, ok := requestsByPod[podMetric.Name]; ok {
			cpuRequest := requestList[corev1.ResourceCPU]
			memRequest := requestList[corev1.ResourceMemory]
			entry.CPURequest += cpuRequest.MilliValue()
			entry.MemRequest += memRequest.Value()
		}
	}

	podSamples := make([]model.PodSample, 0, len(groups))
	for _, podSample := range groups {
		podSamples = append(podSamples, *podSample)
	}

	sort.Slice(podSamples, func(left, right int) bool {
		return podSamples[left].Name < podSamples[right].Name
	})

	diskSample := collector.collectDiskSample(ctx, nodeList)

	sample := model.Sample{
		Timestamp:                 timestamp,
		Pods:                      podSamples,
		ClusterCPUCapacityMilli:   clusterCPUCapacityMilli,
		ClusterMemoryCapacityByte: clusterMemoryCapacityByte,
		Disk:                      diskSample,
	}

	collector.store.Append(sample)
	if collector.onSample != nil {
		collector.onSample(sample)
	}
}

