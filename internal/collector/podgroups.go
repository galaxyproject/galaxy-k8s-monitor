package collector

import "strings"

func GroupPodName(podName string) string {
	knownPrefixes := []string{
		"galaxy-celery-beat",
		"galaxy-celery",
		"galaxy-nginx",
		"galaxy-postgres",
		"galaxy-rabbitmq",
		"galaxy-tusd",
		"galaxy-web",
		"galaxy-workflow",
		"galaxy-init-mounts",
		"galaxy-job",
	}

	for _, prefix := range knownPrefixes {
		if strings.Contains(podName, prefix) {
			return prefix
		}
	}

	parts := strings.Split(podName, "-")
	if len(parts) >= 2 {
		return parts[0] + "-" + parts[1]
	}

	return podName
}
