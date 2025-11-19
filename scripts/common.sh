#!/bin/bash
# ============================================
# Ansible MCP Server - Common Functions
# ============================================
# Shared utilities for all management scripts
# Source this file: source "$(dirname "$0")/common.sh"
# ============================================

# Note: Don't use 'set -e' in sourced scripts as it can cause unexpected exits
# in parent scripts. Use explicit error handling instead.

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Emoji indicators
CHECK="[OK]"
CROSS="[FAIL]"
WARN="[WARN]"
INFO="[INFO]"
ARROW="-->"

# Determine directories
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
SRC_DIR="$PROJECT_DIR/src"

# Docker compose configuration
COMPOSE_FILE="$SRC_DIR/docker-compose.yml"
ENV_FILE="$PROJECT_DIR/.env"

# Docker compose command
docker_compose() {
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# ===== Logging Functions =====

log_info() {
    echo -e "${BLUE}${INFO}${NC} $1"
}

log_success() {
    echo -e "${GREEN}${CHECK}${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}${WARN}${NC} $1"
}

log_error() {
    echo -e "${RED}${CROSS}${NC} $1"
}

log_step() {
    echo -e "${CYAN}${ARROW}${NC} $1"
}

# ===== Prerequisite Checks =====

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found"
        echo "Please install Docker first: https://docs.docker.com/get-docker/"
        return 1
    fi

    if ! docker info &> /dev/null 2>&1; then
        log_error "Docker daemon not accessible"
        echo "Please start Docker or check permissions"
        return 1
    fi

    return 0
}

check_docker_compose() {
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose not found"
        echo "Please install Docker Compose v2+"
        return 1
    fi
    return 0
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    check_docker || return 1
    log_success "Docker: $(docker --version | cut -d' ' -f3 | cut -d',' -f1)"

    check_docker_compose || return 1
    log_success "Docker Compose: $(docker compose version --short)"

    if ! command -v git &> /dev/null; then
        log_warn "Git not found (optional)"
    else
        log_success "Git: $(git --version | cut -d' ' -f3)"
    fi

    return 0
}

# ===== Health Check Functions =====

# Wait for a service to become healthy
# Usage: wait_for_health "service_name" "port" "endpoint" [max_retries]
wait_for_health() {
    local service=$1
    local port=$2
    local endpoint=$3
    local max_retries=${4:-30}
    local retry=0

    echo -n "Waiting for $service"

    while [ $retry -lt $max_retries ]; do
        if curl -sf "http://localhost:$port$endpoint" > /dev/null 2>&1; then
            echo -e " ${GREEN}${CHECK}${NC}"
            return 0
        fi
        echo -n "."
        ((retry++))
        sleep 1
    done

    echo -e " ${RED}${CROSS}${NC}"
    log_error "Service $service failed to become healthy after ${max_retries}s"
    return 1
}

# Check if a port is listening
check_port() {
    local port=$1
    if command -v nc &> /dev/null; then
        nc -z localhost "$port" 2>/dev/null
    elif command -v curl &> /dev/null; then
        curl -sf --connect-timeout 1 "http://localhost:$port" > /dev/null 2>&1 || \
        curl -sf --connect-timeout 1 "https://localhost:$port" > /dev/null 2>&1
    else
        return 0  # Assume OK if no tools available
    fi
}

# Check all critical services health
check_all_services() {
    local failed=0

    log_info "Checking service health..."

    # Core infrastructure
    if check_port 6379; then
        log_success "Redis (6379)"
    else
        log_error "Redis (6379) - not responding"
        ((failed++))
    fi

    if check_port 5432; then
        log_success "PostgreSQL (5432)"
    else
        log_error "PostgreSQL (5432) - not responding"
        ((failed++))
    fi

    if check_port 8200; then
        log_success "Vault (8200)"
    else
        log_error "Vault (8200) - not responding"
        ((failed++))
    fi

    # Application services
    if curl -sf "http://localhost:3000/health" > /dev/null 2>&1; then
        log_success "MCP Server (3000)"
    else
        log_warn "MCP Server (3000) - not responding"
        ((failed++))
    fi

    if curl -sf "http://localhost:8000/health" > /dev/null 2>&1; then
        log_success "AI Generator (8000)"
    else
        log_warn "AI Generator (8000) - not responding"
        ((failed++))
    fi

    if curl -sf "http://localhost:3001/api/health" > /dev/null 2>&1; then
        log_success "Web UI (3001)"
    else
        log_warn "Web UI (3001) - not responding"
        ((failed++))
    fi

    # Monitoring (optional)
    if curl -sf "http://localhost:9090/-/healthy" > /dev/null 2>&1; then
        log_success "Prometheus (9090)"
    else
        log_warn "Prometheus (9090) - not responding (optional)"
    fi

    if curl -sf "http://localhost:3002/api/health" > /dev/null 2>&1; then
        log_success "Grafana (3002)"
    else
        log_warn "Grafana (3002) - not responding (optional)"
    fi

    return $failed
}

# ===== Configuration Validation =====

validate_env() {
    local errors=0
    local warnings=0

    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env file not found at $ENV_FILE"
        return 1
    fi

    # Export only variables defined in the env file
    while IFS='=' read -r key value; do
        # Ignore comments and empty lines
        if [[ -n "$key" && "$key" != \#* ]]; then
            # Remove leading/trailing whitespace and quotes
            key=$(echo "$key" | xargs)
            value=$(echo "$value" | sed 's/^["'"'"']//; s/["'"'"']$//')
            export "$key"="$value"
        fi
    done < "$ENV_FILE"

    # Check required variables
    if [ -z "$JWT_SECRET" ]; then
        log_error "JWT_SECRET not set"
        ((errors++))
    elif [ ${#JWT_SECRET} -lt 32 ]; then
        log_warn "JWT_SECRET too short (< 32 chars)"
        ((warnings++))
    fi

    if [ -z "$POSTGRES_PASSWORD" ]; then
        log_error "POSTGRES_PASSWORD not set"
        ((errors++))
    fi

    # Check API key based on provider
    local provider="${AI_PROVIDER:-openai}"
    local keyvar=""
    case "$provider" in
        openai) keyvar="OPENAI_API_KEY" ;;
        anthropic) keyvar="ANTHROPIC_API_KEY" ;;
        gemini) keyvar="GEMINI_API_KEY" ;;
    esac

    if [ -n "$keyvar" ] && [ -z "${!keyvar}" ]; then
        log_warn "$provider provider selected but $keyvar not set"
        ((warnings++))
    fi

    if [ $errors -gt 0 ]; then
        log_error "Configuration validation failed with $errors error(s)"
        return 1
    fi

    if [ $warnings -gt 0 ]; then
        log_warn "Configuration has $warnings warning(s)"
    else
        log_success "Configuration validated"
    fi

    return 0
}

# ===== Docker Utility Functions =====

# Check if a service is running
is_service_running() {
    local service=$1
    docker_compose ps --status running "$service" 2>/dev/null | grep -q "$service"
}

# Get list of running services
get_running_services() {
    docker_compose ps --status running --format "{{.Service}}" 2>/dev/null
}

# Check if any services are running
any_services_running() {
    [ -n "$(get_running_services)" ]
}

# Get service container ID
get_container_id() {
    local service=$1
    docker_compose ps -q "$service" 2>/dev/null
}

# ===== Backup Functions =====

create_backup() {
    local backup_dir="${1:-$PROJECT_DIR/backups/$(date +%Y%m%d_%H%M%S)}"

    mkdir -p "$backup_dir"
    log_info "Creating backup in $backup_dir..."

    # Backup .env
    if [ -f "$ENV_FILE" ]; then
        cp "$ENV_FILE" "$backup_dir/.env.backup"
        log_success "Backed up .env"
    fi

    # Backup PostgreSQL
    if is_service_running postgres; then
        log_step "Backing up PostgreSQL database..."
        docker_compose exec -T postgres pg_dump \
            -U "${POSTGRES_USER:-ansible_mcp}" \
            "${POSTGRES_DB:-awx}" > "$backup_dir/postgres.sql" 2>/dev/null
        if [ $? -eq 0 ]; then
            log_success "Backed up PostgreSQL"
        else
            log_warn "PostgreSQL backup failed"
        fi
    fi

    # Backup Redis
    if is_service_running redis; then
        log_step "Backing up Redis data..."
        docker_compose exec -T redis redis-cli BGSAVE > /dev/null 2>&1
        # Wait for BGSAVE to complete
        local max_wait=60
        local waited=0
        while [ $waited -lt $max_wait ]; do
            local bgsave_in_progress=$(docker_compose exec -T redis redis-cli INFO persistence 2>/dev/null | grep -E '^rdb_bgsave_in_progress:' | awk -F: '{print $2}' | tr -d '\r')
            if [ "$bgsave_in_progress" = "0" ]; then
                break
            fi
            sleep 1
            ((waited++))
        done
        local redis_container=$(get_container_id redis)
        if [ -n "$redis_container" ]; then
            docker cp "$redis_container:/data/dump.rdb" "$backup_dir/redis.rdb" 2>/dev/null
            if [ $? -eq 0 ]; then
                log_success "Backed up Redis"
            else
                log_warn "Redis backup failed"
            fi
        else
            log_warn "Redis container not found"
        fi
    fi

    # Backup monitoring configs
    if [ -d "$SRC_DIR/monitoring" ]; then
        cp -r "$SRC_DIR/monitoring" "$backup_dir/"
        log_success "Backed up monitoring configs"
    fi

    log_success "Backup complete: $backup_dir"
    echo "$backup_dir"
}

# ===== Service Management Helpers =====

# Define service groups
CORE_SERVICES="redis vault postgres"
APP_SERVICES="ansible-mcp ai-generator web-ui"
MONITORING_SERVICES="prometheus grafana redis-exporter"
OPTIONAL_SERVICES="gitlab"

# Get services for installation type
get_services_for_type() {
    local type=$1

    case $type in
        1|minimal)
            echo "ansible-mcp ai-generator redis vault postgres"
            ;;
        2|standard)
            echo "ansible-mcp ai-generator web-ui redis vault postgres prometheus grafana redis-exporter"
            ;;
        3|full)
            echo ""  # All services
            ;;
        *)
            echo "ansible-mcp ai-generator web-ui redis vault postgres prometheus grafana redis-exporter"
            ;;
    esac
}

# Get build services for installation type
get_build_services_for_type() {
    local type=$1

    case $type in
        1|minimal)
            echo "ansible-mcp ai-generator"
            ;;
        2|standard|3|full)
            echo "ansible-mcp ai-generator web-ui"
            ;;
        *)
            echo "ansible-mcp ai-generator web-ui"
            ;;
    esac
}

# Print banner
print_banner() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Ansible MCP Server${NC}"
    echo -e "${GREEN}  $1${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
}

# Print access URLs
print_urls() {
    local type=${1:-2}

    echo ""
    echo "Access URLs:"
    echo "  - MCP Server:  http://localhost:3000"
    echo "  - Health:      http://localhost:3000/health"
    echo "  - Vault:       http://localhost:8200"

    if [ "$type" -ge 2 ] 2>/dev/null; then
        echo "  - Web UI:      http://localhost:3001"
        echo "  - Grafana:     http://localhost:3002"
        echo "  - Prometheus:  http://localhost:9090"
    fi

    if [ "$type" -eq 3 ] 2>/dev/null; then
        echo "  - GitLab:      http://localhost:8080"
    fi
    echo ""
}
