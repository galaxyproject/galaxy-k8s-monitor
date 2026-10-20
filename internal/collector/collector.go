package collector

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
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
		Network *struct {
			Name       string `json:"name"`
			RxBytes    int64  `json:"rxBytes"`
			RxErrors   int64  `json:"rxErrors"`
			TxBytes    int64  `json:"txBytes"`
			TxErrors   int64  `json:"txErrors"`
			Interfaces []struct {
				Name     string `json:"name"`
				RxBytes  int64  `json:"rxBytes"`
				RxErrors int64  `json:"rxErrors"`
				TxBytes  int64  `json:"txBytes"`
				TxErrors int64  `json:"txErrors"`
			} `json:"interfaces"`
		} `json:"network"`
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

const heartbeatInterval = 15 * time.Minute

type Collector struct {
	coreClient    kubernetes.Interface
	metricsClient metricsclientset.Interface
	namespace     string
	store         *store.RingBuffer
	interval      time.Duration
	onSample      func(model.Sample)

	initialLogged    bool
	lastHeartbeat    time.Time
	errState         map[string]string
	prevDiskPressure bool
	prevDiskLevels   map[string]string
	hasPrevNetTotals bool
	prevRxDropped    int64
	prevTxDropped    int64
	prevRxErrors     int64
	prevTxErrors     int64
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
		coreClient:     coreClient,
		metricsClient:  metricsClient,
		namespace:      namespace,
		store:          store,
		interval:       interval,
		onSample:       onSample,
		errState:       map[string]string{},
		prevDiskLevels: map[string]string{},
	}
}

func (collector *Collector) recordError(source string, err error, attrs ...any) {
	if err == nil {
		return
	}
	if collector.errState == nil {
		collector.errState = map[string]string{}
	}
	msg := err.Error()
	if collector.errState[source] == msg {
		return
	}
	collector.errState[source] = msg
	args := []any{"source", source, "namespace", collector.namespace}
	args = append(args, attrs...)
	args = append(args, "err", err)
	slog.Warn("collector source failed", args...)
}

func (collector *Collector) recordRecovery(source string, attrs ...any) {
	if collector.errState == nil {
		return
	}
	if prev, ok := collector.errState[source]; ok && prev != "" {
		delete(collector.errState, source)
		args := []any{"source", source, "namespace", collector.namespace}
		args = append(args, attrs...)
		slog.Info("collector source recovered", args...)
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

func isExternalNetworkInterface(name string) bool {
	if name == "" || name == "lo" {
		return false
	}
	virtualPrefixes := []string{
		"cali", "flannel", "cni", "veth", "cilium", "lxc",
		"docker", "br-", "virbr", "vnet", "kube-", "nodelocal",
		"tunl", "vxlan", "wg", "dummy", "sit", "erspan", "gre",
	}
	for _, prefix := range virtualPrefixes {
		if strings.HasPrefix(name, prefix) {
			return false
		}
	}
	return true
}

func enrichNetworkFromCadvisor(raw []byte, netSample *model.NetworkSample, includeBytesAndErrors bool) bool {
	if len(raw) == 0 || netSample == nil {
		return false
	}

	var rxDropped, txDropped int64
	var rxBytes, txBytes, rxErrors, txErrors int64
	found := false

	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "container_network_") {
			continue
		}
		labels, val, ok := parsePromLineValue(line)
		if !ok {
			continue
		}
		if extractPromLabel(labels, "id") != "/" || extractPromLabel(labels, "container") != "" {
			continue
		}
		iface := extractPromLabel(labels, "interface")
		if !isExternalNetworkInterface(iface) {
			continue
		}

		intVal := int64(math.Round(val))
		switch {
		case strings.HasPrefix(line, "container_network_receive_packets_dropped_total{"):
			rxDropped += intVal
			found = true
		case strings.HasPrefix(line, "container_network_transmit_packets_dropped_total{"):
			txDropped += intVal
			found = true
		case includeBytesAndErrors && strings.HasPrefix(line, "container_network_receive_bytes_total{"):
			rxBytes += intVal
			found = true
		case includeBytesAndErrors && strings.HasPrefix(line, "container_network_transmit_bytes_total{"):
			txBytes += intVal
			found = true
		case includeBytesAndErrors && strings.HasPrefix(line, "container_network_receive_errors_total{"):
			rxErrors += intVal
			found = true
		case includeBytesAndErrors && strings.HasPrefix(line, "container_network_transmit_errors_total{"):
			txErrors += intVal
			found = true
		}
	}

	if found {
		netSample.RxDropped += rxDropped
		netSample.TxDropped += txDropped
		if includeBytesAndErrors {
			netSample.RxBytes += rxBytes
			netSample.TxBytes += txBytes
			netSample.RxErrors += rxErrors
			netSample.TxErrors += txErrors
		}
	}
	return found
}

func (collector *Collector) collectNodeTelemetry(ctx context.Context, nodeList *corev1.NodeList) (*model.DiskSample, *model.NetworkSample) {
	if nodeList == nil || len(nodeList.Items) == 0 {
		return nil, nil
	}

	disk := &model.DiskSample{}
	hasDiskData := false
	netSample := &model.NetworkSample{}
	hasNetData := false

	for _, node := range nodeList.Items {
		for _, cond := range node.Status.Conditions {
			if cond.Type == corev1.NodeDiskPressure && cond.Status == corev1.ConditionTrue {
				disk.DiskPressure = true
				hasDiskData = true
			}
		}

		restClient := collector.coreClient.CoreV1().RESTClient()
		if restClient == nil {
			continue
		}

		statsSource := "kubelet_stats:" + node.Name
		raw, err := restClient.Get().
			Resource("nodes").
			Name(node.Name).
			SubResource("proxy", "stats", "summary").
			DoRaw(ctx)
		if err != nil {
			collector.recordError(statsSource, err, "node", node.Name)
			continue
		}

		var summary kubeletStatsSummary
		if err := json.Unmarshal(raw, &summary); err != nil {
			collector.recordError(statsSource, err, "node", node.Name)
			continue
		}
		collector.recordRecovery(statsSource, "node", node.Name)

		if summary.Node.Fs != nil && summary.Node.Fs.CapacityBytes > 0 {
			disk.NodeCapacityBytes += summary.Node.Fs.CapacityBytes
			disk.NodeUsedBytes += summary.Node.Fs.UsedBytes
			disk.NodeAvailableBytes += summary.Node.Fs.AvailableBytes
			hasDiskData = true
		}

		if summary.Node.Runtime != nil && summary.Node.Runtime.ImageFs != nil {
			disk.ImageUsedBytes += summary.Node.Runtime.ImageFs.UsedBytes
			hasDiskData = true
		}

		for _, sysContainer := range summary.Node.SystemContainers {
			if sysContainer.Name == "pods" && sysContainer.IO != nil && sysContainer.IO.PSI != nil {
				if sysContainer.IO.PSI.Some.Avg10 > disk.IOPsiSomeAvg10 {
					disk.IOPsiSomeAvg10 = sysContainer.IO.PSI.Some.Avg10
				}
				if sysContainer.IO.PSI.Full.Avg10 > disk.IOPsiFullAvg10 {
					disk.IOPsiFullAvg10 = sysContainer.IO.PSI.Full.Avg10
				}
				hasDiskData = true
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
					hasDiskData = true
					break
				}
			}
			if disk.GalaxyPVCCapacityBytes > 0 {
				break
			}
		}

		nodeNetFromSummary := false
		if summary.Node.Network != nil {
			if len(summary.Node.Network.Interfaces) > 0 {
				for _, iface := range summary.Node.Network.Interfaces {
					if isExternalNetworkInterface(iface.Name) {
						netSample.RxBytes += iface.RxBytes
						netSample.TxBytes += iface.TxBytes
						netSample.RxErrors += iface.RxErrors
						netSample.TxErrors += iface.TxErrors
						nodeNetFromSummary = true
						hasNetData = true
					}
				}
			}
			if !nodeNetFromSummary && (summary.Node.Network.RxBytes > 0 || summary.Node.Network.TxBytes > 0) {
				netSample.RxBytes += summary.Node.Network.RxBytes
				netSample.TxBytes += summary.Node.Network.TxBytes
				netSample.RxErrors += summary.Node.Network.RxErrors
				netSample.TxErrors += summary.Node.Network.TxErrors
				nodeNetFromSummary = true
				hasNetData = true
			}
		}

		cadvisorSource := "cadvisor:" + node.Name
		cadvisorRaw, err := restClient.Get().
			Resource("nodes").
			Name(node.Name).
			SubResource("proxy", "metrics", "cadvisor").
			DoRaw(ctx)
		if err != nil {
			collector.recordError(cadvisorSource, err, "node", node.Name)
		} else if len(cadvisorRaw) > 0 {
			collector.recordRecovery(cadvisorSource, "node", node.Name)
			if enrichDiskFromCadvisor(cadvisorRaw, disk) {
				hasDiskData = true
			}
			if enrichNetworkFromCadvisor(cadvisorRaw, netSample, !nodeNetFromSummary) {
				hasNetData = true
			}
		}
	}

	var outDisk *model.DiskSample
	if hasDiskData {
		outDisk = disk
	}
	var outNet *model.NetworkSample
	if hasNetData {
		outNet = netSample
	}
	return outDisk, outNet
}

func (collector *Collector) collectOnce(ctx context.Context) {
	podList, err := collector.coreClient.CoreV1().Pods(collector.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		collector.recordError("pods", err)
		return
	}
	collector.recordRecovery("pods")

	metricsList, err := collector.metricsClient.MetricsV1beta1().PodMetricses(collector.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		collector.recordError("pod_metrics", err)
		return
	}
	collector.recordRecovery("pod_metrics")

	nodeList, err := collector.coreClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		collector.recordError("nodes", err)
		nodeList = nil
	} else {
		collector.recordRecovery("nodes")
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

	diskSample, netSample := collector.collectNodeTelemetry(ctx, nodeList)

	sample := model.Sample{
		Timestamp:                 timestamp,
		Pods:                      podSamples,
		ClusterCPUCapacityMilli:   clusterCPUCapacityMilli,
		ClusterMemoryCapacityByte: clusterMemoryCapacityByte,
		Disk:                      diskSample,
		Network:                   netSample,
	}

	collector.store.Append(sample)
	collector.logSampleEvents(sample, len(podList.Items), nodeList)
	if collector.onSample != nil {
		collector.onSample(sample)
	}
}

func formatGiB(bytesVal int64) string {
	return fmt.Sprintf("%.2f", float64(bytesVal)/(1024*1024*1024))
}

func formatPct(used, capacity int64) string {
	if capacity <= 0 {
		return "n/a"
	}
	return fmt.Sprintf("%.1f%%", (float64(used)/float64(capacity))*100)
}

func discoveredDisksList(disk *model.DiskSample) string {
	if disk == nil {
		return "none"
	}
	var names []string
	if disk.NodeCapacityBytes > 0 {
		names = append(names, "root")
	}
	if disk.GalaxyPVCCapacityBytes > 0 {
		names = append(names, "galaxy-pvc")
	}
	if disk.PostgresCapacityBytes > 0 {
		names = append(names, "postgres")
	}
	if len(names) == 0 {
		return "none"
	}
	return strings.Join(names, ",")
}

func classifyDiskThreshold(used, capacity int64) (string, float64) {
	if capacity <= 0 {
		return "normal", 0
	}
	pct := (float64(used) / float64(capacity)) * 100
	switch {
	case pct >= 90:
		return "critical", pct
	case pct >= 85:
		return "warning", pct
	default:
		return "normal", pct
	}
}

func (collector *Collector) checkDiskThresholdTransition(diskName string, used, capacity int64) {
	if capacity <= 0 {
		return
	}
	if collector.prevDiskLevels == nil {
		collector.prevDiskLevels = map[string]string{}
	}
	prev := collector.prevDiskLevels[diskName]
	if prev == "" {
		prev = "normal"
	}
	level, pct := classifyDiskThreshold(used, capacity)
	if level == prev {
		return
	}
	collector.prevDiskLevels[diskName] = level
	attrs := []any{
		"disk", diskName,
		"used_pct", fmt.Sprintf("%.1f%%", pct),
		"used_gib", formatGiB(used),
		"capacity_gib", formatGiB(capacity),
	}
	switch level {
	case "critical":
		slog.Warn("disk usage crossed critical eviction threshold (>=90%)", attrs...)
	case "warning":
		slog.Warn("disk usage crossed garbage-collection threshold (>=85%)", attrs...)
	default:
		slog.Info("disk usage returned to normal (<85%)", attrs...)
	}
}

func (collector *Collector) logSampleEvents(sample model.Sample, rawPodCount int, nodeList *corev1.NodeList) {
	nodeCount := 0
	if nodeList != nil {
		nodeCount = len(nodeList.Items)
	}

	var totalCPUMilli int64
	var totalMemBytes int64
	for _, p := range sample.Pods {
		totalCPUMilli += p.CPUUsage
		totalMemBytes += p.MemUsage
	}

	if !collector.initialLogged {
		collector.initialLogged = true
		collector.lastHeartbeat = sample.Timestamp
		netStatus := "unavailable"
		if sample.Network != nil {
			netStatus = "ok"
		}
		slog.Info("initial cluster sample collected",
			"namespace", collector.namespace,
			"pods", rawPodCount,
			"pod_groups", len(sample.Pods),
			"nodes", nodeCount,
			"cpu_used_cores", fmt.Sprintf("%.2f", float64(totalCPUMilli)/1000.0),
			"cpu_capacity_cores", fmt.Sprintf("%.2f", float64(sample.ClusterCPUCapacityMilli)/1000.0),
			"mem_used_gib", formatGiB(totalMemBytes),
			"mem_capacity_gib", formatGiB(sample.ClusterMemoryCapacityByte),
			"disks", discoveredDisksList(sample.Disk),
			"network", netStatus,
		)
	}

	if sample.Disk != nil {
		if sample.Disk.DiskPressure && !collector.prevDiskPressure {
			slog.Warn("node DiskPressure condition is active", "namespace", collector.namespace)
		} else if !sample.Disk.DiskPressure && collector.prevDiskPressure {
			slog.Info("node DiskPressure condition cleared", "namespace", collector.namespace)
		}
		collector.prevDiskPressure = sample.Disk.DiskPressure

		collector.checkDiskThresholdTransition("root", sample.Disk.NodeUsedBytes, sample.Disk.NodeCapacityBytes)
		collector.checkDiskThresholdTransition("galaxy-pvc", sample.Disk.GalaxyPVCUsedBytes, sample.Disk.GalaxyPVCCapacityBytes)
		collector.checkDiskThresholdTransition("postgres", sample.Disk.PostgresUsedBytes, sample.Disk.PostgresCapacityBytes)
	}

	if sample.Network != nil {
		if collector.hasPrevNetTotals {
			rxDropDelta := sample.Network.RxDropped - collector.prevRxDropped
			txDropDelta := sample.Network.TxDropped - collector.prevTxDropped
			rxErrDelta := sample.Network.RxErrors - collector.prevRxErrors
			txErrDelta := sample.Network.TxErrors - collector.prevTxErrors
			if rxDropDelta > 0 || txDropDelta > 0 || rxErrDelta > 0 || txErrDelta > 0 {
				slog.Warn("network packet drops or errors detected",
					"rx_dropped_delta", rxDropDelta,
					"tx_dropped_delta", txDropDelta,
					"rx_errors_delta", rxErrDelta,
					"tx_errors_delta", txErrDelta,
					"total_rx_dropped", sample.Network.RxDropped,
					"total_tx_dropped", sample.Network.TxDropped,
					"total_rx_errors", sample.Network.RxErrors,
					"total_tx_errors", sample.Network.TxErrors,
				)
			}
		}
		collector.hasPrevNetTotals = true
		collector.prevRxDropped = sample.Network.RxDropped
		collector.prevTxDropped = sample.Network.TxDropped
		collector.prevRxErrors = sample.Network.RxErrors
		collector.prevTxErrors = sample.Network.TxErrors
	}

	if !collector.lastHeartbeat.IsZero() && sample.Timestamp.Sub(collector.lastHeartbeat) >= heartbeatInterval {
		collector.lastHeartbeat = sample.Timestamp
		attrs := []any{
			"namespace", collector.namespace,
			"samples_buffered", fmt.Sprintf("%d/%d", collector.store.Len(), collector.store.Capacity()),
			"pod_groups", len(sample.Pods),
			"cpu_cores", fmt.Sprintf("%.2f/%.2f", float64(totalCPUMilli)/1000.0, float64(sample.ClusterCPUCapacityMilli)/1000.0),
			"mem_gib", fmt.Sprintf("%s/%s", formatGiB(totalMemBytes), formatGiB(sample.ClusterMemoryCapacityByte)),
		}
		if sample.Disk != nil {
			attrs = append(attrs, "root_disk_used", formatPct(sample.Disk.NodeUsedBytes, sample.Disk.NodeCapacityBytes))
			if sample.Disk.GalaxyPVCCapacityBytes > 0 {
				attrs = append(attrs, "galaxy_pvc_used", formatPct(sample.Disk.GalaxyPVCUsedBytes, sample.Disk.GalaxyPVCCapacityBytes))
			}
			if sample.Disk.PostgresCapacityBytes > 0 {
				attrs = append(attrs, "postgres_disk_used", formatPct(sample.Disk.PostgresUsedBytes, sample.Disk.PostgresCapacityBytes))
			}
		}
		if sample.Network != nil {
			attrs = append(attrs,
				"net_rx_gib", formatGiB(sample.Network.RxBytes),
				"net_tx_gib", formatGiB(sample.Network.TxBytes),
			)
		}
		slog.Info("collector heartbeat", attrs...)
	} else {
		slog.Debug("sample collected",
			"namespace", collector.namespace,
			"pod_groups", len(sample.Pods),
			"samples_buffered", collector.store.Len(),
		)
	}
}


