package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Use a real client against an HTTP fixture to check namespace routing and
// Kubernetes log options, including the absence of preview caps on downloads.
func podFixture(t *testing.T) (*PodHandlers, *[]string) {
	t.Helper()
	calls := []string{}
	pod := `{"metadata":{"name":"galaxy-web-abc","namespace":"science","uid":"original"},"spec":{"containers":[{"name":"web","image":"galaxy:test","env":[{"name":"SECRET","value":"do-not-expose"}]}]},"status":{"phase":"Running","containerStatuses":[{"name":"web","ready":true,"restartCount":2,"state":{"running":{}}}]}}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.RequestURI())
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/namespaces/science/pods":
			io.WriteString(w, `{"kind":"PodList","apiVersion":"v1","items":[`+pod+`,{"metadata":{"name":"galaxy-job-xyz"}}]}`)
		case "/api/v1/namespaces/science/pods/galaxy-web-abc":
			io.WriteString(w, pod)
		case "/api/v1/namespaces/science/pods/galaxy-web-abc/log":
			w.Header().Set("Content-Type", "text/plain")
			io.WriteString(w, "2026-10-20T12:00:00Z hello\n")
		default:
			t.Errorf("Unexpected Kubernetes request: %s", r.URL)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	client, err := kubernetes.NewForConfig(&rest.Config{Host: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	return &PodHandlers{Client: client, Namespace: "science"}, &calls
}

func TestPodsProjectionAndNamespace(t *testing.T) {
	h, calls := podFixture(t)
	w := httptest.NewRecorder()
	h.Pods(w, httptest.NewRequest("GET", "/api/pods?group=galaxy-web&namespace=other", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result []podDetails
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 1 || result[0].UID != "original" || result[0].Containers[0].Restarts != 2 {
		t.Fatal(w.Body.String())
	}
	if strings.Contains(w.Body.String(), "do-not-expose") {
		t.Fatal("Pod secrets leaked")
	}
	if len(*calls) != 1 || !strings.Contains((*calls)[0], "/namespaces/science/") {
		t.Fatal(*calls)
	}
}

func TestLogPreviewAndDownload(t *testing.T) {
	for _, download := range []bool{false, true} {
		t.Run(map[bool]string{false: "preview", true: "download"}[download], func(t *testing.T) {
			h, calls := podFixture(t)
			url := "/api/pod-logs?pod=galaxy-web-abc&uid=original&container=web&previous=true&timestamps=true"
			if download {
				url += "&download=true"
			}
			w := httptest.NewRecorder()
			h.Logs(w, httptest.NewRequest("GET", url, nil))
			if w.Code != 200 || !strings.Contains(w.Body.String(), "hello") {
				t.Fatal(w.Code, w.Body.String())
			}
			logRequest := (*calls)[1]
			for _, expected := range []string{"container=web", "previous=true", "timestamps=true"} {
				if !strings.Contains(logRequest, expected) {
					t.Fatal(logRequest)
				}
			}
			capped := strings.Contains(logRequest, "limitBytes=1048576") && strings.Contains(logRequest, "tailLines=1000")
			if capped == download {
				t.Fatal("Wrong preview limits:", logRequest)
			}
			if download && !strings.Contains(w.Header().Get("Content-Disposition"), "attachment;") {
				t.Fatal(w.Header())
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal(w.Header())
			}
		})
	}
}

func TestLogsRejectReplacementOrUnknownContainer(t *testing.T) {
	for _, query := range []string{"uid=replaced&container=web", "uid=original&container=missing"} {
		h, calls := podFixture(t)
		w := httptest.NewRecorder()
		h.Logs(w, httptest.NewRequest("GET", "/api/pod-logs?pod=galaxy-web-abc&"+query, nil))
		if w.Code != 409 && w.Code != 404 {
			t.Fatal(w.Code, w.Body.String())
		}
		if len(*calls) != 1 {
			t.Fatal("Fetched logs for wrong pod/container", *calls)
		}
	}
}

func TestPodsOfflineAndMethods(t *testing.T) {
	h := &PodHandlers{}
	w := httptest.NewRecorder()
	h.Pods(w, httptest.NewRequest("GET", "/api/pods?group=galaxy-web", nil))
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	h.Logs(w, httptest.NewRequest("POST", "/api/pod-logs", nil))
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
}

func TestLogsHideAddedTimestampsByDefault(t *testing.T) {
	h, calls := podFixture(t)
	w := httptest.NewRecorder()
	h.Logs(w, httptest.NewRequest("GET", "/api/pod-logs?pod=galaxy-web-abc&uid=original&container=web", nil))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if strings.Contains((*calls)[1], "timestamps=true") {
		t.Fatal("Added timestamps should be off by default", *calls)
	}
}
