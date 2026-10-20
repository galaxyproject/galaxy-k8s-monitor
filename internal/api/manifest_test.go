package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/yaml"
)

func TestManifestLiveObjectAndDownload(t *testing.T) {
	for _, download := range []bool{false, true} {
		t.Run(map[bool]string{false: "view", true: "download"}[download], func(t *testing.T) {
			h, calls := podFixture(t)
			url := "/api/pod-manifest?pod=galaxy-web-abc&uid=original&namespace=other"
			if download {
				url += "&download=true"
			}
			w := httptest.NewRecorder()
			h.Manifest(w, httptest.NewRequest("GET", url, nil))
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			var pod corev1.Pod
			if err := yaml.Unmarshal(w.Body.Bytes(), &pod); err != nil {
				t.Fatal(err)
			}
			if pod.APIVersion != "v1" || pod.Kind != "Pod" || pod.Namespace != "science" || string(pod.UID) != "original" {
				t.Fatal(w.Body.String())
			}
			if pod.ResourceVersion != "12" || pod.Spec.Containers[0].Image != "galaxy:test" || pod.Status.Phase != corev1.PodRunning {
				t.Fatal(w.Body.String())
			}
			// The explicit manifest view retains inline configuration. It does not
			// resolve references or request other Kubernetes resources.
			if pod.Spec.Containers[0].Env[0].Value != "do-not-expose" {
				t.Fatal("Manifest omitted pod configuration")
			}
			if len(pod.ManagedFields) != 0 || strings.Contains(w.Body.String(), "managedFields:") {
				t.Fatal("Managed fields should be omitted")
			}
			if len(*calls) != 1 || (*calls)[0] != "/api/v1/namespaces/science/pods/galaxy-web-abc" {
				t.Fatal(*calls)
			}
			if w.Header().Get("Cache-Control") != "no-store" || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/yaml") {
				t.Fatal(w.Header())
			}
			attachment := w.Header().Get("Content-Disposition")
			if download && !strings.Contains(attachment, "science-galaxy-web-abc.yaml") {
				t.Fatal(attachment)
			}
			if !download && attachment != "" {
				t.Fatal(attachment)
			}
		})
	}
}

func TestManifestRejectsMissingOrReplacedPod(t *testing.T) {
	for _, test := range []struct {
		query         string
		status, calls int
	}{
		{"pod=galaxy-web-abc", 400, 0},
		{"uid=original", 400, 0},
		{"pod=galaxy-web-abc&uid=replaced", 409, 1},
	} {
		h, calls := podFixture(t)
		w := httptest.NewRecorder()
		h.Manifest(w, httptest.NewRequest("GET", "/api/pod-manifest?"+test.query, nil))
		if w.Code != test.status || len(*calls) != test.calls {
			t.Fatal(w.Code, w.Body.String(), *calls)
		}
	}
}
