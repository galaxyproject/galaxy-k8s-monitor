package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"sort"
	"time"

	"galaxy-k8s-monitor/internal/collector"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// PodHandlers deliberately expose only the configured namespace and a small
// projection of pod details, never environment variables or the full pod spec.
type PodHandlers struct {
	Client    kubernetes.Interface
	Namespace string
}

type containerDetails struct {
	Name          string `json:"name"`
	Image         string `json:"image"`
	Init          bool   `json:"init"`
	Ready         bool   `json:"ready"`
	Restarts      int32  `json:"restarts"`
	State         string `json:"state"`
	CPURequest    string `json:"cpuRequest"`
	MemoryRequest string `json:"memoryRequest"`
	CPULimit      string `json:"cpuLimit"`
	MemoryLimit   string `json:"memoryLimit"`
}

type podDetails struct {
	Name       string             `json:"name"`
	UID        string             `json:"uid"`
	Namespace  string             `json:"namespace"`
	Phase      corev1.PodPhase    `json:"phase"`
	Node       string             `json:"node"`
	Created    metav1.Time        `json:"created"`
	Containers []containerDetails `json:"containers"`
}

func podView(pod corev1.Pod) podDetails {
	result := podDetails{
		Name: pod.Name, UID: string(pod.UID), Namespace: pod.Namespace,
		Phase: pod.Status.Phase, Node: pod.Spec.NodeName,
		Created: pod.CreationTimestamp, Containers: []containerDetails{},
	}
	statuses := map[string]corev1.ContainerStatus{}
	for _, list := range [][]corev1.ContainerStatus{pod.Status.ContainerStatuses, pod.Status.InitContainerStatuses} {
		for _, status := range list {
			statuses[status.Name] = status
		}
	}
	add := func(containers []corev1.Container, init bool) {
		for _, c := range containers {
			s := statuses[c.Name]
			state := "Unknown"
			if s.State.Running != nil {
				state = "Running"
			}
			if s.State.Waiting != nil {
				state = s.State.Waiting.Reason
			}
			if s.State.Terminated != nil {
				state = fmt.Sprintf("%s (exit %d)", s.State.Terminated.Reason, s.State.Terminated.ExitCode)
			}
			quantity := func(resources corev1.ResourceList, key corev1.ResourceName) string {
				if value, ok := resources[key]; ok {
					return value.String()
				}
				return "Not set"
			}
			result.Containers = append(result.Containers, containerDetails{
				Name: c.Name, Image: c.Image, Init: init, Ready: s.Ready,
				Restarts: s.RestartCount, State: state,
				CPURequest:    quantity(c.Resources.Requests, corev1.ResourceCPU),
				MemoryRequest: quantity(c.Resources.Requests, corev1.ResourceMemory),
				CPULimit:      quantity(c.Resources.Limits, corev1.ResourceCPU),
				MemoryLimit:   quantity(c.Resources.Limits, corev1.ResourceMemory),
			})
		}
	}
	add(pod.Spec.Containers, false)
	add(pod.Spec.InitContainers, true)
	return result
}

func (h *PodHandlers) ready(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	if h.Client == nil {
		http.Error(w, "Live Kubernetes details are unavailable", http.StatusServiceUnavailable)
		return false
	}
	return true
}

func podError(w http.ResponseWriter, err error, attrs ...any) {
	status := http.StatusBadGateway
	message := "Kubernetes request failed"
	switch {
	case apierrors.IsNotFound(err):
		status = http.StatusNotFound
		message = "Pod or logs no longer available"
	case apierrors.IsForbidden(err), apierrors.IsUnauthorized(err):
		status = http.StatusForbidden
		message = "Monitor does not have permission to read these pod details or logs"
	case apierrors.IsBadRequest(err):
		status = http.StatusBadRequest
		message = "Logs are unavailable for the selected container or previous instance"
	}
	args := make([]any, 0, len(attrs)+4)
	args = append(args, attrs...)
	args = append(args, "status", status, "err", err)
	slog.Warn("kubernetes pod api error", args...)
	http.Error(w, message, status)
}

func (h *PodHandlers) Pods(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w, r) {
		return
	}
	group := r.URL.Query().Get("group")
	if group == "" {
		http.Error(w, "A pod group is required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	pods, err := h.Client.CoreV1().Pods(h.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		podError(w, err, "operation", "list_pods", "namespace", h.Namespace, "group", group)
		return
	}
	result := []podDetails{}
	for _, pod := range pods.Items {
		if collector.GroupPodName(pod.Name) == group {
			result = append(result, podView(pod))
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func (h *PodHandlers) Logs(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w, r) {
		return
	}
	query := r.URL.Query()
	name, uid, container := query.Get("pod"), query.Get("uid"), query.Get("container")
	if name == "" || uid == "" || container == "" {
		http.Error(w, "Pod name, UID and container are required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	pod, err := h.Client.CoreV1().Pods(h.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		podError(w, err, "operation", "get_pod", "namespace", h.Namespace, "pod", name, "container", container)
		return
	}
	// A rollout may replace a pod with the same name while a drawer is open.
	if string(pod.UID) != uid {
		http.Error(w, "This pod has been replaced. Refresh pod details to select its replacement.", http.StatusConflict)
		return
	}
	found := false
	for _, c := range podView(*pod).Containers {
		if c.Name == container {
			found = true
			break
		}
	}
	if !found {
		http.Error(w, "Container no longer available", http.StatusNotFound)
		return
	}
	options := &corev1.PodLogOptions{Container: container, Timestamps: query.Get("timestamps") == "true", Previous: query.Get("previous") == "true"}
	download := query.Get("download") == "true"
	if !download {
		tail, limit := int64(1000), int64(1024*1024)
		options.TailLines, options.LimitBytes = &tail, &limit
	}
	stream, err := h.Client.CoreV1().Pods(h.Namespace).GetLogs(name, options).Stream(ctx)
	if err != nil {
		podError(w, err,
			"operation", "stream_logs",
			"namespace", h.Namespace,
			"pod", name,
			"container", container,
			"previous", options.Previous,
			"download", download,
		)
		return
	}
	defer stream.Close()
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if download {
		slog.Info("pod log download started",
			"namespace", h.Namespace,
			"pod", name,
			"container", container,
			"previous", options.Previous,
			"remote_addr", r.RemoteAddr,
		)
		suffix := ""
		if options.Previous {
			suffix = "-previous"
		}
		filename := fmt.Sprintf("%s-%s%s-%s.log", name, container, suffix, time.Now().UTC().Format("20060102T150405Z"))
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	}
	// Downloads bypass the preview limit and stream without buffering whole logs.
	_, _ = io.Copy(w, stream)
}
