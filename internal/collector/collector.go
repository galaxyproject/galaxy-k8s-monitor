package collector

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
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

type cadvisorBlockDevice struct {
	device     string
	limitBytes int64
	usageBytes int64
}

func extractPromLabel(labelsPart, key string) string {
	prefix := key + `="`
	idx := strings.Index(labelsPart, prefix)
	if idx < 0 {
		return ""
	}
	start := idx + len(prefix)
	end := strings.IndexByte(labelsPart[start:], '"')
	if end < 0 {
		return ""
	}
	return labelsPart[start : start+end]
}

func parsePromLineValue(line string) (string, float64, bool) {
	openIdx := strings.IndexByte(line, '{')
	closeIdx := strings.LastIndexByte(line, '}')
	if openIdx < 0 || closeIdx <= openIdx || closeIdx+1 >= len(line) {
		return "", 0, false
	}
	labelsPart := line[openIdx+1 : closeIdx]
	rest := strings.TrimSpace(line[closeIdx+1:])
	if rest == "" {
		return "", 0, false
	}
	fields := strings.Fields(rest)
	if len(fields) == 0 {
		return "", 0, false
	}
	val, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || math.IsNaN(val) || math.IsInf(val, 0) {
		return "", 0, false
	}
	return labelsPart, val, true
}

func isSameDiskCapacity(a, b int64) bool {
	if a <= 0 || b <= 0 {
		return false
	}
	diff := math.Abs(float64(a - b))
	denom := math.Max(float64(a), float64(b))
	return (diff / denom) < 0.02
}

// enrichDiskFromCadvisor inspects raw /metrics/cadvisor text for mounted block devices
// at id="/" (container="") and pod block I/O device associations to populate Postgres disk
// usage (and fallback Galaxy PVC disk usage if not already populated from pod volume stats).
func enrichDiskFromCadvisor(raw []byte, disk *model.DiskSample) bool {
	if len(raw) == 0 || disk == nil {
		return false
	}

	devices := map[string]*cadvisorBlockDevice{}
	postgresDevices := map[string]bool{}
	nfsDevices := map[string]bool{}

	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "container_fs_limit_bytes{") {
			labels, val, ok := parsePromLineValue(line)
			if !ok {
				continue
			}
			if extractPromLabel(labels, "id") != "/" || extractPromLabel(labels, "container") != "" {
				continue
			}
			dev := extractPromLabel(labels, "device")
			if !strings.HasPrefix(dev, "/dev/") || dev == "/dev/shm" {
				continue
			}
			entry := devices[dev]
			if entry == nil {
				entry = &cadvisorBlockDevice{device: dev}
				devices[dev] = entry
			}
			entry.limitBytes = int64(math.Round(val))
		} else if strings.HasPrefix(line, "container_fs_usage_bytes{") {
			labels, val, ok := parsePromLineValue(line)
			if !ok {
				continue
			}
			if extractPromLabel(labels, "id") != "/" || extractPromLabel(labels, "container") != "" {
				continue
			}
			dev := extractPromLabel(labels, "device")
			if !strings.HasPrefix(dev, "/dev/") || dev == "/dev/shm" {
				continue
			}
			entry := devices[dev]
			if entry == nil {
				entry = &cadvisorBlockDevice{device: dev}
				devices[dev] = entry
			}
			entry.usageBytes = int64(math.Round(val))
		} else if strings.HasPrefix(line, "container_blkio_device_usage_total{") {
			openIdx := strings.IndexByte(line, '{')
			closeIdx := strings.LastIndexByte(line, '}')
			if openIdx < 0 || closeIdx <= openIdx {
				continue
			}
			labels := line[openIdx+1 : closeIdx]
			pod := extractPromLabel(labels, "pod")
			if pod == "" {
				continue
			}
			dev := extractPromLabel(labels, "device")
			if !strings.HasPrefix(dev, "/dev/") {
				continue
			}
			if strings.Contains(pod, "postgres") {
				postgresDevices[dev] = true
			}
			if strings.Contains(pod, "nfs-server-provisioner") {
				nfsDevices[dev] = true
			}
		}
	}

	// Filter to real block devices >= 1 GB (ignoring tiny EFI partitions like /dev/sda15)
	const minBlockDeviceBytes = 1_000_000_000
	candidates := make([]*cadvisorBlockDevice, 0, len(devices))
	for _, d := range devices {
		if d.limitBytes >= minBlockDeviceBytes {
			candidates = append(candidates, d)
		}
	}
	if len(candidates) == 0 {
		return false
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].device < candidates[j].device
	})

	var rootDevice string
	for _, d := range candidates {
		if isSameDiskCapacity(d.limitBytes, disk.NodeCapacityBytes) {
			rootDevice = d.device
			break
		}
	}

	var galaxyDevice string
	for _, d := range candidates {
		if d.device == rootDevice {
			continue
		}
		if (disk.GalaxyPVCCapacityBytes > 0 && isSameDiskCapacity(d.limitBytes, disk.GalaxyPVCCapacityBytes)) || nfsDevices[d.device] {
			galaxyDevice = d.device
			if disk.GalaxyPVCCapacityBytes == 0 {
				disk.GalaxyPVCCapacityBytes = d.limitBytes
				disk.GalaxyPVCUsedBytes = d.usageBytes
				if avail := d.limitBytes - d.usageBytes; avail > 0 {
					disk.GalaxyPVCAvailableBytes = avail
				}
			}
			break
		}
	}

	var pgDev *cadvisorBlockDevice
	for _, d := range candidates {
		if d.device == rootDevice || d.device == galaxyDevice {
			continue
		}
		if postgresDevices[d.device] {
			pgDev = d
			break
		}
	}

	if pgDev == nil {
		for _, d := range candidates {
			if d.device == rootDevice || d.device == galaxyDevice {
				continue
			}
			pgDev = d
			break
		}
	}

	if pgDev != nil && pgDev.limitBytes > 0 {
		disk.PostgresCapacityBytes = pgDev.limitBytes
		disk.PostgresUsedBytes = pgDev.usageBytes
		if avail := pgDev.limitBytes - pgDev.usageBytes; avail > 0 {
			disk.PostgresAvailableBytes = avail
		}
		return true
	}

	return galaxyDevice != ""
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

		cadvisorRaw, err := restClient.Get().
			Resource("nodes").
			Name(node.Name).
			SubResource("proxy", "metrics", "cadvisor").
			DoRaw(ctx)
		if err == nil && len(cadvisorRaw) > 0 {
			if enrichDiskFromCadvisor(cadvisorRaw, disk) {
				hasData = true
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

