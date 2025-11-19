# Installation Guide

> Complete step-by-step installation of Ansible MCP Server

---

## Objectives

After completing this guide, you will have:
- All prerequisites installed and configured
- Ansible MCP Server running with all services
- Basic validation of the installation

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [System Requirements](#system-requirements)
3. [Installation Methods](#installation-methods)
4. [Docker Installation (Recommended)](#docker-installation-recommended)
5. [Manual Installation](#manual-installation)
6. [Post-Installation Verification](#post-installation-verification)
7. [Troubleshooting Installation Issues](#troubleshooting-installation-issues)

---

## Prerequisites

### Required Software

| Software | Minimum Version | Purpose | Check Command |
|----------|-----------------|---------|---------------|
| Docker | 20.10+ | Container runtime | `docker --version` |
| Docker Compose | 2.0+ | Service orchestration | `docker compose version` |
| Git | 2.30+ | Repository cloning | `git --version` |

### Optional (for local development)

| Software | Minimum Version | Purpose | Check Command |
|----------|-----------------|---------|---------------|
| Node.js | 20.0+ | TypeScript server | `node --version` |
| Python | 3.10+ | AI generator | `python3 --version` |
| Ansible | 2.15+ | Playbook execution | `ansible --version` |

---

## System Requirements

### Hardware Requirements

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| CPU | 2 cores | 4+ cores | More cores = faster playbook generation |
| RAM | 4 GB | 8+ GB | GitLab alone needs 4GB |
| Storage | 20 GB | 50+ GB | For containers, logs, playbooks |
| Network | 1 Mbps | 10+ Mbps | For pulling images and AI API calls |

### Operating System

**Supported:**
- Ubuntu 20.04+ (recommended)
- Debian 11+
- CentOS 8+ / Rocky Linux 8+
- macOS 12+ (with Docker Desktop)
- Windows 10+ (with WSL2)

### Network Ports

Ensure these ports are available:

| Port | Service | Description |
|------|---------|-------------|
| 3000 | MCP Server | Main API endpoint |
| 3001 | Web UI | Management interface |
| 3002 | Grafana | Monitoring dashboards |
| 5432 | PostgreSQL | Database |
| 6379 | Redis | Cache/queue |
| 8000 | AI Generator | Python AI service |
| 8052 | AWX | Ansible Web UI |
| 8080 | GitLab | Version control |
| 8200 | Vault | Secrets management |
| 9090 | Prometheus | Metrics |

---

## Installation Methods

Choose your installation method:

| Method | Best For | Complexity | Time |
|--------|----------|------------|------|
| Docker (recommended) | Production, quick start | Easy | 10-15 min |
| Manual | Development, customization | Medium | 30-45 min |
| Kubernetes | Large scale deployments | Advanced | 1+ hour |

---

## Docker Installation (Recommended)

### Step 1: Install Docker

**Ubuntu/Debian:**

```bash
# Update package index
sudo apt-get update

# Install prerequisites
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add current user to docker group (logout/login required)
sudo usermod -aG docker $USER
```

**Expected output:**
```text
docker-ce is already the newest version...
```

**macOS:**
```bash
# Install Docker Desktop from https://www.docker.com/products/docker-desktop
# Or use Homebrew:
brew install --cask docker
```

**Windows (WSL2):**
1. Install WSL2: `wsl --install`
2. Install Docker Desktop from https://www.docker.com/products/docker-desktop
3. Enable WSL2 integration in Docker Desktop settings

### Step 2: Verify Docker Installation

```bash
# Check Docker version
docker --version

# Expected output:
# Docker version 24.0.7, build afdd53b

# Check Docker Compose
docker compose version

# Expected output:
# Docker Compose version v2.21.0

# Test Docker works
docker run hello-world

# Expected output:
# Hello from Docker!
# This message shows that your installation appears to be working correctly.
```

**What if this fails?**
- If permission denied: Run `sudo usermod -aG docker $USER` and log out/in
- If daemon not running: `sudo systemctl start docker`
- If WSL2 issues: Enable "Use the WSL 2 based engine" in Docker Desktop

### Step 3: Clone the Repository

```bash
# Clone the repository
git clone https://github.com/w7-mgfcode/Mannos-ANSIBLE_MCP-solution.git

# Navigate to directory
cd Mannos-ANSIBLE_MCP-solution

# Verify files
ls -la
```

**Expected output:**
```text
total 120
drwxr-xr-x 12 user user  4096 Nov 18 12:00 .
drwxr-xr-x  5 user user  4096 Nov 18 12:00 ..
-rw-r--r--  1 user user  8192 Nov 18 12:00 docker-compose.yml
-rw-r--r--  1 user user  1024 Nov 18 12:00 Dockerfile.mcp
drwxr-xr-x  3 user user  4096 Nov 18 12:00 src
...
```

### Step 4: Run Installation Script

The management CLI automates all configuration:

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Run installation (choose type: minimal, standard, or full)
./scripts/manage.sh install standard
```

This automatically:
- Creates required directories (playbooks, inventory, logs, templates)
- Generates secure credentials (JWT_SECRET, POSTGRES_PASSWORD, etc.)
- Creates default inventory file
- Pulls and builds Docker images
- Starts all services
- Waits for health checks

**Installation types:**

| Type | Services | RAM | Command |
|------|----------|-----|---------|
| `minimal` | MCP + AI + Redis + Vault + Postgres | ~1GB | `./scripts/manage.sh install minimal` |
| `standard` | + Web UI + Prometheus + Grafana | ~2GB | `./scripts/manage.sh install standard` |
| `full` | + GitLab | ~8GB | `./scripts/manage.sh install full` |

### Step 5: Configure AI Provider

```bash
# Edit .env to add your AI API key
nano .env

# Find and set one of:
# OPENAI_API_KEY=sk-your-openai-key
# ANTHROPIC_API_KEY=your-anthropic-key
# GEMINI_API_KEY=your-gemini-key

# Restart to apply
./scripts/manage.sh restart ansible-mcp
```

**Warning:**
- NEVER use default passwords in production
- NEVER commit .env files to version control
- Set proper API key for your chosen AI provider

### Step 6: Verify Installation

```bash
# Check all services are healthy
./scripts/manage.sh health

# View service status
./scripts/manage.sh status

# View logs if needed
./scripts/manage.sh logs ansible-mcp -f
```

**Expected output during startup:**
```text
Creating ansible-redis ... done
Creating ansible-vault ... done
Creating ansible-postgres ... done
Creating ansible-mcp-server ... done
Creating ansible-prometheus ... done
Creating ansible-grafana ... done
```

**What if this fails?**
- Port already in use: Check with `netstat -tlnp | grep PORT`
- Memory issues: Reduce services (remove gitlab, awx)
- Network issues: Check Docker network with `docker network ls`

### Step 7: Verify Services Are Running

```bash
# Check all services
docker compose ps

# Expected output - all should show "Up" or "healthy"
```

**Expected output:**
```text
NAME                    STATUS              PORTS
ansible-mcp-server      Up (healthy)        0.0.0.0:3000->3000/tcp
ansible-redis           Up                  0.0.0.0:6379->6379/tcp
ansible-vault           Up                  0.0.0.0:8200->8200/tcp
ansible-postgres        Up                  0.0.0.0:5432->5432/tcp
ansible-prometheus      Up                  0.0.0.0:9090->9090/tcp
ansible-grafana         Up                  0.0.0.0:3002->3000/tcp
```

---

## Manual Installation

For development or when you need more control.

### Step 1: Install Node.js Dependencies

```bash
# Install Node.js 20 (using nvm recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Verify
node --version  # Should show v20.x.x

# Install dependencies
npm install

# Build TypeScript
npm run build

# Verify build
ls dist/
```

**Expected output:**
```text
server.js  prompt_templates.js  providers/
```

### Step 2: Install Python Dependencies

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Verify
pip list | grep ansible
```

**Expected output:**
```text
ansible         2.15.x
ansible-lint    6.17.x
```

### Step 3: Install Ansible

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y ansible ansible-lint

# Or via pip
pip install ansible ansible-lint

# Verify
ansible --version
```

**Expected output:**
```
ansible [core 2.15.x]
  config file = /etc/ansible/ansible.cfg
  python version = 3.10.x
```

### Step 4: Start Services Manually

```bash
# Terminal 1: Start Redis
docker run -d -p 6379:6379 --name redis redis:7-alpine

# Terminal 2: Start MCP Server
export REDIS_HOST=localhost
export LOG_LEVEL=debug
node dist/server.js

# Terminal 3: Start AI Generator
cd src && uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

---

## Post-Installation Verification

### Test 1: Health Check

```bash
# Check MCP server health
curl -s http://localhost:3000/health | jq

# Expected output:
{
  "status": "healthy",
  "checks": {
    "redis": { "status": "healthy", "latency": 2 },
    "vault": { "status": "healthy", "latency": 15 },
    "aiProvider": { "status": "healthy" }
  },
  "timestamp": "2025-11-18T12:00:00.000Z"
}
```

**What if this fails?**
- If connection refused: Service not started
- If status unhealthy: Check individual service logs

### Test 2: Generate Test Playbook

```bash
# Generate a simple playbook
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_playbook",
    "arguments": {
      "prompt": "Update all system packages"
    }
  }' | jq

# Expected: JSON with playbook_path and playbook_content
```

### Test 3: Access Web Interfaces

Open in browser:
- **Web UI**: http://localhost:3001
- **Grafana**: http://localhost:3002 (admin / your-grafana-password)
- **Prometheus**: http://localhost:9090
- **Vault**: http://localhost:8200 (token from .env)

### Test 4: Check Metrics

```bash
# Get Prometheus metrics
curl -s http://localhost:9090/metrics | grep ansible_mcp

# Expected output - various metric lines
```

---

## Troubleshooting Installation Issues

### Issue: Docker Compose fails to start

**Symptoms:** Services fail to start, port conflicts

**Solution:**
```bash
# Check what's using ports
sudo netstat -tlnp | grep -E "(3000|6379|8200)"

# Kill conflicting processes
sudo kill -9 <PID>

# Or change ports in docker-compose.yml
```

### Issue: Out of memory

**Symptoms:** Containers killed, OOM errors

**Solution:**
```bash
# Check memory
free -h

# Start with fewer services
docker compose up -d ansible-mcp redis vault postgres

# Skip heavy services (gitlab needs 4GB+)
docker compose up -d --scale gitlab=0 --scale awx-web=0 --scale awx-task=0
```

### Issue: Cannot connect to Docker daemon

**Symptoms:** Permission denied

**Solution:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in, then verify
groups | grep docker
```

### Issue: AI provider not working

**Symptoms:** Playbook generation falls back to templates

**Solution:**
```bash
# Check AI configuration
docker compose logs ansible-mcp | grep -i "AI Provider"

# Verify API key
echo $OPENAI_API_KEY | head -c 10

# Test API key directly
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

---

## Next Steps

After successful installation:

1. **Configure**: See [configuration.md](configuration.md) for all options
2. **Quick Start**: See [quickstart.md](quickstart.md) for first playbook
3. **Usage**: See [usage.md](usage.md) for common workflows

---

## Uninstallation

```bash
# Stop all services
docker compose down

# Remove volumes (WARNING: deletes all data!)
docker compose down -v

# Remove images
docker compose down --rmi all

# Clean up directories
rm -rf playbooks/* logs/* inventory/*
```

---

**Installation complete!** Your Ansible MCP Server should now be running.
