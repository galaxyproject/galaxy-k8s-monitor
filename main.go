package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"galaxy-k8s-monitor/cmd/server"
	"galaxy-k8s-monitor/internal/api"
	"galaxy-k8s-monitor/internal/collector"
	"galaxy-k8s-monitor/internal/store"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsclientset "k8s.io/metrics/pkg/client/clientset/versioned"
)

//go:embed frontend/dist
var embeddedFrontend embed.FS

func normalizeBasePath(input string) string {
	if input == "" || input == "/" {
		return "/"
	}
	if !strings.HasPrefix(input, "/") {
		input = "/" + input
	}
	clean := strings.TrimSuffix(input, "/")
	if clean == "" {
		return "/"
	}
	return clean
}

func main() {
	var (
		namespace      = flag.String("namespace", "galaxy", "Kubernetes namespace to monitor")
		interval       = flag.Duration("interval", 30*time.Second, "Sample interval")
		retentionHours = flag.Int("retention-hours", 24, "Sample retention duration in hours")
		listenAddress  = flag.String("address", ":8080", "HTTP listen address")
		kubeconfig     = flag.String("kubeconfig", "", "Path to kubeconfig (optional; falls back to KUBECONFIG env var or in-cluster)")
		basePath       = flag.String("base-path", "/", "Optional base path prefix, for example /monitor")
	)
	flag.Parse()

	config, err := buildKubeConfig(*kubeconfig)
	if err != nil {
		log.Fatalf("failed to build kubernetes config: %v", err)
	}

	coreClient, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Fatalf("failed to create kubernetes client: %v", err)
	}

	metricsClient, err := metricsclientset.NewForConfig(config)
	if err != nil {
		log.Fatalf("failed to create metrics client: %v", err)
	}

	normalizedBasePath := normalizeBasePath(*basePath)
	capacity := int((time.Duration(*retentionHours) * time.Hour) / *interval)
	if capacity < 1 {
		capacity = 1
	}

	ring := store.NewRingBuffer(capacity)
	broadcaster := api.NewBroadcaster()

	currentPodGroups := func() []string {
		samples := ring.All()
		if len(samples) == 0 {
			return []string{}
		}

		groupSet := map[string]struct{}{}
		for _, sample := range samples {
			for _, pod := range sample.Pods {
				groupSet[pod.Name] = struct{}{}
			}
		}

		groups := make([]string, 0, len(groupSet))
		for name := range groupSet {
			groups = append(groups, name)
		}
		sort.Strings(groups)
		return groups
	}

	handlers := api.NewHandlers(
		ring,
		api.HandlerConfig{
			Namespace:      *namespace,
			IntervalSecond: int(interval.Seconds()),
			RetentionHours: *retentionHours,
			BasePath:       normalizedBasePath,
		},
		broadcaster,
		currentPodGroups,
	)

	frontendRoot, err := fs.Sub(embeddedFrontend, "frontend/dist")
	if err != nil {
		log.Fatalf("failed to initialize embedded frontend: %v", err)
	}

	router := server.NewRouter(server.Config{
		Address:     *listenAddress,
		BasePath:    normalizedBasePath,
		StaticFiles: frontendRoot,
		Handlers:    handlers,
	})

	collectorInstance := collector.New(
		coreClient,
		metricsClient,
		*namespace,
		ring,
		*interval,
		func(sample api.Sample) {
			broadcaster.Publish(sample)
		},
	)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	go collectorInstance.Run(ctx)

	httpServer := &http.Server{
		Addr:              *listenAddress,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("starting galaxy-k8s-monitor on %s (base path: %s, namespace: %s, interval: %s)", *listenAddress, normalizedBasePath, *namespace, interval.String())

	go func() {
		<-ctx.Done()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if shutdownErr := httpServer.Shutdown(shutdownCtx); shutdownErr != nil {
			log.Printf("http shutdown error: %v", shutdownErr)
		}
	}()

	if err = httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("http server failed: %v", err)
	}
}

func buildKubeConfig(kubeconfigFlag string) (*rest.Config, error) {
	if kubeconfigFlag != "" {
		return clientcmd.BuildConfigFromFlags("", kubeconfigFlag)
	}

	if kubeconfigEnv := os.Getenv("KUBECONFIG"); kubeconfigEnv != "" {
		return clientcmd.BuildConfigFromFlags("", kubeconfigEnv)
	}

	if homeDir, err := os.UserHomeDir(); err == nil {
		defaultKubeConfig := fmt.Sprintf("%s/.kube/config", homeDir)
		if _, statErr := os.Stat(defaultKubeConfig); statErr == nil {
			return clientcmd.BuildConfigFromFlags("", defaultKubeConfig)
		}
	}

	return rest.InClusterConfig()
}
