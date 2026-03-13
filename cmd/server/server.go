package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"galaxy-k8s-monitor/internal/api"
)

type Config struct {
	Address     string
	BasePath    string
	StaticFiles fs.FS
	Handlers    *api.Handlers
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

func withJSONLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		next.ServeHTTP(response, request)
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
