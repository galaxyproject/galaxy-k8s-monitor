package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"galaxy-k8s-monitor/cmd/server"
	"galaxy-k8s-monitor/internal/api"
	"galaxy-k8s-monitor/internal/collector"
	"galaxy-k8s-monitor/internal/model"
	"galaxy-k8s-monitor/internal/store"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsclientset "k8s.io/metrics/pkg/client/clientset/versioned"
)

const logTimeFormat = "2006-01-02 15:04:05,000"

type hybridLogHandler struct {
	mu          *sync.Mutex
	out         io.Writer
	attrBuf     *bytes.Buffer
	attrHandler slog.Handler
}

func newHybridLogHandler(out io.Writer, level slog.Level) *hybridLogHandler {
	attrBuf := &bytes.Buffer{}
	attrHandler := slog.NewTextHandler(attrBuf, &slog.HandlerOptions{
		Level: level,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if len(groups) == 0 && (a.Key == slog.TimeKey || a.Key == slog.LevelKey || a.Key == slog.MessageKey) {
				return slog.Attr{}
			}
			return a
		},
	})
	return &hybridLogHandler{
		mu:          &sync.Mutex{},
		out:         out,
		attrBuf:     attrBuf,
		attrHandler: attrHandler,
	}
}

func (h *hybridLogHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.attrHandler.Enabled(ctx, level)
}

func (h *hybridLogHandler) Handle(ctx context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.attrBuf.Reset()
	if err := h.attrHandler.Handle(ctx, r); err != nil {
		return err
	}
	attrs := bytes.TrimSpace(h.attrBuf.Bytes())

	var line bytes.Buffer
	line.WriteString(r.Time.Format(logTimeFormat))
	line.WriteByte(' ')
	line.WriteString(r.Level.String())
	line.WriteByte(' ')
	line.WriteString(r.Message)
	if len(attrs) > 0 {
		line.WriteByte(' ')
		line.Write(attrs)
	}
	line.WriteByte('\n')

	_, err := h.out.Write(line.Bytes())
	return err
}

func (h *hybridLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &hybridLogHandler{
		mu:          h.mu,
		out:         h.out,
		attrBuf:     h.attrBuf,
		attrHandler: h.attrHandler.WithAttrs(attrs),
	}
}

func (h *hybridLogHandler) WithGroup(name string) slog.Handler {
	return &hybridLogHandler{
		mu:          h.mu,
		out:         h.out,
		attrBuf:     h.attrBuf,
		attrHandler: h.attrHandler.WithGroup(name),
	}
}

func initLogger(verbose bool) {
	level := slog.LevelInfo
	if verbose {
		level = slog.LevelDebug
	}
	slog.SetDefault(slog.New(newHybridLogHandler(os.Stderr, level)))
}

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

func loadSeedSamples(path string) ([]model.Sample, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var samples []model.Sample
	if err := json.Unmarshal(raw, &samples); err == nil && len(samples) > 0 {
		return samples, nil
	}
	var wrapper struct {
		Samples []model.Sample `json:"samples"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Samples, nil
}

func main() {
	var (
		namespace      = flag.String("namespace", "galaxy", "Kubernetes namespace to monitor")
		interval       = flag.Duration("interval", 30*time.Second, "Sample interval")
		retentionHours = flag.Int("retention-hours", 24, "Sample retention duration in hours")
		listenAddress  = flag.String("address", ":8080", "HTTP listen address")
		kubeconfig     = flag.String("kubeconfig", "", "Path to kubeconfig (optional; falls back to KUBECONFIG env var or in-cluster)")
		basePath       = flag.String("base-path", "/", "Optional base path prefix, for example /monitor")
		seedFile       = flag.String("seed-file", "", "Optional JSON file of samples to pre-load into the ring buffer")
		verbose        = flag.Bool("verbose", false, "Enable debug-level logging")
	)
	flag.Parse()
	initLogger(*verbose)

	normalizedBasePath := normalizeBasePath(*basePath)
	capacity := int((time.Duration(*retentionHours) * time.Hour) / *interval)
	if capacity < 1 {
		capacity = 1
	}

	ring := store.NewRingBuffer(capacity)
	if *seedFile != "" {
		seeded, err := loadSeedSamples(*seedFile)
		if err != nil {
			slog.Error("failed to load seed file", "file", *seedFile, "err", err)
			os.Exit(1)
		}
		for _, sample := range seeded {
			ring.Append(sample)
		}
		slog.Info("loaded seed samples", "count", len(seeded), "file", *seedFile)
	}

	var coreClient kubernetes.Interface
	var metricsClient metricsclientset.Interface
	authSource := "offline-seed"
	if config, source, err := buildKubeConfig(*kubeconfig); err == nil {
		authSource = source
		coreClient, _ = kubernetes.NewForConfig(config)
		metricsClient, _ = metricsclientset.NewForConfig(config)
	} else if *seedFile == "" {
		slog.Error("failed to build kubernetes config", "err", err)
		os.Exit(1)
	} else {
		slog.Warn("running in offline seed-only mode", "err", err)
	}

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
		slog.Error("failed to initialize embedded frontend", "err", err)
		os.Exit(1)
	}

	router := server.NewRouter(server.Config{
		Address:     *listenAddress,
		BasePath:    normalizedBasePath,
		StaticFiles: frontendRoot,
		Handlers:    handlers,
		PodHandlers: &api.PodHandlers{Client: coreClient, Namespace: *namespace},
	})

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if coreClient != nil && metricsClient != nil {
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
		go collectorInstance.Run(ctx)
	}

	httpServer := &http.Server{
		Addr:              *listenAddress,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	slog.Info("starting galaxy-k8s-monitor",
		"address", *listenAddress,
		"base_path", normalizedBasePath,
		"namespace", *namespace,
		"interval", interval.String(),
		"retention_hours", *retentionHours,
		"buffer_capacity", capacity,
		"kube_auth", authSource,
	)

	go func() {
		<-ctx.Done()
		slog.Info("shutting down galaxy-k8s-monitor")
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if shutdownErr := httpServer.Shutdown(shutdownCtx); shutdownErr != nil {
			slog.Error("http shutdown error", "err", shutdownErr)
			return
		}
		slog.Info("galaxy-k8s-monitor stopped")
	}()

	if err = httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("http server failed", "err", err)
		os.Exit(1)
	}
}

func buildKubeConfig(kubeconfigFlag string) (*rest.Config, string, error) {
	if kubeconfigFlag != "" {
		cfg, err := clientcmd.BuildConfigFromFlags("", kubeconfigFlag)
		return cfg, "flag:" + kubeconfigFlag, err
	}

	if kubeconfigEnv := os.Getenv("KUBECONFIG"); kubeconfigEnv != "" {
		cfg, err := clientcmd.BuildConfigFromFlags("", kubeconfigEnv)
		return cfg, "env:KUBECONFIG", err
	}

	if homeDir, err := os.UserHomeDir(); err == nil {
		defaultKubeConfig := fmt.Sprintf("%s/.kube/config", homeDir)
		if _, statErr := os.Stat(defaultKubeConfig); statErr == nil {
			cfg, cfgErr := clientcmd.BuildConfigFromFlags("", defaultKubeConfig)
			return cfg, defaultKubeConfig, cfgErr
		}
	}

	cfg, err := rest.InClusterConfig()
	return cfg, "in-cluster", err
}
