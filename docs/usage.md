# Usage Guide

> Common workflows and real-world scenarios

---

## Objectives

- Master common MCP tool workflows
- Learn best practices for playbook generation
- Understand real-world deployment scenarios

---

## Table of Contents

1. [MCP Tools Reference](#mcp-tools-reference)
2. [Common Workflows](#common-workflows)
3. [Real-World Scenarios](#real-world-scenarios)
4. [Best Practices](#best-practices)
5. [Integration Examples](#integration-examples)

---

## MCP Tools Reference

### Core Tools

| Tool | Purpose | Read-Only | Destructive |
|------|---------|-----------|-------------|
| `generate_playbook` | Create from prompt | No | No |
| `validate_playbook` | Check syntax | Yes | No |
| `run_playbook` | Execute playbook | No | Yes |
| `refine_playbook` | Improve playbook | No | No |
| `lint_playbook` | Best practices | Yes | No |

### Template Tools

| Tool | Purpose |
|------|---------|
| `list_prompt_templates` | Browse templates |
| `get_prompt_template` | Template details |
| `enrich_prompt` | Add few-shot examples |
| `generate_with_template` | Use optimized prompt |
| `update_template_version` | Modify template |
| `get_template_history` | Version history |

---

## Common Workflows

### Workflow 1: Basic Playbook Generation

**Goal:** Generate and validate a playbook

```bash
# Step 1: Generate playbook
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_playbook",
    "arguments": {
      "prompt": "Install and configure nginx as reverse proxy with SSL"
    }
  }' | tee /tmp/result.json | jq

# Step 2: Extract playbook path
PLAYBOOK=$(jq -r '.playbook_path' /tmp/result.json)

# Step 3: Validate
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"validate_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK\",
      \"strict\": true
    }
  }" | jq

# Step 4: Lint for best practices
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"lint_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK\"
    }
  }" | jq
```

**Expected result:** Valid playbook with any lint warnings

### Workflow 2: Template-Based Generation

**Goal:** Use optimized templates for better results

```bash
# Step 1: List available templates
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "list_prompt_templates",
    "arguments": {
      "category": "kubernetes"
    }
  }' | jq '.templates[].id'

# Step 2: Get template details
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "get_prompt_template",
    "arguments": {
      "template_id": "kubernetes-deployment"
    }
  }' | jq '.template.description'

# Step 3: Generate with template
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_with_template",
    "arguments": {
      "prompt": "Deploy Redis cluster with 3 replicas and persistence",
      "template_id": "kubernetes-deployment",
      "context": {
        "environment": "production",
        "target_hosts": "k8s_cluster"
      }
    }
  }' | jq
```

### Workflow 3: Iterative Refinement

**Goal:** Improve a playbook based on feedback

```bash
# Step 1: Generate initial playbook
RESULT=$(curl -s -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_playbook",
    "arguments": {
      "prompt": "Setup PostgreSQL with replication"
    }
  }')

PLAYBOOK=$(echo $RESULT | jq -r '.playbook_path')

# Step 2: Validate and get errors
VALIDATION=$(curl -s -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"validate_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK\",
      \"strict\": true
    }
  }")

# Step 3: Refine based on feedback
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"refine_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK\",
      \"feedback\": \"Add error handling, make idempotent, add backup before changes\",
      \"validation_errors\": []
    }
  }" | jq
```

### Workflow 4: Safe Execution (Dry Run)

**Goal:** Test playbook without making changes

```bash
# Step 1: Run in check mode (dry run)
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"run_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK\",
      \"inventory\": \"hosts\",
      \"check_mode\": true
    }
  }" | jq

# Step 2: Review output
# Look for:
# - Tasks that would change
# - Potential failures
# - Missing variables

# Step 3: Run for real (if dry run looks good)
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"run_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK\",
      \"inventory\": \"hosts\",
      \"check_mode\": false,
      \"tags\": [\"deploy\"]
    }
  }" | jq
```

---

## Real-World Scenarios

### Scenario 1: Kubernetes Application Deployment

**Context:** Deploy a microservices application to Kubernetes

```bash
# Generate deployment playbook
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_with_template",
    "arguments": {
      "prompt": "Deploy microservices app with web frontend, API backend, and Redis cache. Configure HPA for auto-scaling, health checks, and resource limits. Use rolling updates.",
      "template_id": "kubernetes-deployment",
      "context": {
        "environment": "production",
        "target_hosts": "localhost"
      },
      "additional_context": {
        "namespace": "my-app",
        "replicas": 3,
        "image_registry": "my-registry.io"
      }
    }
  }' | jq
```

**What gets generated:**
- Namespace creation
- Deployment with replicas
- Service definitions
- HPA configuration
- ConfigMaps/Secrets
- Ingress rules

### Scenario 2: Security Hardening

**Context:** Secure a fleet of Ubuntu servers

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_playbook",
    "arguments": {
      "prompt": "Harden Ubuntu 22.04 servers: disable root SSH, configure fail2ban, setup UFW firewall allowing only SSH/HTTP/HTTPS, enable automatic security updates, configure auditd, set secure sysctl parameters",
      "template": "system_hardening",
      "context": {
        "target_hosts": "production_servers",
        "environment": "production",
        "tags": ["security", "hardening", "compliance"]
      }
    }
  }' | jq
```

**What gets generated:**
- SSH configuration changes
- Firewall rules
- Fail2ban configuration
- Automatic updates setup
- Audit logging
- Kernel parameters

### Scenario 3: Database Setup with Replication

**Context:** Deploy PostgreSQL with streaming replication

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_with_template",
    "arguments": {
      "prompt": "Setup PostgreSQL 15 primary-replica cluster with streaming replication, automatic failover using Patroni, connection pooling with PgBouncer, and automated backups to S3",
      "template_id": "database-setup",
      "context": {
        "target_hosts": "database_servers",
        "environment": "production"
      }
    }
  }' | jq
```

### Scenario 4: CI/CD Pipeline Infrastructure

**Context:** Setup Jenkins with agents

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_playbook",
    "arguments": {
      "prompt": "Install Jenkins master with 3 build agents, configure LDAP authentication, install common plugins (Git, Docker, Pipeline), setup backup job, configure monitoring with Prometheus plugin",
      "context": {
        "target_hosts": "cicd_servers",
        "environment": "production"
      }
    }
  }' | jq
```

### Scenario 5: Monitoring Stack

**Context:** Deploy complete observability stack

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "generate_with_template",
    "arguments": {
      "prompt": "Deploy monitoring stack: Prometheus with 30-day retention, Grafana with pre-configured dashboards, Alertmanager with Slack notifications, node_exporter on all hosts, blackbox_exporter for endpoint monitoring",
      "template_id": "monitoring-stack",
      "context": {
        "target_hosts": "monitoring_servers",
        "environment": "production"
      }
    }
  }' | jq
```

---

## Best Practices

### Prompt Writing

**Good prompts:**
```
"Deploy nginx as reverse proxy with SSL termination,
rate limiting (100 req/s), and health check endpoint"
```

**Bad prompts:**
```
"setup nginx"  # Too vague
```

**Tips:**
- Be specific about requirements
- Include versions when important
- Mention security requirements
- Specify environment (production/staging)

### Using Templates

**When to use templates:**
- Standard deployments (K8s, Docker, DB)
- Security hardening
- Monitoring setup

**When NOT to use templates:**
- Unique one-off tasks
- Simple single-task playbooks
- Exploratory work

### Validation Flow

**Always follow this pattern:**

```bash
Generate → Validate → Lint → Dry-Run → Execute
```

**Never skip:**
- Validation (catches YAML errors)
- Dry-run (catches runtime issues)

### Execution Safety

**Always:**
- Use `check_mode: true` first
- Limit with tags for incremental changes
- Have rollback plan

**Never:**
- Execute unvalidated playbooks
- Skip dry-run for production
- Run without proper inventory

---

## Integration Examples

### With Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ansible": {
      "command": "node",
      "args": ["/path/to/ansible-mcp-server/dist/server.js"],
      "env": {
        "AI_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "your-key"
      }
    }
  }
}
```

### With Python Script

```python
import subprocess
import json

def generate_playbook(prompt):
    request = {
        "tool": "generate_playbook",
        "arguments": {
            "prompt": prompt,
            "context": {"environment": "production"}
        }
    }

    result = subprocess.run(
        ["curl", "-s", "-X", "POST",
         "http://localhost:3000/execute",
         "-H", "Content-Type: application/json",
         "-d", json.dumps(request)],
        capture_output=True, text=True
    )

    return json.loads(result.stdout)

# Usage
result = generate_playbook("Install Docker on Ubuntu")
print(f"Playbook: {result['playbook_path']}")
```

### With Shell Script

```bash
#!/bin/bash
# generate-and-run.sh

PROMPT="$1"
INVENTORY="${2:-hosts}"

# Generate
RESULT=$(curl -s -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"generate_playbook\",
    \"arguments\": {
      \"prompt\": \"$PROMPT\"
    }
  }")

PLAYBOOK=$(echo $RESULT | jq -r '.playbook_path')

if [ "$PLAYBOOK" == "null" ]; then
  echo "Generation failed"
  exit 1
fi

# Validate
VALID=$(curl -s -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"validate_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK\"
    }
  }" | jq -r '.valid')

if [ "$VALID" != "true" ]; then
  echo "Validation failed"
  exit 1
fi

# Dry run
echo "Running dry-run..."
curl -s -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"run_playbook\",
    \"arguments\": {
      \"playbook_path\": \"$PLAYBOOK\",
      \"inventory\": \"$INVENTORY\",
      \"check_mode\": true
    }
  }" | jq

read -p "Execute for real? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  curl -s -X POST http://localhost:3000/execute \
    -H "Content-Type: application/json" \
    -d "{
      \"tool\": \"run_playbook\",
      \"arguments\": {
        \"playbook_path\": \"$PLAYBOOK\",
        \"inventory\": \"$INVENTORY\",
        \"check_mode\": false
      }
    }" | jq
fi
```

### With CI/CD Pipeline

```yaml
# .gitlab-ci.yml
generate-playbook:
  stage: generate
  script:
    - |
      curl -X POST http://ansible-mcp:3000/execute \
        -H "Content-Type: application/json" \
        -d "{
          \"tool\": \"generate_playbook\",
          \"arguments\": {
            \"prompt\": \"$PLAYBOOK_PROMPT\"
          }
        }" > result.json
    - cat result.json | jq -r '.playbook_content' > playbook.yml
  artifacts:
    paths:
      - playbook.yml

validate-playbook:
  stage: test
  script:
    - ansible-playbook --syntax-check playbook.yml
    - ansible-lint playbook.yml

deploy:
  stage: deploy
  script:
    - ansible-playbook -i inventory playbook.yml
  when: manual
```

---

## Advanced Usage

### Custom Extra Variables

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "run_playbook",
    "arguments": {
      "playbook_path": "/tmp/ansible-mcp/playbook.yml",
      "inventory": "production",
      "extra_vars": {
        "app_version": "2.0.0",
        "rolling_update_batch_size": 2,
        "health_check_retries": 5,
        "feature_flags": {
          "new_ui": true,
          "beta_api": false
        }
      }
    }
  }'
```

### Tag-Based Execution

```bash
# Only run deployment tasks
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "run_playbook",
    "arguments": {
      "playbook_path": "/tmp/ansible-mcp/playbook.yml",
      "inventory": "production",
      "tags": ["deploy", "restart"]
    }
  }'
```

---

**You're ready!** See [troubleshooting.md](troubleshooting.md) for common issues.
