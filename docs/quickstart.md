# Quick Start Guide

> Get from zero to working Ansible MCP Server in 5 minutes

---

## Objectives

- Start the server with minimal configuration
- Generate your first playbook
- Execute it against localhost

---

## Prerequisites Checklist

```bash
# Verify these are installed:
docker --version      # Need 20.10+
docker compose version # Need 2.0+
git --version         # Need 2.30+
```

---

## Quick Installation (5 Steps)

### Step 1: Clone & Enter Directory

```bash
git clone https://github.com/w7-mgfcode/Mannos-ANSIBLE_MCP-solution.git
cd Mannos-ANSIBLE_MCP-solution
```

### Step 2: Create Minimal Environment

```bash
# Create .env with required settings
cat > .env << 'EOF'
JWT_SECRET=$(openssl rand -base64 32)
POSTGRES_PASSWORD=quickstart123
VAULT_ROOT_TOKEN=quickstart
GRAFANA_ADMIN_PASSWORD=admin
AI_PROVIDER=openai
OPENAI_API_KEY=your-key-here
EOF

# Generate JWT secret (cross-platform: works on macOS and Linux)
JWT_SECRET=$(openssl rand -base64 32)
sed "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" .env > .env.tmp && mv .env.tmp .env
```

**Note:** Replace `your-key-here` with your actual OpenAI API key. Skip AI_PROVIDER settings if you don't have one - the server will use templates instead.

### Step 3: Create Required Directories

```bash
mkdir -p playbooks inventory logs
echo "[local]
localhost ansible_connection=local" > inventory/hosts
```

### Step 4: Start Core Services Only

```bash
# Start minimum services (faster startup)
docker compose up -d ansible-mcp redis vault postgres

# Wait for startup (about 30 seconds)
sleep 30

# Check status
docker compose ps
```

**Expected:** All services show "Up" status

### Step 5: Verify It Works

```bash
# Generate a test playbook
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_playbook",
    "arguments": {
      "prompt": "Install nginx web server"
    }
  }' | jq '.playbook_path'
```

**Expected output:**
```
"/tmp/ansible-mcp/playbook_1700000000000.yml"
```

---

## Your First Playbook

### Generate a Real Playbook

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_playbook",
    "arguments": {
      "prompt": "Setup Docker with security best practices",
      "template": "docker_setup",
      "context": {
        "target_hosts": "all",
        "environment": "production"
      }
    }
  }' | jq
```

### Validate the Playbook

```bash
# Get the playbook path from previous response
PLAYBOOK_PATH="/tmp/ansible-mcp/playbook_1700000000000.yml"

curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"validate_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK_PATH\",
      \"strict\": true
    }
  }" | jq
```

### Execute in Check Mode (Dry Run)

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"run_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK_PATH\",
      \"inventory\": \"hosts\",
      \"check_mode\": true
    }
  }" | jq
```

---

## Available MCP Tools

| Tool | Description | Example Use |
|------|-------------|-------------|
| `generate_playbook` | Create playbook from text | "Deploy nginx with SSL" |
| `validate_playbook` | Check YAML and Ansible syntax | Before execution |
| `run_playbook` | Execute against inventory | Production deployment |
| `refine_playbook` | Improve based on feedback | Fix validation errors |
| `lint_playbook` | Check best practices | Quality assurance |
| `list_prompt_templates` | Show available templates | Find right template |
| `generate_with_template` | Use optimized prompts | Better AI output |

---

## Quick Template Reference

### Available Templates

```bash
# List all templates
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"tool": "list_prompt_templates", "arguments": {}}' | jq '.templates[].id'
```

**Built-in templates:**
- `kubernetes-deployment` - K8s apps with scaling
- `docker-setup` - Docker installation
- `security-hardening` - System security
- `database-setup` - PostgreSQL/MySQL
- `monitoring-stack` - Prometheus + Grafana

---

## Common Operations

### Generate Kubernetes Deployment

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_with_template",
    "arguments": {
      "prompt": "Deploy web app with 3 replicas and auto-scaling",
      "template_id": "kubernetes-deployment",
      "context": {
        "environment": "production"
      }
    }
  }'
```

### Generate Security Hardening

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_playbook",
    "arguments": {
      "prompt": "Harden Ubuntu server with SSH security, firewall, and fail2ban",
      "template": "system_hardening"
    }
  }'
```

### Refine a Playbook

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "refine_playbook",
    "arguments": {
      "playbook_path": "/tmp/ansible-mcp/playbook_xxx.yml",
      "feedback": "Add error handling and make it idempotent"
    }
  }'
```

---

## Access Web Interfaces

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana | http://localhost:3002 | admin / (from .env) |
| Prometheus | http://localhost:9090 | - |
| Vault | http://localhost:8200 | token from .env |

---

## What's Next?

1. **Full Setup**: Start all services with `docker compose up -d`
2. **Configure AI**: Add your API keys for better generation
3. **Read Docs**:
   - [configuration.md](configuration.md) - All options
   - [usage.md](usage.md) - Common workflows
   - [architecture.md](architecture.md) - How it works

---

## Troubleshooting Quick Fixes

### Server not responding?
```bash
docker compose logs ansible-mcp --tail=50
```

### Port already in use?
```bash
# Find process using port 3000
lsof -i :3000
# Kill it
kill -9 <PID>
```

### Restart everything
```bash
docker compose down
docker compose up -d
```

---

**You're ready!** Start generating playbooks with natural language.
