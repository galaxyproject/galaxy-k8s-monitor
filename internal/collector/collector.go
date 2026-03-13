package collector

import (
	"context"
	"sort"
	"time"

	"galaxy-k8s-monitor/internal/model"
	"galaxy-k8s-monitor/internal/store"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/client-go/kubernetes"
	metricsclientset "k8s.io/metrics/pkg/client/clientset/versioned"
)

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

	sample := model.Sample{
		Timestamp:                 timestamp,
		Pods:                      podSamples,
		ClusterCPUCapacityMilli:   clusterCPUCapacityMilli,
		ClusterMemoryCapacityByte: clusterMemoryCapacityByte,
	}

	collector.store.Append(sample)
	if collector.onSample != nil {
		collector.onSample(sample)
	}
}
