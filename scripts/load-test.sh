#!/bin/bash
# =============================================================================
# Long-Running Load Test Script for Observability Demo
# Generates sustained traffic with error scenarios for Grafana dashboard demos
#
# Usage:
#   ./scripts/load-test.sh [OPTIONS] [DURATION_MINUTES]
#
# Options:
#   --clean    Restart services + observability stack before the test so
#              Prometheus, Jaeger and in-memory stores all start fresh.
#              Ideal before recording a demo screencast.
#
# Examples:
#   ./scripts/load-test.sh                  # 10 min, no cleanup
#   ./scripts/load-test.sh 30               # 30 min, no cleanup
#   ./scripts/load-test.sh --clean          # 10 min, clean start
#   ./scripts/load-test.sh --clean 30       # 30 min, clean start
# =============================================================================

set -euo pipefail

# --- Argument parsing -------------------------------------------------------
DO_CLEAN=false
DURATION_MINUTES=10

for arg in "$@"; do
  case "$arg" in
    --clean) DO_CLEAN=true ;;
    [0-9]*)  DURATION_MINUTES="$arg" ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# --- Config ------------------------------------------------------------------
GATEWAY="http://localhost:3000"
DURATION_SECONDS=$((DURATION_MINUTES * 60))

# Request intervals (seconds between batches in each phase)
NORMAL_INTERVAL=1      # ~1 req/s steady state
SPIKE_INTERVAL=0.1     # ~10 req/s during traffic spikes
ERROR_BURST_INTERVAL=0.2

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
RESET='\033[0m'

# Counters (written to tmp files for subshell visibility)
TMPDIR_STATS=$(mktemp -d)
echo 0 > "$TMPDIR_STATS/ok"
echo 0 > "$TMPDIR_STATS/err"
echo 0 > "$TMPDIR_STATS/total"

START_TIME=$(date +%s)

# --- Cleanup -----------------------------------------------------------------

do_cleanup() {
  log_phase "Pre-test Cleanup"

  log_info "Restarting microservices (clears in-memory state)..."
  docker compose restart api-gateway user-service order-service notification-service redis \
    2>&1 | sed 's/^/  /'

  log_info "Restarting Prometheus (clears metric history)..."
  docker compose restart prometheus 2>&1 | sed 's/^/  /'

  log_info "Restarting Jaeger (clears trace history)..."
  docker compose restart jaeger 2>&1 | sed 's/^/  /'

  log_info "Waiting 10s for services to stabilise after restart..."
  sleep 10

  log_ok "Cleanup complete — all stores and metrics reset."
}

# --- Helpers -----------------------------------------------------------------

inc() { echo $(( $(cat "$TMPDIR_STATS/$1") + 1 )) > "$TMPDIR_STATS/$1"; }

log_ok()    { echo -e "${GREEN}[OK ]${RESET} $*"; inc ok;    inc total; }
log_err()   { echo -e "${RED}[ERR]${RESET} $*"; inc err;   inc total; }
log_info()  { echo -e "${CYAN}[---]${RESET} $*"; }
log_phase() { echo -e "\n${BOLD}${MAGENTA}$(banner_line '─' "$*")${RESET}\n"; }

elapsed()  { echo $(( $(date +%s) - START_TIME )); }
remaining(){ echo $(( DURATION_SECONDS - $(elapsed) )); }

# Compact silent curl: returns HTTP status code
req() {
  local method="$1" url="$2"; shift 2
  curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" "$@"
}

# Curl with response body (for extracting IDs)
req_body() {
  local method="$1" url="$2"; shift 2
  curl -s -X "$method" "$url" "$@"
}

# Print a live stats line
stats_line() {
  local ok err total elapsed_s
  ok=$(cat "$TMPDIR_STATS/ok")
  err=$(cat "$TMPDIR_STATS/err")
  total=$(cat "$TMPDIR_STATS/total")
  elapsed_s=$(elapsed)
  local remaining_s; remaining_s=$(remaining)
  local rps="0.0"
  [[ $elapsed_s -gt 0 ]] && rps=$(awk -v t="$total" -v e="$elapsed_s" 'BEGIN{printf "%.1f", t/e}')
  printf "${BOLD}  Stats: ${GREEN}%d OK${RESET} | ${RED}%d ERR${RESET} | total %d | %s req/s | elapsed %dm%ds | remaining %dm%ds${RESET}\n" \
    "$ok" "$err" "$total" "$rps" \
    "$((elapsed_s / 60))" "$((elapsed_s % 60))" \
    "$((remaining_s / 60))" "$((remaining_s % 60))"
}

# ─── UI helpers ────────────────────────────────────────────────────────────
# Change BOX_WIDTH to resize ALL UI elements (boxes, banners, rules) at once.
BOX_WIDTH=80
BOX_INNER=$(( BOX_WIDTH - 2 ))        # chars between the two border columns
BOX_CONTENT=$(( BOX_INNER - 2 ))      # text area (1-space padding on each side)

# Repeat CHAR exactly N times (safe for multi-byte UTF-8 chars)
_repeat() { local char="$1" n="$2"; printf "%.0s${char}" $(seq 1 "$n"); }

# Full-width banner: banner_line CHAR TEXT  (fills BOX_WIDTH, text centered)
banner_line() {
  local char="$1" text=" $2 "
  local len=${#text} lpad rpad
  lpad=$(( (BOX_WIDTH - len) / 2 ))
  rpad=$(( BOX_WIDTH - len - lpad ))
  [[ $lpad -lt 1 ]] && lpad=1
  [[ $rpad -lt 1 ]] && rpad=1
  printf '%s%s%s\n' "$(_repeat "$char" "$lpad")" "$text" "$(_repeat "$char" "$rpad")"
}

# Box components
_box_rule() { _repeat '═' "$BOX_INNER"; }
box_top()    { printf '╔%s╗\n' "$(_box_rule)"; }
box_sep()    { printf '╠%s╣\n' "$(_box_rule)"; }
box_bot()    { printf '╚%s╝\n' "$(_box_rule)"; }
box_row()    { printf "║ %-${BOX_CONTENT}s ║\n" "$*"; }
box_center() {
  local text="$*" len pad_l pad_r
  len=${#text}
  pad_l=$(( (BOX_INNER - len) / 2 ))
  pad_r=$(( BOX_INNER - len - pad_l ))
  printf '║%*s%s%*s║\n' "$pad_l" '' "$text" "$pad_r" ''
}

# Cleanup on exit
cleanup() {
  echo -e "\n${YELLOW}Interrupted — final stats:${RESET}"
  stats_line
  rm -rf "$TMPDIR_STATS"
  exit 0
}
trap cleanup INT TERM

# --- Seed data helpers -------------------------------------------------------

# Pre-create a pool of users and orders to use across the test
USER_IDS=()
ORDER_IDS=()
NAMES=("Alice Johnson" "Bob Smith" "Carol White" "Dave Brown" "Eva Martinez"
       "Frank Lee"    "Grace Kim"  "Hank Wilson" "Iris Chen" "Jack Taylor")
EMAILS=("alice" "bob" "carol" "dave" "eva" "frank" "grace" "hank" "iris" "jack")
ITEMS_POOL=(
  '["Laptop","Mouse"]'
  '["Keyboard","Monitor"]'
  '["Headphones"]'
  '["Webcam","USB Hub","SSD"]'
  '["Desk Chair"]'
  '["Phone Stand","Charger"]'
)

seed_data() {
  log_info "Seeding initial users and orders..."
  for i in "${!NAMES[@]}"; do
    local ts; ts=$(date +%s%N | tail -c 6)
    local body; body=$(req_body POST "$GATEWAY/api/users" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"${NAMES[$i]}\",\"email\":\"${EMAILS[$i]}_${ts}@demo.com\"}")
    local id; id=$(echo "$body" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
    if [[ -n "$id" ]]; then
      USER_IDS+=("$id")
      log_ok "Seeded user ${NAMES[$i]} (id=$id)"
    fi
  done

  # Create one order per user
  for uid in "${USER_IDS[@]}"; do
    local items="${ITEMS_POOL[$((RANDOM % ${#ITEMS_POOL[@]}))]}"
    local total; total=$(awk -v r1="$((RANDOM % 1500))" -v r2="$((RANDOM % 99))" 'BEGIN{printf "%.2f", r1 + 10 + r2/100}')
    local body; body=$(req_body POST "$GATEWAY/api/orders" \
      -H "Content-Type: application/json" \
      -d "{\"userId\":$uid,\"items\":$items,\"total\":$total}")
    local oid; oid=$(echo "$body" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
    if [[ -n "$oid" ]]; then
      ORDER_IDS+=("$oid")
      log_ok "Seeded order (id=$oid) for user $uid"
    fi
  done
}

# --- Traffic generators ------------------------------------------------------

# Happy path: random read + write operations
normal_traffic() {
  local pick=$((RANDOM % 8))
  local status

  case $pick in
    0) # health check
       status=$(req GET "$GATEWAY/health")
       [[ "$status" == "200" ]] && log_ok "GET /health → $status" || log_err "GET /health → $status"
       ;;
    1) # list users
       status=$(req GET "$GATEWAY/api/users")
       [[ "$status" == "200" ]] && log_ok "GET /api/users → $status" || log_err "GET /api/users → $status"
       ;;
    2) # get known user
       if [[ ${#USER_IDS[@]} -gt 0 ]]; then
         local uid="${USER_IDS[$((RANDOM % ${#USER_IDS[@]}))]}"
         status=$(req GET "$GATEWAY/api/users/$uid")
         [[ "$status" == "200" ]] && log_ok "GET /api/users/$uid → $status" || log_err "GET /api/users/$uid → $status"
       fi
       ;;
    3) # list orders
       status=$(req GET "$GATEWAY/api/orders")
       [[ "$status" == "200" ]] && log_ok "GET /api/orders → $status" || log_err "GET /api/orders → $status"
       ;;
    4) # get known order
       if [[ ${#ORDER_IDS[@]} -gt 0 ]]; then
         local oid="${ORDER_IDS[$((RANDOM % ${#ORDER_IDS[@]}))]}"
         status=$(req GET "$GATEWAY/api/orders/$oid")
         [[ "$status" == "200" ]] && log_ok "GET /api/orders/$oid → $status" || log_err "GET /api/orders/$oid → $status"
       fi
       ;;
    5) # create new user
       local ts; ts=$(date +%s%N | tail -c 6)
       local body; body=$(req_body POST "$GATEWAY/api/users" \
         -H "Content-Type: application/json" \
         -d "{\"name\":\"Demo User $ts\",\"email\":\"demo_$ts@test.com\"}")
       local nid; nid=$(echo "$body" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
       if [[ -n "$nid" ]]; then
         USER_IDS+=("$nid")
         log_ok "POST /api/users → 201 (id=$nid)"
       else
         log_err "POST /api/users → unexpected response"
       fi
       ;;
    6|7) # create new order for a known user
       if [[ ${#USER_IDS[@]} -gt 0 ]]; then
         local uid="${USER_IDS[$((RANDOM % ${#USER_IDS[@]}))]}"
         local items="${ITEMS_POOL[$((RANDOM % ${#ITEMS_POOL[@]}))]}"
         local total; total=$(awk -v r1="$((RANDOM % 2000))" -v r2="$((RANDOM % 99))" 'BEGIN{printf "%.2f", r1 + 5 + r2/100}')
         local body; body=$(req_body POST "$GATEWAY/api/orders" \
           -H "Content-Type: application/json" \
           -d "{\"userId\":$uid,\"items\":$items,\"total\":$total}")
         local nid; nid=$(echo "$body" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
         if [[ -n "$nid" ]]; then
           ORDER_IDS+=("$nid")
           log_ok "POST /api/orders → 201 (id=$nid, user=$uid)"
         else
           log_err "POST /api/orders → unexpected response"
         fi
       fi
       ;;
  esac
}

# Error scenarios: deliberately bad requests to generate error metrics
error_traffic() {
  local pick=$((RANDOM % 7))
  local status

  case $pick in
    0) # non-existent user
       status=$(req GET "$GATEWAY/api/users/999999")
       log_err "GET /api/users/999999 → $status (expected 4xx/5xx)"
       ;;
    1) # non-existent order
       status=$(req GET "$GATEWAY/api/orders/999999")
       log_err "GET /api/orders/999999 → $status (expected 4xx/5xx)"
       ;;
    2) # missing required fields on user creation
       status=$(req POST "$GATEWAY/api/users" \
         -H "Content-Type: application/json" \
         -d '{}')
       log_err "POST /api/users {} → $status (bad payload)"
       ;;
    3) # order with invalid userId
       status=$(req POST "$GATEWAY/api/orders" \
         -H "Content-Type: application/json" \
         -d '{"userId":999999,"items":["Ghost Item"],"total":0}')
       log_err "POST /api/orders invalid userId → $status"
       ;;
    4) # order with missing fields
       status=$(req POST "$GATEWAY/api/orders" \
         -H "Content-Type: application/json" \
         -d '{"items":["Item"]}')
       log_err "POST /api/orders missing userId → $status"
       ;;
    5) # non-numeric order ID → parseInt returns NaN → order not found → 404
       # Reaches the gateway /api/orders/:id handler → requestCounter + errorCounter both fire
       status=$(req GET "$GATEWAY/api/orders/not-a-number")
       log_err "GET /api/orders/not-a-number → $status (NaN id, fully instrumented)"
       ;;
    6) # valid JSON but string total triggers a 500 in order-service → gateway errorCounter fires
       # Also causes ordersErrors.add(1) + SpanStatusCode.ERROR on the order-service span
       if [[ ${#USER_IDS[@]} -gt 0 ]]; then
         local uid="${USER_IDS[$((RANDOM % ${#USER_IDS[@]}))]}"
         status=$(req POST "$GATEWAY/api/orders" \
           -H "Content-Type: application/json" \
           -d "{\"userId\":$uid,\"items\":[\"Broken Item\"],\"total\":\"not-a-number\"}")
         log_err "POST /api/orders total=string → $status (type error, 5xx)"
       fi
       ;;
  esac
}

# Spike: fire N requests as fast as possible to stress the metrics
traffic_spike() {
  local count="${1:-20}"
  log_info "  Firing spike: $count rapid requests..."
  for ((i=0; i<count; i++)); do
    normal_traffic &
    sleep "$SPIKE_INTERVAL"
  done
  wait
}

# Mixed burst: errors interleaved with valid requests
mixed_burst() {
  local count="${1:-10}"
  log_info "  Firing mixed burst: $count requests (~50% errors)..."
  for ((i=0; i<count; i++)); do
    if (( i % 2 == 0 )); then
      error_traffic &
    else
      normal_traffic &
    fi
    sleep "$ERROR_BURST_INTERVAL"
  done
  wait
}

# --- Phase definitions -------------------------------------------------------

phase_ramp_up() {
  log_phase "Phase 1 — Ramp Up (30s)"
  local end=$(( $(date +%s) + 30 ))
  local interval=2
  while [[ $(date +%s) -lt $end && $(remaining) -gt 0 ]]; do
    normal_traffic
    sleep "$interval"
    interval=$(awk -v i="$interval" 'BEGIN{printf "%.1f", i - 0.1}')
    [[ $(awk -v i="$interval" 'BEGIN{print (i < 0.3) ? 1 : 0}') -eq 1 ]] && interval=0.3
  done
  stats_line
}

phase_steady_state() {
  local duration="${1:-60}"
  log_phase "Phase — Steady State (${duration}s)"
  local end=$(( $(date +%s) + duration ))
  while [[ $(date +%s) -lt $end && $(remaining) -gt 0 ]]; do
    normal_traffic
    sleep "$NORMAL_INTERVAL"
  done
  stats_line
}

phase_error_burst() {
  log_phase "Phase — Error Burst (20s)"
  local end=$(( $(date +%s) + 20 ))
  while [[ $(date +%s) -lt $end && $(remaining) -gt 0 ]]; do
    error_traffic
    sleep "$ERROR_BURST_INTERVAL"
  done
  stats_line
}

phase_traffic_spike() {
  log_phase "Phase — Traffic Spike (15s)"
  local end=$(( $(date +%s) + 15 ))
  while [[ $(date +%s) -lt $end && $(remaining) -gt 0 ]]; do
    traffic_spike 5
    sleep 2
  done
  stats_line
}

phase_chaos() {
  log_phase "Phase — Chaos (mixed errors + spikes, 30s)"
  local end=$(( $(date +%s) + 30 ))
  while [[ $(date +%s) -lt $end && $(remaining) -gt 0 ]]; do
    mixed_burst 6
    sleep 1
  done
  stats_line
}

phase_recovery() {
  local duration="${1:-60}"
  log_phase "Phase — Recovery / Cool Down (${duration}s)"
  local end=$(( $(date +%s) + duration ))
  while [[ $(date +%s) -lt $end && $(remaining) -gt 0 ]]; do
    normal_traffic
    sleep $(awk -v i="$NORMAL_INTERVAL" 'BEGIN{printf "%.1f", i * 2}')
  done
  stats_line
}

# --- Main --------------------------------------------------------------------

echo -e "${BOLD}${BLUE}"
box_top
box_center "Observability Load Test — Demo Mode"
box_sep
box_row "Target   : $GATEWAY"
box_row "$(printf 'Duration : %2d minutes (%5d seconds)' "$DURATION_MINUTES" "$DURATION_SECONDS")"
if $DO_CLEAN; then
  box_row "Cleanup  : YES — stack will be restarted"
else
  box_row "Cleanup  : no"
fi
box_sep
box_row "Grafana   : http://localhost:3100"
box_row "Jaeger    : http://localhost:16686"
box_row "Prometheus: http://localhost:9090"
box_bot
echo -e "${RESET}"

# --- Optional start delay ---------------------------------------------------
log_info "Waiting 5 seconds before starting test..."
sleep 5

# Optionally clean the stack before the test run
$DO_CLEAN && do_cleanup

# Wait for API Gateway to be available
log_info "Waiting for API Gateway to be ready..."
until curl -sf "$GATEWAY/health" > /dev/null 2>&1; do
  echo -e "  ${YELLOW}...not ready yet, retrying in 3s${RESET}"
  sleep 3
done
log_ok "API Gateway is up!"

# Seed initial data
seed_data
echo ""

# ── Cyclic phase loop ──────────────────────────────────────────────────────
# Each cycle is ~3 minutes. Repeats until DURATION is reached.
CYCLE=1
while [[ $(remaining) -gt 0 ]]; do

  echo -e "\n${BOLD}${BLUE}$(banner_line '━' "Cycle $CYCLE — $(remaining)s remaining")${RESET}"

  # Ramp up only in the first cycle
  [[ $CYCLE -eq 1 ]] && phase_ramp_up

  [[ $(remaining) -gt 0 ]] && phase_steady_state 60
  [[ $(remaining) -gt 0 ]] && phase_traffic_spike
  [[ $(remaining) -gt 0 ]] && phase_steady_state 30
  [[ $(remaining) -gt 0 ]] && phase_error_burst
  [[ $(remaining) -gt 0 ]] && phase_steady_state 30
  [[ $(remaining) -gt 0 ]] && phase_chaos
  [[ $(remaining) -gt 0 ]] && phase_recovery 30

  CYCLE=$((CYCLE + 1))
done

# ── Final Summary ──────────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}"
box_top
box_center "Load Test Complete!"
box_bot
echo -e "${RESET}"
stats_line
echo ""
echo -e "  ${CYAN}Grafana dashboards  →  http://localhost:3100${RESET}"
echo -e "  ${CYAN}Jaeger traces       →  http://localhost:16686${RESET}"
echo -e "  ${CYAN}Prometheus metrics  →  http://localhost:9090${RESET}"
echo ""

rm -rf "$TMPDIR_STATS"
