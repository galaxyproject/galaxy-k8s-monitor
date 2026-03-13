FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM golang:1.24-alpine AS go-build
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o galaxy-k8s-monitor .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=go-build /app/galaxy-k8s-monitor /galaxy-k8s-monitor
EXPOSE 8080
ENTRYPOINT ["/galaxy-k8s-monitor"]
