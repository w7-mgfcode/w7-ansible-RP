#!/bin/bash
# ============================================
# Ansible MCP Server - Update Script
# ============================================
# Incrementally updates the deployment
# Only rebuilds services with changes
# Run with: ./update.sh [--rebuild] [--backup] [--force]
# ============================================

# Source common functions
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/common.sh"

# Parse arguments
FORCE_REBUILD=false
CREATE_BACKUP=false
FORCE_ALL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --rebuild)
            FORCE_REBUILD=true
            shift
            ;;
        --backup)
            CREATE_BACKUP=true
            shift
            ;;
        --force)
            FORCE_ALL=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --rebuild    Force rebuild of all custom services"
            echo "  --backup     Create backup before updating"
            echo "  --force      Force restart all services"
            echo "  -h, --help   Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

print_banner "Update"

# ===== Check Prerequisites =====
check_prerequisites || exit 1

# Check if services are running
if ! any_services_running; then
    log_error "No services are running"
    echo "Use install.sh to start the services first"
    exit 1
fi

# Validate configuration
validate_env || {
    log_warn "Configuration has issues, proceeding with caution..."
}

echo ""

# ===== Create Backup =====
if [ "$CREATE_BACKUP" = true ]; then
    log_info "Creating backup before update..."
    BACKUP_DIR=$(create_backup)
    log_success "Backup saved to: $BACKUP_DIR"
    echo ""
fi

# ===== Check for Changes =====
CACHE_DIR="$PROJECT_DIR/.build-cache"
mkdir -p "$CACHE_DIR"

# Function to get source checksum for a service
get_source_checksum() {
    local service=$1
    local checksum=""
    local files=""

    case $service in
        ansible-mcp)
            files=$(find "$SRC_DIR/server" -name "*.ts" -type f 2>/dev/null)
            ;;
        ai-generator)
            files=$(find "$SRC_DIR/server" -name "*.py" -type f 2>/dev/null)
            ;;
        web-ui)
            files=$(find "$SRC_DIR/web-ui" \( -name "*.ts" -o -name "*.tsx" \) -type f 2>/dev/null)
            ;;
    esac

    # Get mtimes using cross-platform helper and compute checksum
    if [ -n "$files" ]; then
        checksum=$(echo "$files" | while read -r file; do
            get_file_mtime "$file"
        done | sort | md5sum | cut -d' ' -f1)
    fi

    echo "$checksum"
}

# Function to check if service needs rebuild
needs_rebuild() {
    local service=$1

    if [ "$FORCE_REBUILD" = true ]; then
        return 0
    fi

    local current_checksum=$(get_source_checksum "$service")
    local cached_checksum=""

    if [ -f "$CACHE_DIR/$service" ]; then
        cached_checksum=$(cat "$CACHE_DIR/$service")
    fi

    if [ "$current_checksum" != "$cached_checksum" ]; then
        return 0  # Needs rebuild
    fi

    return 1  # No rebuild needed
}

# Save checksum after successful build
save_checksum() {
    local service=$1
    local checksum=$(get_source_checksum "$service")
    echo "$checksum" > "$CACHE_DIR/$service"
}

# ===== Determine What to Update =====
log_info "Checking for changes..."

SERVICES_TO_REBUILD=""
SERVICES_TO_RESTART=""

# Check custom services
for service in ansible-mcp ai-generator web-ui; do
    if is_service_running "$service"; then
        if needs_rebuild "$service"; then
            SERVICES_TO_REBUILD="$SERVICES_TO_REBUILD $service"
            log_step "$service - changes detected, will rebuild"
        else
            if [ "$FORCE_ALL" = true ]; then
                SERVICES_TO_RESTART="$SERVICES_TO_RESTART $service"
                log_step "$service - force restart"
            else
                log_success "$service - no changes"
            fi
        fi
    fi
done

# Infrastructure services (only restart if forced)
if [ "$FORCE_ALL" = true ]; then
    for service in redis vault postgres prometheus grafana; do
        if is_service_running "$service"; then
            SERVICES_TO_RESTART="$SERVICES_TO_RESTART $service"
        fi
    done
fi

# ===== Nothing to Update =====
if [ -z "$SERVICES_TO_REBUILD" ] && [ -z "$SERVICES_TO_RESTART" ]; then
    echo ""
    log_success "All services are up to date!"
    echo ""
    echo "Use --rebuild to force rebuild custom services"
    echo "Use --force to restart all services"
    exit 0
fi

echo ""

# ===== Rebuild Services =====
if [ -n "$SERVICES_TO_REBUILD" ]; then
    log_info "Rebuilding services:$SERVICES_TO_REBUILD"

    for service in $SERVICES_TO_REBUILD; do
        log_step "Building $service..."

        if ! docker_compose build "$service"; then
            log_error "Failed to build $service"
            exit 1
        fi

        # Save checksum after successful build
        save_checksum "$service"
        log_success "Built $service"
    done

    echo ""
    log_info "Restarting rebuilt services..."

    for service in $SERVICES_TO_REBUILD; do
        log_step "Restarting $service..."
        docker_compose up -d --no-deps "$service"
    done
fi

# ===== Restart Services =====
if [ -n "$SERVICES_TO_RESTART" ]; then
    echo ""
    log_info "Restarting services:$SERVICES_TO_RESTART"

    for service in $SERVICES_TO_RESTART; do
        log_step "Restarting $service..."
        docker_compose restart "$service"
    done
fi

# ===== Wait for Health =====
echo ""
log_info "Waiting for services to become healthy..."

# Wait for rebuilt/restarted application services
for service in $SERVICES_TO_REBUILD $SERVICES_TO_RESTART; do
    case $service in
        ansible-mcp)
            wait_for_health "MCP Server" 3000 "/health" 60
            ;;
        ai-generator)
            wait_for_health "AI Generator" 8000 "/health" 60
            ;;
        web-ui)
            wait_for_health "Web UI" 3001 "/api/health" 60
            ;;
        redis)
            wait_for_health "Redis" 6379 "" 30
            ;;
        postgres)
            wait_for_health "PostgreSQL" 5432 "" 30
            ;;
        vault)
            wait_for_health "Vault" 8200 "/v1/sys/health" 30
            ;;
    esac
done

# ===== Verify Update =====
echo ""
log_info "Verifying update..."
check_all_services

# ===== Print Summary =====
print_banner "Update Complete!"

echo "Updated services:"
if [ -n "$SERVICES_TO_REBUILD" ]; then
    echo "  Rebuilt:$SERVICES_TO_REBUILD"
fi
if [ -n "$SERVICES_TO_RESTART" ]; then
    echo "  Restarted:$SERVICES_TO_RESTART"
fi

echo ""
echo "Services:"
docker_compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || docker_compose ps

echo ""
log_success "Update completed successfully!"
