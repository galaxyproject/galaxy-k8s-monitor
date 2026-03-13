package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"galaxy-k8s-monitor/internal/store"
)

type Broadcaster struct {
	mu          sync.RWMutex
	subscribers map[chan Sample]struct{}
}

func NewBroadcaster() *Broadcaster {
	return &Broadcaster{subscribers: map[chan Sample]struct{}{}}
}

func (b *Broadcaster) Subscribe() chan Sample {
	channel := make(chan Sample, 32)
	b.mu.Lock()
	b.subscribers[channel] = struct{}{}
	b.mu.Unlock()
	return channel
}

func (b *Broadcaster) Unsubscribe(channel chan Sample) {
	b.mu.Lock()
	delete(b.subscribers, channel)
	close(channel)
	b.mu.Unlock()
}

func (b *Broadcaster) Publish(sample Sample) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	for channel := range b.subscribers {
		select {
		case channel <- sample:
		default:
		}
	}
}

type HandlerConfig struct {
	Namespace      string
	IntervalSecond int
	RetentionHours int
	BasePath       string
}

type Handlers struct {
	store       *store.RingBuffer
	config      HandlerConfig
	broadcaster *Broadcaster
	podGroups   func() []string
}

func NewHandlers(
	store *store.RingBuffer,
	config HandlerConfig,
	broadcaster *Broadcaster,
	podGroups func() []string,
) *Handlers {
	return &Handlers{
		store:       store,
		config:      config,
		broadcaster: broadcaster,
		podGroups:   podGroups,
	}
}

func (handlers *Handlers) Samples(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Content-Type", "application/json")

	limit := 0
	if value := request.URL.Query().Get("limit"); value != "" {
		parsedLimit, err := strconv.Atoi(value)
		if err == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}

	var since time.Time
	if value := request.URL.Query().Get("since"); value != "" {
		parsedTime, err := time.Parse(time.RFC3339, value)
		if err == nil {
			since = parsedTime
		}
	}

	samples := handlers.store.Since(since, limit)
	_ = json.NewEncoder(response).Encode(samples)
}

func (handlers *Handlers) Config(response http.ResponseWriter, _ *http.Request) {
	response.Header().Set("Content-Type", "application/json")

	payload := ConfigResponse{
		Namespace:      handlers.config.Namespace,
		IntervalSecond: handlers.config.IntervalSecond,
		RetentionHours: handlers.config.RetentionHours,
		BasePath:       handlers.config.BasePath,
		PodGroups:      handlers.podGroups(),
	}

	_ = json.NewEncoder(response).Encode(payload)
}

func (handlers *Handlers) Stream(response http.ResponseWriter, request *http.Request) {
	flusher, ok := response.(http.Flusher)
	if !ok {
		http.Error(response, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("Connection", "keep-alive")

	channel := handlers.broadcaster.Subscribe()
	defer handlers.broadcaster.Unsubscribe(channel)

	for {
		select {
		case <-request.Context().Done():
			return
		case sample := <-channel:
			payload, err := json.Marshal(sample)
			if err != nil {
				continue
			}

			_, _ = response.Write([]byte("event: sample\n"))
			_, _ = response.Write([]byte("data: "))
			_, _ = response.Write(payload)
			_, _ = response.Write([]byte("\n\n"))
			flusher.Flush()
		}
	}
}
