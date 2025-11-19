# Configuration Guide

> Complete reference for all configuration options

---

## Objectives

- Understand all available configuration options
- Configure the system for your environment
- Set up security, AI providers, and monitoring

---

## Table of Contents

1. [Environment Variables](#environment-variables)
2. [Security Configuration](#security-configuration)
3. [AI Provider Configuration](#ai-provider-configuration)
4. [Database Configuration](#database-configuration)
5. [Monitoring Configuration](#monitoring-configuration)
6. [Ansible Configuration](#ansible-configuration)
7. [Docker Compose Customization](#docker-compose-customization)

---

## Environment Variables

### Required Variables

These MUST be set for the system to function:

| Variable | Description | Example | How to Generate |
|----------|-------------|---------|-----------------|
| `JWT_SECRET` | Web UI authentication token | `abcd1234...` | `openssl rand -base64 32` |
| `POSTGRES_PASSWORD` | Database password | `strong-pass` | Use password manager |

### Security Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_API_KEY` | *(none)* | API key for MCP server authentication |
| `MCP_ENABLE_AUTH` | `false` | Enable API authentication |
| `JWT_SECRET` | *(required)* | Secret for JWT tokens |
| `VAULT_ROOT_TOKEN` | `changeme` | HashiCorp Vault token |

### AI Provider Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `openai` | AI provider: `openai`, `anthropic`, `gemini`, `ollama` |
| `AI_MODEL` | `gpt-4.1` | Model to use |
| `OPENAI_API_KEY` | *(none)* | OpenAI API key |
| `ANTHROPIC_API_KEY` | *(none)* | Anthropic API key |
| `GEMINI_API_KEY` | *(none)* | Google Gemini API key |
| `AI_BASE_URL` | *(none)* | Custom API endpoint (for Ollama) |

### Database Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `awx` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `changeme` | PostgreSQL password |
| `POSTGRES_DB` | `awx` | PostgreSQL database name |
| `WEB_DB_NAME` | `ansible_mcp` | Web UI database name |
| `REDIS_HOST` | `redis` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |

### Monitoring Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `METRICS_PORT` | `9090` | Prometheus metrics port |
| `GRAFANA_ADMIN_PASSWORD` | `changeme` | Grafana admin password |

---

## Security Configuration

### Enabling Authentication

```bash
# In .env file
MCP_API_KEY=your-secure-api-key-here
MCP_ENABLE_AUTH=true
```

When enabled, all requests must include:
```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-api-key-here" \
  -d '...'
```

### Rate Limiting

Default: 100 requests per minute per client

Configured in `src/server.ts`:
```typescript
const securityConfig: SecurityConfig = {
  rateLimitPerMinute: 100,  // Adjust as needed
  maxPlaybookSize: 1024 * 1024, // 1MB max
};
```

### Path Security

Playbooks can only be written to allowed paths:
- `/tmp/ansible-mcp`
- `/workspace/playbooks`

To add more allowed paths, modify `securityConfig.allowedPaths` in `src/server.ts`.

### Secrets Detection

The server automatically scans for:
- AWS credentials (`AKIA...`)
- Private keys
- GitHub/Slack tokens
- Passwords and secrets
- JWTs and bearer tokens

Detected secrets are reported but not blocked by default.

### Production Security Checklist

- [ ] Set strong, unique passwords for all services
- [ ] Generate secure JWT_SECRET
- [ ] Enable MCP authentication
- [ ] Configure HTTPS/TLS
- [ ] Set up network firewall rules
- [ ] Use external Vault in production mode
- [ ] Rotate credentials regularly
- [ ] Never commit .env files

---

## AI Provider Configuration

### OpenAI (Recommended)

```bash
AI_PROVIDER=openai
AI_MODEL=gpt-4.1
OPENAI_API_KEY=sk-your-api-key
```

**Available models:**
- `gpt-5` - Most capable
- `gpt-4.1` - Recommended for production
- `gpt-4.1-mini` - Fast & affordable
- `gpt-4o` - Multimodal
- `o4-mini`, `o3` - Reasoning models

> **Note:** Model list can be overridden via `OPENAI_AVAILABLE_MODELS` environment variable (comma-separated).

### Anthropic (Claude)

```bash
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-your-key
```

**Available models:**
- `claude-opus-4-1-20250805` - Most capable
- `claude-opus-4-20250514` - Flagship
- `claude-sonnet-4-20250514` - Balanced (recommended)
- `claude-3-7-sonnet-20250219` - Efficient
- `claude-3-5-haiku-20241022` - Fast & affordable

> **Note:** Model list can be overridden via `ANTHROPIC_AVAILABLE_MODELS` environment variable (comma-separated).

### Google Gemini

```bash
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=your-gemini-key
```

**Available models:**
- `gemini-3-pro` - Most intelligent
- `gemini-2.5-flash` - Recommended (fast & capable)
- `gemini-2.5-flash-lite` - Most cost-efficient

### Ollama (Local)

```bash
AI_PROVIDER=ollama
AI_MODEL=llama3.2
AI_BASE_URL=http://localhost:11434
```

**Setup Ollama:**
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull model
ollama pull llama3.2

# Start server
ollama serve
```

**Available models:**
- `llama3.2` - Best local model
- `codellama` - Code-focused
- `mistral` - Fast and capable

### Fallback Behavior

If no AI provider is configured or API fails:
- Server falls back to template-based generation
- Uses built-in playbook templates
- Still produces valid playbooks

---

## Database Configuration

### PostgreSQL

```yaml
# docker-compose.yml
postgres:
  environment:
    POSTGRES_USER: ${POSTGRES_USER:-awx}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
    POSTGRES_DB: ${POSTGRES_DB:-awx}
```

**Using external PostgreSQL:**
```bash
# In .env
DB_HOST=your-postgres-server.com
DB_PORT=5432
DB_USER=ansible_mcp
DB_PASSWORD=secure-password
DB_NAME=ansible_mcp
```

### Redis

```yaml
# docker-compose.yml
redis:
  command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD:-}
```

**Enable Redis authentication:**
```bash
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
```

---

## Monitoring Configuration

### Prometheus

Edit `monitoring/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'ansible-mcp'
    static_configs:
      - targets: ['ansible-mcp:3000']
    metrics_path: '/metrics'

  # Redis metrics via exporter
  # Note: Redis doesn't expose Prometheus metrics natively.
  # A redis-exporter service is required to translate Redis INFO.
  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
```

> **Note**: Redis requires an exporter service (`redis-exporter`) to expose metrics in Prometheus format. The exporter is included in the default docker-compose.yml and exposes metrics on port 9121.

### Grafana

**Data sources:** Pre-configured for Prometheus

**Adding dashboards:**
Place JSON files in `monitoring/grafana/dashboards/`

**Configure alerts:**
```yaml
# In Grafana UI or provisioning
- name: HighErrorRate
  condition: rate(ansible_mcp_validation_errors_total[5m]) > 10
  annotations:
    summary: High validation error rate
```

### Log Levels

```bash
# Set in .env
LOG_LEVEL=debug  # Very verbose
LOG_LEVEL=info   # Normal operation
LOG_LEVEL=warn   # Warnings and errors only
LOG_LEVEL=error  # Errors only
```

---

## Ansible Configuration

### ansible.cfg Options

Key settings in `ansible.cfg`:

```ini
[defaults]
# Performance
forks = 50                    # Parallel execution
pipelining = True             # Faster SSH
strategy = free               # Non-blocking execution

# Output
stdout_callback = yaml        # Readable output
display_skipped_hosts = False # Cleaner logs

# Security
host_key_checking = False     # For automation
become = True                 # Use sudo by default

# Paths
inventory = /workspace/inventory/hosts
log_path = /workspace/logs/ansible.log
```

### Inventory Configuration

**Static inventory:**
```ini
# inventory/hosts
[webservers]
web1.example.com ansible_user=admin ansible_port=22
web2.example.com ansible_user=admin

[databases]
db1.example.com ansible_user=dbadmin

[all:vars]
ansible_python_interpreter=/usr/bin/python3
```

**Dynamic inventory:**
```bash
# For AWS
pip install boto3
# Configure ~/.aws/credentials

# For GCP
pip install google-auth
# Configure gcloud CLI
```

### Vault Configuration (Ansible)

```bash
# Create vault password file
echo 'your-vault-password' > /workspace/.vault_pass
chmod 600 /workspace/.vault_pass

# Encrypt sensitive data
ansible-vault encrypt inventory/group_vars/production/vault.yml
```

---

## Docker Compose Customization

### Running Minimal Stack

```bash
# Core services only
docker compose up -d ansible-mcp redis vault postgres

# Add monitoring
docker compose up -d prometheus grafana

# Skip heavy services
docker compose up -d --scale gitlab=0 --scale awx-web=0 --scale awx-task=0
```

### Scaling Services

```yaml
# docker-compose.override.yml
services:
  ansible-mcp:
    deploy:
      replicas: 3

  redis:
    deploy:
      resources:
        limits:
          memory: 1G
```

### Custom Networks

```yaml
# Add to docker-compose.yml
networks:
  ansible-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.25.0.0/16
```

### Persistent Storage

```yaml
volumes:
  # Use named volumes for important data
  postgres-data:
    driver: local
  redis-data:
    driver: local

  # Or bind mounts for direct access
  # - ./data/postgres:/var/lib/postgresql/data
```

---

## Configuration Files Reference

| File | Purpose | Location |
|------|---------|----------|
| `.env` | Environment variables | Project root |
| `ansible.cfg` | Ansible settings | Project root |
| `docker-compose.yml` | Service definitions | Project root |
| `prometheus.yml` | Metrics config | `monitoring/` |
| `inventory/hosts` | Target hosts | `inventory/` |

---

## Example Configurations

### Development Configuration

```bash
# .env.development
JWT_SECRET=dev-secret-not-for-prod
POSTGRES_PASSWORD=devpass
LOG_LEVEL=debug
AI_PROVIDER=ollama
AI_MODEL=llama3.2
```

### Production Configuration

```bash
# .env.production
JWT_SECRET=<generated-32-char-secret>
POSTGRES_PASSWORD=<strong-generated-password>
VAULT_ROOT_TOKEN=<production-vault-token>
LOG_LEVEL=info
MCP_ENABLE_AUTH=true
MCP_API_KEY=<secure-api-key>
AI_PROVIDER=openai
AI_MODEL=gpt-4.1
OPENAI_API_KEY=sk-<your-key>
```

---

## Validation

After configuration changes:

```bash
# Restart services
docker compose down
docker compose up -d

# Verify health
curl http://localhost:9090/health | jq

# Check logs for errors
docker compose logs ansible-mcp --tail=100
```

---

**Configuration complete!** See [usage.md](usage.md) for how to use the configured system.
