#!/bin/bash
# GALAXY RESOURCE MONITORING SCRIPT
# --------------------------------
# Purpose: Profiles CPU and Memory usage for all pods in the 'galaxy' namespace.
# Requirements:
#   - kubectl installed and available in PATH.
#   - A valid kubeconfig file at /Users/ea/projects/galaxy-k8s-boot/tmp-kubeconfig.yml
#
# Usage:
#   chmod +x monitor_galaxy.sh
#   ./monitor_galaxy.sh
#   ./monitor_galaxy.sh --forever

LOG_FILE="galaxy_usage_report-$(date +%m-%d-%H-%M).log"
DEFAULT_KUBECONFIG="/Users/ea/projects/galaxy-k8s-boot/tmp-kubeconfig.yml"
if [[ -f "$DEFAULT_KUBECONFIG" ]]; then
    KUBECONFIG="$DEFAULT_KUBECONFIG"
elif [[ -z "${KUBECONFIG:-}" ]]; then
    echo "Error: $DEFAULT_KUBECONFIG not found and KUBECONFIG env var is not set."
    exit 1
fi
INTERVAL=10   # seconds between polls
SAMPLES=90    # 90 samples * 10s = 15 minutes total
FOREVER=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --forever|-f) FOREVER=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo "Monitoring started at $(date)" > "$LOG_FILE"
if [[ "$FOREVER" == "true" ]]; then
    echo "Config: Interval=${INTERVAL}s, Samples=unlimited" >> "$LOG_FILE"
else
    echo "Config: Interval=${INTERVAL}s, Samples=${SAMPLES}, Total Time=$((INTERVAL * SAMPLES / 60))m" >> "$LOG_FILE"
fi

sample=0
while true; do
    sample=$((sample + 1))
    if [[ "$FOREVER" == "false" && $sample -gt $SAMPLES ]]; then
        break
    fi
    if [[ "$FOREVER" == "true" ]]; then
        echo "--- Sample $sample at $(date) ---" >> "$LOG_FILE"
    else
        echo "--- Sample $sample of $SAMPLES at $(date) ---" >> "$LOG_FILE"
    fi

    usage=$(kubectl top pods -n galaxy --kubeconfig "$KUBECONFIG" 2>/dev/null \
        | tail -n +2 | awk '{print $1, $2, $3}' | sort -k1)

    requests=$(kubectl get pods -n galaxy --kubeconfig "$KUBECONFIG" \
        --no-headers \
        -o custom-columns='NAME:.metadata.name,CPU_REQ:.spec.containers[*].resources.requests.cpu,MEM_REQ:.spec.containers[*].resources.requests.memory' \
        2>/dev/null | awk '{print $1, $2, $3}' | sort -k1)

    {
        printf "%-55s %10s %10s %11s %10s\n" "POD" "CPU(use)" "CPU(req)" "MEM(use)" "MEM(req)"
        printf "%-55s %10s %10s %11s %10s\n" "---" "--------" "--------" "--------" "--------"
        join -j1 -a1 \
            <(echo "$usage") \
            <(echo "$requests") \
        | awk '{
            printf "%-55s %10s %10s %11s %10s\n",
                $1,
                ($2 ? $2 : "n/a"), ($4 ? $4 : "n/a"),
                ($3 ? $3 : "n/a"), ($5 ? $5 : "n/a")
        }'
    } >> "$LOG_FILE" 2>&1

    sleep "$INTERVAL"
done

echo "Monitoring finished at $(date)" >> "$LOG_FILE"
