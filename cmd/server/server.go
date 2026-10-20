package server

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"time"

	"galaxy-k8s-monitor/internal/api"
)

type Config struct {
	Address     string
	BasePath    string
	StaticFiles fs.FS
	Handlers    *api.Handlers
	PodHandlers *api.PodHandlers
}

func normalizeBasePath(input string) string {
	if input == "" || input == "/" {
		return "/"
	}

	if !strings.HasPrefix(input, "/") {
		input = "/" + input
	}

	clean := path.Clean(input)
	if clean == "." {
		return "/"
	}
	return strings.TrimSuffix(clean, "/")
}

func NewRouter(config Config) http.Handler {
	basePath := normalizeBasePath(config.BasePath)
	mux := http.NewServeMux()

	apiPrefix := basePath + "/api"
	if basePath == "/" {
		apiPrefix = "/api"
	}

	if config.PodHandlers != nil {
		mux.HandleFunc(apiPrefix+"/pods", config.PodHandlers.Pods)
		mux.HandleFunc(apiPrefix+"/pod-manifest", config.PodHandlers.Manifest)
		mux.HandleFunc(apiPrefix+"/pod-logs", config.PodHandlers.Logs)
	}

	mux.HandleFunc(apiPrefix+"/samples", config.Handlers.Samples)
	mux.HandleFunc(apiPrefix+"/stream", config.Handlers.Stream)
	mux.HandleFunc(apiPrefix+"/config", config.Handlers.Config)
	mux.HandleFunc(apiPrefix+"/healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte("ok"))
	})

	if config.StaticFiles != nil {
		staticFileServer := http.FileServer(http.FS(config.StaticFiles))
		if basePath == "/" {
			mux.Handle("/", spaFallback(staticFileServer, config.StaticFiles))
		} else {
			prefixWithSlash := basePath + "/"
			mux.Handle(prefixWithSlash, http.StripPrefix(basePath, spaFallback(staticFileServer, config.StaticFiles)))
			mux.HandleFunc(basePath, func(response http.ResponseWriter, request *http.Request) {
				http.Redirect(response, request, prefixWithSlash, http.StatusTemporaryRedirect)
			})
		}
	}

	return withJSONLogging(mux)
}

type statusResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusResponseWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *statusResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func withJSONLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		start := time.Now()
		recorder := &statusResponseWriter{
			ResponseWriter: response,
			status:         http.StatusOK,
		}

		next.ServeHTTP(recorder, request)

		if strings.HasSuffix(request.URL.Path, "/api/stream") && recorder.status < 400 {
			return
		}

		duration := time.Since(start)
		attrs := []any{
			"method", request.Method,
			"path", request.URL.Path,
		}
		if request.URL.RawQuery != "" {
			attrs = append(attrs, "query", request.URL.RawQuery)
		}
		attrs = append(attrs,
			"status", recorder.status,
			"duration_ms", duration.Milliseconds(),
			"remote_addr", request.RemoteAddr,
		)

		switch {
		case recorder.status >= 500:
			slog.Error("http request failed", attrs...)
		case recorder.status >= 400:
			slog.Warn("http request rejected", attrs...)
		case strings.HasSuffix(request.URL.Path, "/api/pods") || strings.HasSuffix(request.URL.Path, "/api/pod-logs"):
			slog.Info("http api request", attrs...)
		default:
			slog.Debug("http request", attrs...)
		}
	})
}

func spaFallback(next http.Handler, staticFiles fs.FS) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		cleanPath := strings.TrimPrefix(path.Clean(request.URL.Path), "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}

		_, statError := fs.Stat(staticFiles, cleanPath)
		if statError != nil && !strings.HasPrefix(cleanPath, "api/") {
			indexData, readError := fs.ReadFile(staticFiles, "index.html")
			if readError == nil {
				response.Header().Set("Content-Type", "text/html; charset=utf-8")
				_, _ = response.Write(indexData)
				return
			}
		}

		next.ServeHTTP(response, request)
	})
}

func WriteJSON(response http.ResponseWriter, statusCode int, payload any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(statusCode)
	_ = json.NewEncoder(response).Encode(payload)
}
