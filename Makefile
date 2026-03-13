REGISTRY := afgane
BINARY_NAME := galaxy-k8s-monitor
IMAGE_NAME := $(REGISTRY)/$(BINARY_NAME):latest

.PHONY: frontend-build backend-build run docker-build docker-push tidy

frontend-build:
	cd frontend && npm install && npm run build

backend-build:
	go build -o $(BINARY_NAME) .

run:
	go run . --namespace galaxy --interval 30s --retention-hours 24 --address :8080

docker-build:
	docker build -t $(IMAGE_NAME) .

docker-push:
	docker push $(IMAGE_NAME)

tidy:
	go mod tidy
