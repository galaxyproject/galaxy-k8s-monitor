package api

import (
	"context"
	"fmt"
	"mime"
	"net/http"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/yaml"
)

// Manifest returns the live, defaulted Pod object, rather than the workload's
// template or a Helm manifest. It uses the same namespace and UID guard as logs.
func (h *PodHandlers) Manifest(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w, r) {
		return
	}
	query := r.URL.Query()
	name, uid := query.Get("pod"), query.Get("uid")
	if name == "" || uid == "" {
		http.Error(w, "Pod name and UID are required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	pod, err := h.Client.CoreV1().Pods(h.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		podError(w, err, "operation", "get_manifest", "namespace", h.Namespace, "pod", name)
		return
	}
	if string(pod.UID) != uid {
		http.Error(w, "This pod has been replaced. Refresh pod details to select its replacement.", http.StatusConflict)
		return
	}
	pod.APIVersion, pod.Kind = "v1", "Pod"
	// Like kubectl get -o yaml, omit verbose field ownership bookkeeping.
	pod.ManagedFields = nil
	rendered, err := yaml.Marshal(pod)
	if err != nil {
		http.Error(w, "Could not render pod manifest", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	if query.Get("download") == "true" {
		filename := fmt.Sprintf("%s-%s.yaml", pod.Namespace, pod.Name)
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	}
	_, _ = w.Write(rendered)
}
