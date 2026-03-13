package store

import (
	"sort"
	"sync"
	"time"

	"galaxy-k8s-monitor/internal/model"
)

type RingBuffer struct {
	mu       sync.RWMutex
	items    []model.Sample
	start    int
	count    int
	capacity int
}

func NewRingBuffer(capacity int) *RingBuffer {
	if capacity < 1 {
		capacity = 1
	}

	return &RingBuffer{
		items:    make([]model.Sample, capacity),
		capacity: capacity,
	}
}

func (r *RingBuffer) Append(sample model.Sample) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.count < r.capacity {
		index := (r.start + r.count) % r.capacity
		r.items[index] = sample
		r.count++
		return
	}

	r.items[r.start] = sample
	r.start = (r.start + 1) % r.capacity
}

func (r *RingBuffer) All() []model.Sample {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]model.Sample, 0, r.count)
	for i := 0; i < r.count; i++ {
		index := (r.start + i) % r.capacity
		result = append(result, r.items[index])
	}
	return result
}

func (r *RingBuffer) Since(since time.Time, limit int) []model.Sample {
	all := r.All()
	if since.IsZero() {
		if limit > 0 && limit < len(all) {
			return all[len(all)-limit:]
		}
		return all
	}

	position := sort.Search(len(all), func(index int) bool {
		return !all[index].Timestamp.Before(since)
	})
	filtered := all[position:]
	if limit > 0 && limit < len(filtered) {
		return filtered[len(filtered)-limit:]
	}
	return filtered
}
