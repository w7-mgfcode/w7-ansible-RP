# Troubleshooting Guide

> Common issues, error messages, and solutions

---

## Objectives

- Quickly identify and resolve common issues
- Understand error messages and their causes
- Know debugging steps and tools

---

## Table of Contents

1. [Diagnostic Tools](#diagnostic-tools)
2. [Startup Issues](#startup-issues)
3. [Connection Issues](#connection-issues)
4. [Generation Issues](#generation-issues)
5. [Execution Issues](#execution-issues)
6. [Security Issues](#security-issues)
7. [Performance Issues](#performance-issues)

---

## Diagnostic Tools

### Check Service Status

```bash
# All services
docker compose ps

# Expected: All services "Up" or "healthy"
```

### View Logs

```bash
# MCP server logs
docker compose logs ansible-mcp --tail=100

# All logs
docker compose logs -f

# Specific service
docker compose logs redis --tail=50
```

### Health Check

```bash
# Server health
curl -s http://localhost:9090/health | jq

# Expected response:
{
  "status": "healthy",
  "checks": {
    "redis": { "status": "healthy" },
    "vault": { "status": "healthy" },
    "aiProvider": { "status": "healthy" }
  }
}
```

### Check Metrics

```bash
# View all metrics
curl -s http://localhost:9090/metrics | grep ansible_mcp

# Check for errors
curl -s http://localhost:9090/metrics | grep -E "errors|failures"
```

---

## Startup Issues

### Issue: Service fails to start

**Symptoms:**
- `docker compose up` shows errors
- Service status is "Exit 1"

**Diagnosis:**
```bash
docker compose logs ansible-mcp --tail=100
```

**Common causes and solutions:**

#### Port already in use

**Error:** `bind: address already in use`

**Solution:**
```bash
# Find process using port
sudo lsof -i :3000
# or
sudo netstat -tlnp | grep 3000

# Kill the process
sudo kill -9 <PID>

# Or change port in docker-compose.yml
ports:
  - "3001:3000"  # Map to different host port
```

#### Missing environment variable

**Error:** `JWT_SECRET environment variable is required`

**Solution:**
```bash
# Generate and set JWT_SECRET
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env

# Verify
grep JWT_SECRET .env
```

#### Docker daemon not running

**Error:** `Cannot connect to the Docker daemon`

**Solution:**
```bash
# Start Docker
sudo systemctl start docker

# Enable on boot
sudo systemctl enable docker

# Verify
docker info
```

### Issue: Out of memory

**Symptoms:**
- Containers killed
- OOM errors in logs

**Solution:**
```bash
# Check memory
free -h

# Option 1: Add swap
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Option 2: Reduce services
docker compose up -d ansible-mcp redis vault postgres
# Skip gitlab (needs 4GB+) and awx
```

---

## Connection Issues

### Issue: Cannot connect to Redis

**Error:** `Redis connection failed, caching disabled`

**Diagnosis:**
```bash
# Check Redis is running
docker compose ps redis

# Test connection
docker compose exec redis redis-cli ping
# Expected: PONG
```

**Solutions:**

1. **Redis not started:**
```bash
docker compose up -d redis
```

2. **Wrong host/port:**
```bash
# Check environment
grep REDIS .env

# Should be:
REDIS_HOST=redis  # Docker network name
REDIS_PORT=6379
```

3. **Network issues:**
```bash
# Check network
docker network inspect mannos-ansible_mcp-solution_ansible-network

# Recreate network
docker compose down
docker compose up -d
```

### Issue: Cannot connect to Vault

**Error:** `Vault connection failed, secrets management disabled`

**Diagnosis:**
```bash
# Check Vault status
docker compose logs vault --tail=50

# Test connection
curl http://localhost:8200/v1/sys/health
```

**Solutions:**

1. **Vault not initialized:**
```bash
# In dev mode, should auto-initialize
docker compose up -d vault
```

2. **Wrong token:**
```bash
# Check token in .env
grep VAULT .env

# Token should match VAULT_DEV_ROOT_TOKEN_ID in docker-compose.yml
```

### Issue: AI Provider connection failed

**Error:** `AI Provider initialization failed, falling back to template-based generation`

**Diagnosis:**
```bash
docker compose logs ansible-mcp | grep -i "AI Provider"
```

**Solutions:**

1. **Missing API key:**
```bash
# Check key is set
grep API_KEY .env

# OpenAI key format: sk-...
# Anthropic key format: sk-ant-...
```

2. **Invalid API key:**
```bash
# Test OpenAI key directly
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  | jq '.error'
```

3. **Wrong provider configured:**
```bash
# Check provider matches key
grep AI_PROVIDER .env
# If AI_PROVIDER=openai, need OPENAI_API_KEY
```

---

## Generation Issues

### Issue: Playbook generation returns template fallback

**Symptoms:**
- Output contains `Using template-based generation`
- Playbook is basic, not contextual

**Cause:** AI provider not configured or API error

**Solution:**
```bash
# Set AI provider
AI_PROVIDER=openai
AI_MODEL=gpt-4
OPENAI_API_KEY=sk-your-key

# Restart
docker compose restart ansible-mcp
```

### Issue: YAML syntax error in generated playbook

**Error:** `yaml_valid: false`

**Diagnosis:**
```bash
# Get the playbook content
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{...}' | jq -r '.playbook_content' > /tmp/test.yml

# Validate locally
python -c "import yaml; yaml.safe_load(open('/tmp/test.yml'))"
```

**Solution:**
```bash
# Refine the playbook
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "refine_playbook",
    "arguments": {
      "playbook_path": "/tmp/ansible-mcp/playbook.yml",
      "feedback": "Fix YAML syntax errors"
    }
  }'
```

### Issue: Empty or minimal playbook

**Cause:** Prompt too vague

**Solution:** Use more specific prompts:
```bash
# Bad
"setup nginx"

# Good
"Install nginx on Ubuntu 22.04, configure as reverse proxy
for backend on port 8080, enable SSL with Let's Encrypt,
set up log rotation"
```

---

## Execution Issues

### Issue: Playbook execution fails

**Error:** `Playbook execution failed`

**Diagnosis:**
```bash
# Check the full error in response
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "run_playbook",
    "arguments": {
      "playbook_path": "/tmp/ansible-mcp/playbook.yml",
      "inventory": "hosts"
    }
  }' | jq '.stderr'
```

**Common causes:**

#### Cannot find inventory

**Error:** `Unable to parse inventory`

**Solution:**
```bash
# Check inventory exists
ls /workspace/inventory/
# or locally
ls inventory/

# Verify inventory syntax
ansible-inventory -i inventory/hosts --list
```

#### SSH connection failed

**Error:** `Failed to connect to host`

**Solutions:**
1. Check SSH access:
```bash
ssh user@host
```

2. Check inventory host definition:
```ini
[servers]
server1 ansible_host=192.168.1.10 ansible_user=admin ansible_ssh_private_key_file=~/.ssh/id_rsa
```

3. Disable host key checking (already in ansible.cfg):
```ini
host_key_checking = False
```

#### Permission denied

**Error:** `Permission denied` or `Missing sudo password`

**Solution:**
```bash
# Add become password to inventory
[all:vars]
ansible_become_password=your-sudo-password

# Or use passwordless sudo on target
echo "ansible ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/ansible
```

### Issue: Execution timeout

**Error:** `Command timed out after 600000ms`

**Solution:**
- Default timeout is 10 minutes
- For long playbooks, modify in server.ts or break into smaller plays

### Issue: Secrets detected, execution blocked

**Error:** `Playbook contains potential secrets`

**Solution:**
```bash
# Check what was detected
curl -X POST http://localhost:3000/execute \
  ... | jq '.secrets_detected'

# Fix: Use Ansible Vault or variables
# Instead of:
password: "hardcoded123"

# Use:
password: "{{ vault_database_password }}"
```

---

## Security Issues

### Issue: Rate limit exceeded

**Error:** `Rate limit exceeded. Please try again later.`

**Cause:** Too many requests in 1 minute (default: 100)

**Solution:**
- Wait 1 minute
- Or increase limit in `src/server.ts`:
```typescript
rateLimitPerMinute: 200,  // Increase limit
```

### Issue: Path not in allowed directories

**Error:** `Security error: Path not in allowed directories`

**Cause:** Trying to access file outside allowed paths

**Solution:**
- Use allowed paths: `/tmp/ansible-mcp` or `/workspace/playbooks`
- Or add path to `securityConfig.allowedPaths`

### Issue: Authentication failed

**Error:** 401 or `Authentication required`

**Solution:**
```bash
# Include API key in request
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{...}'
```

---

## Performance Issues

### Issue: Slow playbook generation

**Symptoms:** Generation takes > 30 seconds

**Diagnosis:**
```bash
# Check AI provider latency
time curl -s -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**Solutions:**

1. **Use faster model:**
```bash
AI_MODEL=gpt-3.5-turbo  # Instead of gpt-4
# or
AI_MODEL=claude-3-haiku-20240307  # Faster Claude
```

2. **Use local model (Ollama):**
```bash
AI_PROVIDER=ollama
AI_MODEL=llama3.2
AI_BASE_URL=http://localhost:11434
```

3. **Use templates for common tasks:**
```bash
"tool": "generate_with_template"
# Instead of pure AI generation
```

### Issue: High memory usage

**Diagnosis:**
```bash
docker stats
```

**Solutions:**

1. **Limit container memory:**
```yaml
# docker-compose.override.yml
services:
  ansible-mcp:
    deploy:
      resources:
        limits:
          memory: 1G
```

2. **Reduce running services:**
```bash
docker compose down gitlab awx-web awx-task
```

---

## Debugging Steps

### General Debugging Workflow

1. **Check service status:**
```bash
docker compose ps
```

2. **Check logs:**
```bash
docker compose logs ansible-mcp --tail=200
```

3. **Check health:**
```bash
curl http://localhost:9090/health
```

4. **Check metrics for errors:**
```bash
curl http://localhost:9090/metrics | grep error
```

5. **Enable debug logging:**
```bash
# In .env
LOG_LEVEL=debug

# Restart
docker compose restart ansible-mcp
```

6. **Test individual components:**
```bash
# Redis
docker compose exec redis redis-cli ping

# Vault
curl http://localhost:8200/v1/sys/health

# PostgreSQL
docker compose exec postgres pg_isready
```

### Getting Help

If you can't resolve an issue:

1. **Collect diagnostic info:**
```bash
docker compose ps > diagnostics.txt
docker compose logs --tail=500 >> diagnostics.txt
curl http://localhost:9090/health >> diagnostics.txt
```

2. **File an issue:**
https://github.com/w7-mgfcode/Mannos-ANSIBLE_MCP-solution/issues

Include:
- Error message
- Steps to reproduce
- Diagnostic output
- Environment (OS, Docker version)

---

**Issue resolved?** See [faq.md](faq.md) for common questions.
