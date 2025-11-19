#!/bin/bash
# ============================================
# Ansible MCP Server - Management CLI
# ============================================
# Unified interface for all management tasks
# Run with: ./manage.sh <command> [options]
# ============================================

# Source common functions
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/common.sh"

# Show usage
show_usage() {
    echo "Ansible MCP Server Management CLI"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  install [type]     Install the server (minimal|standard|full)"
    echo "  update [options]   Update existing deployment"
    echo "  start [services]   Start services"
    echo "  stop [services]    Stop services"
    echo "  restart [services] Restart services"
    echo "  status             Show service status"
    echo "  logs [service]     View service logs"
    echo "  health             Check all service health"
    echo "  validate           Validate configuration"
    echo "  backup [dir]       Create backup"
    echo "  restore <dir>      Restore from backup"
    echo "  shell <service>    Open shell in container"
    echo "  clean              Remove all containers and volumes"
    echo ""
    echo "Options:"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 install standard"
    echo "  $0 update --rebuild"
    echo "  $0 logs ansible-mcp -f"
    echo "  $0 restart web-ui"
    echo "  $0 backup ./my-backup"
}

# ===== Command Handlers =====

cmd_install() {
    local type="${1:-standard}"

    # Map type names to numbers
    case $type in
        minimal|1) type=1 ;;
        standard|2) type=2 ;;
        full|3) type=3 ;;
        *)
            log_error "Invalid installation type: $type"
            echo "Valid types: minimal, standard, full (or 1, 2, 3)"
            exit 1
            ;;
    esac

    # Run install script with pre-selected type
    echo "$type" | "$SCRIPT_DIR/install.sh"
}

cmd_update() {
    "$SCRIPT_DIR/update.sh" "$@"
}

cmd_start() {
    if [ $# -eq 0 ]; then
        log_info "Starting all services..."
        docker_compose up -d
    else
        log_info "Starting services: $*"
        docker_compose up -d "$@"
    fi

    echo ""
    log_info "Waiting for services..."
    sleep 5
    check_all_services
}

cmd_stop() {
    if [ $# -eq 0 ]; then
        log_info "Stopping all services..."
        docker_compose down
    else
        log_info "Stopping services: $*"
        docker_compose stop "$@"
    fi

    log_success "Services stopped"
}

cmd_restart() {
    if [ $# -eq 0 ]; then
        log_info "Restarting all services..."
        docker_compose restart
    else
        log_info "Restarting services: $*"
        docker_compose restart "$@"
    fi

    echo ""
    log_info "Waiting for services..."
    sleep 5
    check_all_services
}

cmd_status() {
    print_banner "Service Status"

    echo "Running containers:"
    docker_compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker_compose ps

    echo ""
    check_all_services

    echo ""
    echo "Resource usage:"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" $(docker_compose ps -q) 2>/dev/null || true
}

cmd_logs() {
    local service=""
    local follow=false
    local tail=100

    while [[ $# -gt 0 ]]; do
        case $1 in
            -f|--follow)
                follow=true
                shift
                ;;
            -n|--tail)
                tail=$2
                shift 2
                ;;
            *)
                service=$1
                shift
                ;;
        esac
    done

    local args="--tail=$tail"
    if [ "$follow" = true ]; then
        args="$args -f"
    fi

    if [ -n "$service" ]; then
        docker_compose logs $args "$service"
    else
        docker_compose logs $args
    fi
}

cmd_health() {
    print_banner "Health Check"
    check_all_services
    echo ""

    # Additional health details
    log_info "Docker resources:"
    docker system df --format "table {{.Type}}\t{{.Size}}\t{{.Reclaimable}}"
}

cmd_validate() {
    print_banner "Configuration Validation"

    # Check files
    log_info "Checking required files..."

    local required_files=(
        "$COMPOSE_FILE:docker-compose.yml"
        "$SRC_DIR/Dockerfile.mcp:Dockerfile.mcp"
        "$SRC_DIR/Dockerfile.python:Dockerfile.python"
        "$SRC_DIR/web-ui/Dockerfile:web-ui/Dockerfile"
    )

    local all_ok=true
    for item in "${required_files[@]}"; do
        local file="${item%%:*}"
        local name="${item##*:}"
        if [ -f "$file" ]; then
            log_success "$name"
        else
            log_error "$name - not found"
            all_ok=false
        fi
    done

    echo ""

    # Check env
    validate_env

    echo ""

    # Check Docker
    log_info "Checking Docker..."
    if check_docker; then
        log_success "Docker daemon accessible"
        log_success "Docker version: $(docker --version | cut -d' ' -f3 | cut -d',' -f1)"
    fi

    if check_docker_compose; then
        log_success "Docker Compose version: $(docker compose version --short)"
    fi

    echo ""

    # Validate compose file
    log_info "Validating docker-compose.yml..."
    if docker_compose config --quiet 2>/dev/null; then
        log_success "docker-compose.yml is valid"
    else
        log_error "docker-compose.yml has errors"
        docker_compose config 2>&1 | head -20
    fi
}

cmd_backup() {
    local backup_dir="${1:-}"
    print_banner "Backup"

    if [ -n "$backup_dir" ]; then
        create_backup "$backup_dir"
    else
        create_backup
    fi
}

cmd_restore() {
    local backup_dir="$1"

    if [ -z "$backup_dir" ]; then
        log_error "Backup directory required"
        echo "Usage: $0 restore <backup-dir>"
        exit 1
    fi

    if [ ! -d "$backup_dir" ]; then
        log_error "Backup directory not found: $backup_dir"
        exit 1
    fi

    print_banner "Restore"

    log_warn "This will overwrite current data!"
    read -p "Continue? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Restore cancelled"
        exit 0
    fi

    # Restore .env
    if [ -f "$backup_dir/.env.backup" ]; then
        log_step "Restoring .env..."
        cp "$backup_dir/.env.backup" "$ENV_FILE"
        log_success "Restored .env"
    fi

    # Stop services for restore
    log_step "Stopping services for restore..."
    docker_compose down

    # Restore PostgreSQL
    if [ -f "$backup_dir/postgres.sql" ]; then
        log_step "Restoring PostgreSQL database..."
        docker_compose up -d postgres
        sleep 10
        docker_compose exec -T postgres psql \
            -U "${POSTGRES_USER:-ansible_mcp}" \
            "${POSTGRES_DB:-awx}" < "$backup_dir/postgres.sql"
        log_success "Restored PostgreSQL"
    fi

    # Restore Redis
    if [ -f "$backup_dir/redis.rdb" ]; then
        log_step "Restoring Redis data..."
        docker_compose up -d redis
        docker cp "$backup_dir/redis.rdb" ansible-redis:/data/dump.rdb
        docker_compose restart redis
        log_success "Restored Redis"
    fi

    # Start all services
    log_step "Starting services..."
    docker_compose up -d

    echo ""
    log_info "Waiting for services..."
    sleep 10
    check_all_services

    log_success "Restore complete!"
}

cmd_shell() {
    local service="$1"

    if [ -z "$service" ]; then
        log_error "Service name required"
        echo "Usage: $0 shell <service>"
        echo "Available services: ansible-mcp, ai-generator, web-ui, redis, postgres, vault"
        exit 1
    fi

    if ! is_service_running "$service"; then
        log_error "Service '$service' is not running"
        exit 1
    fi

    log_info "Opening shell in $service..."

    case $service in
        postgres)
            docker_compose exec "$service" psql -U "${POSTGRES_USER:-ansible_mcp}" "${POSTGRES_DB:-awx}"
            ;;
        redis)
            docker_compose exec "$service" redis-cli
            ;;
        *)
            docker_compose exec "$service" sh
            ;;
    esac
}

cmd_clean() {
    print_banner "Clean"

    log_warn "This will remove ALL containers, volumes, and images!"
    log_warn "All data will be lost!"
    echo ""
    read -p "Are you sure? Type 'yes' to confirm: " confirm

    if [ "$confirm" != "yes" ]; then
        log_info "Clean cancelled"
        exit 0
    fi

    log_step "Stopping and removing containers..."
    docker_compose down -v --remove-orphans

    log_step "Removing build cache..."
    rm -rf "$PROJECT_DIR/.build-cache"

    log_step "Removing images..."
    docker_compose down --rmi local 2>/dev/null || true

    log_success "Clean complete!"
    echo ""
    echo "Run './manage.sh install' to reinstall"
}

# ===== Main =====

# Check for help
if [ $# -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_usage
    exit 0
fi

# Get command
COMMAND=$1
shift

# Execute command
case $COMMAND in
    install)
        cmd_install "$@"
        ;;
    update)
        cmd_update "$@"
        ;;
    start)
        cmd_start "$@"
        ;;
    stop)
        cmd_stop "$@"
        ;;
    restart)
        cmd_restart "$@"
        ;;
    status)
        cmd_status "$@"
        ;;
    logs)
        cmd_logs "$@"
        ;;
    health)
        cmd_health "$@"
        ;;
    validate)
        cmd_validate "$@"
        ;;
    backup)
        cmd_backup "$@"
        ;;
    restore)
        cmd_restore "$@"
        ;;
    shell)
        cmd_shell "$@"
        ;;
    clean)
        cmd_clean "$@"
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        echo ""
        show_usage
        exit 1
        ;;
esac
