package server

import (
	"net/http/httptest"
	"testing"

	"galaxy-k8s-monitor/internal/api"
)

func TestPodEndpointsRespectBasePath(t *testing.T) {
	for _, base := range []string{"/", "/galaxy/monitor"} {
		router := NewRouter(Config{BasePath: base, Handlers: &api.Handlers{}, PodHandlers: &api.PodHandlers{}})
		prefix := base
		if base == "/" {
			prefix = ""
		}
		for _, endpoint := range []string{"/api/pods?group=galaxy-web", "/api/pod-logs?pod=web"} {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest("GET", prefix+endpoint, nil))
			if w.Code != 503 {
				t.Fatalf("%s%s: got %d", prefix, endpoint, w.Code)
			}
		}
	}
}
