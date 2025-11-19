#!/usr/bin/env python3
"""
AI-Powered Ansible Playbook Generator
Integrates with LLMs to generate context-aware Ansible playbooks
"""

import yaml
import re
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from enum import Enum
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PlaybookType(Enum):
    """Types of playbooks that can be generated"""

    KUBERNETES = "kubernetes"
    DOCKER = "docker"
    SYSTEM = "system"
    NETWORK = "network"
    DATABASE = "database"
    MONITORING = "monitoring"
    SECURITY = "security"
    CICD = "cicd"


@dataclass
class PlaybookContext:
    """Context for playbook generation"""

    prompt: str
    playbook_type: Optional[PlaybookType] = None
    target_hosts: str = "all"
    environment: str = "production"
    variables: Dict[str, Any] = None
    tags: List[str] = None
    requirements: List[str] = None

    def __post_init__(self):
        if self.variables is None:
            self.variables = {}
        if self.tags is None:
            self.tags = []
        if self.requirements is None:
            self.requirements = []


class PlaybookGenerator:
    """Main class for generating Ansible playbooks"""

    def __init__(self):
        self.templates = self._load_templates()
        self.patterns = self._compile_patterns()

    def _load_templates(self) -> Dict[PlaybookType, str]:
        """Load playbook templates"""
        return {
            PlaybookType.KUBERNETES: self._kubernetes_template(),
            PlaybookType.DOCKER: self._docker_template(),
            PlaybookType.SYSTEM: self._system_template(),
            PlaybookType.DATABASE: self._database_template(),
            PlaybookType.MONITORING: self._monitoring_template(),
            PlaybookType.SECURITY: self._security_template(),
        }

    def _compile_patterns(self) -> Dict[str, re.Pattern]:
        """Compile regex patterns for prompt analysis"""
        return {
            "kubernetes": re.compile(
                r"\b(k8s|kubernetes|kubectl|pod|deployment|service|ingress)\b", re.I
            ),
            "docker": re.compile(
                r"\b(docker|container|compose|dockerfile|registry)\b", re.I
            ),
            "database": re.compile(
                r"\b(mysql|postgres|mongodb|redis|database|db)\b", re.I
            ),
            "monitoring": re.compile(
                r"\b(prometheus|grafana|monitoring|metrics|alerts)\b", re.I
            ),
            "security": re.compile(
                r"\b(security|firewall|ssh|tls|certificate|vault)\b", re.I
            ),
            "network": re.compile(
                r"\b(network|routing|dns|load.?balanc|nginx|haproxy)\b", re.I
            ),
        }

    def analyze_prompt(self, prompt: str) -> PlaybookContext:
        """Analyze the prompt to extract context"""
        context = PlaybookContext(prompt=prompt)

        # Detect playbook type
        for pattern_name, pattern in self.patterns.items():
            if pattern.search(prompt):
                try:
                    context.playbook_type = PlaybookType(pattern_name)
                    break
                except ValueError:
                    # Pattern matched but not a valid PlaybookType enum value
                    # Continue to next pattern - this is expected for custom patterns
                    pass

        # Extract environment
        if "production" in prompt.lower():
            context.environment = "production"
        elif "staging" in prompt.lower():
            context.environment = "staging"
        elif "development" in prompt.lower() or "dev" in prompt.lower():
            context.environment = "development"

        # Extract requirements
        context.requirements = self._extract_requirements(prompt)

        # Generate appropriate tags
        context.tags = self._generate_tags(prompt)

        return context

    def _extract_requirements(self, prompt: str) -> List[str]:
        """Extract specific requirements from the prompt"""
        requirements = []

        # Common requirement patterns
        patterns = {
            "high_availability": r"\b(high.?availability|ha|redundant|failover)\b",
            "scalability": r"\b(scal[ae]bl|auto.?scal|elastic)\b",
            "security": r"\b(secur|encrypt|tls|ssl|firewall)\b",
            "monitoring": r"\b(monitor|metric|log|observ)\b",
            "backup": r"\b(backup|restore|disaster.?recovery)\b",
            "performance": r"\b(perform|optimiz|cache|fast)\b",
        }

        for req_name, pattern in patterns.items():
            if re.search(pattern, prompt, re.I):
                requirements.append(req_name)

        return requirements

    def _generate_tags(self, prompt: str) -> List[str]:
        """Generate appropriate tags based on the prompt"""
        tags = ["setup"]

        keyword_to_tags = {
            "install": ["install", "setup"],
            "configure": ["configure", "config"],
            "deploy": ["deploy", "rollout"],
            "update": ["update", "upgrade"],
            "backup": ["backup"],
            "restore": ["restore"],
            "monitor": ["monitoring"],
            "secure": ["security"],
        }

        for keyword, tag_list in keyword_to_tags.items():
            if keyword in prompt.lower():
                tags.extend(tag_list)

        return list(set(tags))  # Remove duplicates

    def generate(self, context: PlaybookContext) -> str:
        """Generate an Ansible playbook based on context"""
        logger.info(f"Generating playbook for type: {context.playbook_type}")

        if context.playbook_type and context.playbook_type in self.templates:
            # Use template as base
            playbook = self.templates[context.playbook_type]
        else:
            # Generate generic playbook
            playbook = self._generate_generic(context)

        # Enhance based on requirements
        playbook = self._enhance_with_requirements(playbook, context)

        # Add custom tasks based on prompt
        playbook = self._add_custom_tasks(playbook, context)

        return playbook

    def _generate_generic(self, context: PlaybookContext) -> str:
        """Generate a generic playbook structure"""
        playbook = {
            "name": f"Playbook for: {context.prompt[:50]}",
            "hosts": context.target_hosts,
            "become": True,
            "vars": {"environment": context.environment, **context.variables},
            "tasks": [
                {"name": "Gather system facts", "setup": {}, "tags": ["always"]},
                {
                    "name": "Ensure system packages are updated",
                    "package": {"name": "*", "state": "present"},
                    "tags": ["update"],
                },
            ],
        }

        return yaml.dump([playbook], default_flow_style=False, sort_keys=False)

    def _enhance_with_requirements(
        self, playbook: str, context: PlaybookContext
    ) -> str:
        """Enhance playbook based on requirements"""
        try:
            playbook_data = yaml.safe_load(playbook)
        except yaml.YAMLError as e:
            logger.error(f"Failed to parse playbook during enhancement: {e}")
            return playbook

        for req in context.requirements:
            if req == "high_availability":
                self._add_ha_tasks(playbook_data[0])
            elif req == "security":
                self._add_security_tasks(playbook_data[0])
            elif req == "monitoring":
                self._add_monitoring_tasks(playbook_data[0])
            elif req == "backup":
                self._add_backup_tasks(playbook_data[0])

        return yaml.dump(playbook_data, default_flow_style=False, sort_keys=False)

    def _add_custom_tasks(self, playbook: str, context: PlaybookContext) -> str:
        """Add custom tasks based on the prompt analysis"""
        try:
            playbook_data = yaml.safe_load(playbook)
        except yaml.YAMLError as e:
            logger.error(f"Failed to parse playbook during custom task addition: {e}")
            return playbook

        # Analyze prompt for specific actions
        if "install" in context.prompt.lower():
            self._add_installation_tasks(playbook_data[0], context)

        if "configure" in context.prompt.lower():
            self._add_configuration_tasks(playbook_data[0], context)

        if "deploy" in context.prompt.lower():
            self._add_deployment_tasks(playbook_data[0], context)

        return yaml.dump(playbook_data, default_flow_style=False, sort_keys=False)

    def _add_ha_tasks(self, playbook: Dict):
        """Add high availability related tasks"""
        ha_tasks = [
            {
                "name": "Configure keepalived for HA",
                "package": {"name": "keepalived", "state": "present"},
                "tags": ["ha", "keepalived"],
            },
            {
                "name": "Setup load balancer health checks",
                "uri": {"url": "http://localhost/health", "status_code": 200},
                "tags": ["ha", "healthcheck"],
            },
        ]
        playbook["tasks"].extend(ha_tasks)

    def _add_security_tasks(self, playbook: Dict):
        """Add security related tasks"""
        security_tasks = [
            {
                "name": "Configure firewall rules",
                "firewalld": {
                    "service": "https",
                    "permanent": True,
                    "state": "enabled",
                },
                "tags": ["security", "firewall"],
            },
            {
                "name": "Setup fail2ban",
                "package": {"name": "fail2ban", "state": "present"},
                "tags": ["security", "fail2ban"],
            },
            {
                "name": "Configure SSH hardening",
                "lineinfile": {
                    "path": "/etc/ssh/sshd_config",
                    "regexp": "^PermitRootLogin",
                    "line": "PermitRootLogin no",
                },
                "notify": "restart sshd",
                "tags": ["security", "ssh"],
            },
        ]
        playbook["tasks"].extend(security_tasks)

        # Add handlers if not present
        if "handlers" not in playbook:
            playbook["handlers"] = []

        # Check for duplicate handler before appending
        handler = {
            "name": "restart sshd",
            "service": {"name": "sshd", "state": "restarted"},
        }
        if not any(h.get("name") == "restart sshd" for h in playbook["handlers"]):
            playbook["handlers"].append(handler)

    def _add_monitoring_tasks(self, playbook: Dict):
        """Add monitoring related tasks"""
        node_exporter_url = (
            "https://github.com/prometheus/node_exporter/releases/download/"
            "v1.5.0/node_exporter-1.5.0.linux-amd64.tar.gz"
        )
        monitoring_tasks = [
            {
                "name": "Install node exporter",
                "unarchive": {
                    "src": node_exporter_url,
                    "dest": "/opt",
                    "remote_src": True,
                },
                "tags": ["monitoring", "prometheus"],
            },
            {
                "name": "Create systemd service for node exporter",
                "systemd": {
                    "name": "node_exporter",
                    "state": "started",
                    "enabled": True,
                },
                "tags": ["monitoring", "prometheus"],
            },
        ]
        playbook["tasks"].extend(monitoring_tasks)

    def _add_backup_tasks(self, playbook: Dict):
        """Add backup related tasks"""
        backup_tasks = [
            {
                "name": "Create backup directory",
                "file": {"path": "/backup", "state": "directory", "mode": "0755"},
                "tags": ["backup"],
            },
            {
                "name": "Setup automated backup cron job",
                "cron": {
                    "name": "Daily backup",
                    "hour": "2",
                    "minute": "0",
                    "job": "/usr/local/bin/backup.sh",
                },
                "tags": ["backup", "cron"],
            },
        ]
        playbook["tasks"].extend(backup_tasks)

    def _add_installation_tasks(self, playbook: Dict, context: PlaybookContext):
        """Add installation specific tasks"""
        # This would be enhanced based on what needs to be installed
        pass

    def _add_configuration_tasks(self, playbook: Dict, context: PlaybookContext):
        """Add configuration specific tasks"""
        # This would be enhanced based on what needs to be configured
        pass

    def _add_deployment_tasks(self, playbook: Dict, context: PlaybookContext):
        """Add deployment specific tasks"""
        # This would be enhanced based on what needs to be deployed
        pass

    # Template methods
    def _kubernetes_template(self) -> str:
        return """
- name: Kubernetes Deployment Playbook
  hosts: "{{ target_hosts | default('localhost') }}"
  gather_facts: yes
  vars:
    kube_namespace: "{{ namespace | default('default') }}"
    app_name: "{{ application_name }}"
    replicas: "{{ replica_count | default(3) }}"
    image: "{{ container_image }}"

  tasks:
    - name: Ensure kubectl is installed
      package:
        name: kubectl
        state: present
      tags:
        - setup
        - kubectl

    - name: Create namespace
      kubernetes.core.k8s:
        name: "{{ kube_namespace }}"
        api_version: v1
        kind: Namespace
        state: present
      tags:
        - namespace

    - name: Deploy application
      kubernetes.core.k8s:
        state: present
        definition:
          apiVersion: apps/v1
          kind: Deployment
          metadata:
            name: "{{ app_name }}"
            namespace: "{{ kube_namespace }}"
            labels:
              app: "{{ app_name }}"
              environment: "{{ environment }}"
          spec:
            replicas: "{{ replicas }}"
            selector:
              matchLabels:
                app: "{{ app_name }}"
            template:
              metadata:
                labels:
                  app: "{{ app_name }}"
              spec:
                containers:
                - name: "{{ app_name }}"
                  image: "{{ image }}"
                  ports:
                  - containerPort: 8080
                  resources:
                    requests:
                      memory: "256Mi"
                      cpu: "250m"
                    limits:
                      memory: "512Mi"
                      cpu: "500m"
      tags:
        - deploy
        - kubernetes

    - name: Create service
      kubernetes.core.k8s:
        state: present
        definition:
          apiVersion: v1
          kind: Service
          metadata:
            name: "{{ app_name }}-service"
            namespace: "{{ kube_namespace }}"
          spec:
            selector:
              app: "{{ app_name }}"
            ports:
            - protocol: TCP
              port: 80
              targetPort: 8080
            type: LoadBalancer
      tags:
        - service
        - kubernetes
"""

    def _docker_template(self) -> str:
        return """
- name: Docker Environment Setup
  hosts: "{{ target_hosts | default('all') }}"
  become: yes
  vars:
    docker_users: []
    docker_compose_version: "2.20.0"
    docker_repo_url: >-
      deb [arch=amd64] https://download.docker.com/linux/{{ ansible_distribution | lower }}
      {{ ansible_distribution_release }} stable

  tasks:
    - name: Install required packages
      package:
        name:
          - apt-transport-https
          - ca-certificates
          - curl
          - gnupg
          - lsb-release
        state: present
      tags:
        - setup
        - docker

    - name: Add Docker GPG key
      apt_key:
        url: https://download.docker.com/linux/{{ ansible_distribution | lower }}/gpg
        state: present
      tags:
        - setup
        - docker

    - name: Add Docker repository
      apt_repository:
        repo: "{{ docker_repo_url }}"
        state: present
      tags:
        - setup
        - docker

    - name: Install Docker
      package:
        name:
          - docker-ce
          - docker-ce-cli
          - containerd.io
        state: present
      tags:
        - setup
        - docker

    - name: Start and enable Docker
      systemd:
        name: docker
        state: started
        enabled: yes
      tags:
        - setup
        - docker

    - name: Install Docker Compose Plugin
      package:
        name: docker-compose-plugin
        state: present
      tags:
        - setup
        - docker-compose

    - name: Add users to docker group
      user:
        name: "{{ item }}"
        groups: docker
        append: yes
      loop: "{{ docker_users }}"
      when: docker_users | length > 0
      tags:
        - setup
        - docker
"""

    def _system_template(self) -> str:
        return """
- name: System Configuration Playbook
  hosts: "{{ target_hosts | default('all') }}"
  become: yes
  vars:
    system_timezone: "UTC"
    system_packages: []

  tasks:
    - name: Update package cache
      package:
        update_cache: yes
      tags:
        - update
        - system

    - name: Upgrade all packages
      package:
        name: '*'
        state: present
      tags:
        - update
        - system

    - name: Set timezone
      timezone:
        name: "{{ system_timezone }}"
      tags:
        - config
        - system

    - name: Install essential packages
      package:
        name:
          - vim
          - git
          - curl
          - wget
          - htop
          - net-tools
        state: present
      tags:
        - setup
        - system

    - name: Configure sysctl parameters
      sysctl:
        name: "{{ item.name }}"
        value: "{{ item.value }}"
        state: present
        reload: yes
      loop:
        - { name: 'net.ipv4.ip_forward', value: '1' }
        - { name: 'net.ipv6.conf.all.forwarding', value: '1' }
      tags:
        - config
        - system
"""

    def _database_template(self) -> str:
        return """
- name: Database Setup Playbook
  hosts: "{{ target_hosts | default('all') }}"
  become: yes
  vars:
    db_type: "{{ database_type | default('postgresql') }}"
    db_name: "{{ database_name | default('myapp') }}"
    db_user: "{{ database_user | default('appuser') }}"
    db_password: "{{ database_password }}"

  tasks:
    - name: Install PostgreSQL
      package:
        name:
          - postgresql
          - postgresql-contrib
          - python3-psycopg2
        state: present
      when: db_type == 'postgresql'
      tags:
        - setup
        - database

    - name: Start PostgreSQL service
      systemd:
        name: postgresql
        state: started
        enabled: yes
      when: db_type == 'postgresql'
      tags:
        - setup
        - database

    - name: Create database
      postgresql_db:
        name: "{{ db_name }}"
        state: present
      become_user: postgres
      when: db_type == 'postgresql'
      tags:
        - setup
        - database

    - name: Create database user
      postgresql_user:
        name: "{{ db_user }}"
        password: "{{ db_password }}"
        db: "{{ db_name }}"
        priv: ALL
        state: present
      become_user: postgres
      when: db_type == 'postgresql'
      tags:
        - setup
        - database
"""

    def _monitoring_template(self) -> str:
        return """
- name: Monitoring Stack Setup
  hosts: "{{ target_hosts | default('all') }}"
  become: yes
  vars:
    prometheus_version: "2.45.0"
    grafana_version: "10.0.0"
    prometheus_base: "https://github.com/prometheus/prometheus/releases/download"
    prometheus_file: "prometheus-{{ prometheus_version }}.linux-amd64.tar.gz"
    prometheus_url: "{{ prometheus_base }}/v{{ prometheus_version }}/{{ prometheus_file }}"

  tasks:
    - name: Create monitoring user
      user:
        name: prometheus
        system: yes
        shell: /bin/false
      tags:
        - setup
        - monitoring

    - name: Download and install Prometheus
      unarchive:
        src: "{{ prometheus_url }}"
        dest: /opt
        remote_src: yes
        owner: prometheus
        group: prometheus
      tags:
        - setup
        - prometheus

    - name: Create Prometheus configuration
      template:
        src: prometheus.yml.j2
        dest: /etc/prometheus/prometheus.yml
        owner: prometheus
        group: prometheus
      tags:
        - config
        - prometheus

    - name: Create systemd service for Prometheus
      systemd:
        name: prometheus
        state: started
        enabled: yes
        daemon_reload: yes
      tags:
        - setup
        - prometheus

    - name: Install Grafana
      package:
        name: grafana
        state: present
      tags:
        - setup
        - grafana

    - name: Start Grafana service
      systemd:
        name: grafana-server
        state: started
        enabled: yes
      tags:
        - setup
        - grafana
"""

    def _security_template(self) -> str:
        return """
- name: Security Hardening Playbook
  hosts: "{{ target_hosts | default('all') }}"
  become: yes

  tasks:
    - name: Update all packages
      package:
        name: '*'
        state: present
      tags:
        - update
        - security

    - name: Configure SSH hardening
      lineinfile:
        path: /etc/ssh/sshd_config
        regexp: "{{ item.regexp }}"
        line: "{{ item.line }}"
        state: present
      loop:
        - { regexp: '^PermitRootLogin', line: 'PermitRootLogin no' }
        - { regexp: '^PasswordAuthentication', line: 'PasswordAuthentication no' }
        - { regexp: '^PermitEmptyPasswords', line: 'PermitEmptyPasswords no' }
        - { regexp: '^X11Forwarding', line: 'X11Forwarding no' }
        - { regexp: '^MaxAuthTries', line: 'MaxAuthTries 3' }
      notify: restart sshd
      tags:
        - config
        - ssh
        - security

    - name: Install and configure fail2ban
      package:
        name: fail2ban
        state: present
      tags:
        - setup
        - security

    - name: Configure firewall with UFW
      ufw:
        rule: "{{ item.rule }}"
        port: "{{ item.port }}"
        proto: "{{ item.proto | default('tcp') }}"
      loop:
        - { rule: 'allow', port: '22' }
        - { rule: 'allow', port: '80' }
        - { rule: 'allow', port: '443' }
      tags:
        - firewall
        - security

    - name: Enable UFW
      ufw:
        state: enabled
        policy: deny
        direction: incoming
      tags:
        - firewall
        - security

    - name: Install and configure auditd
      package:
        name: auditd
        state: present
      tags:
        - setup
        - audit
        - security

    - name: Start auditd service
      systemd:
        name: auditd
        state: started
        enabled: yes
      tags:
        - setup
        - audit
        - security

  handlers:
    - name: restart sshd
      systemd:
        name: sshd
        state: restarted
"""


class PlaybookValidator:
    """Validates generated playbooks"""

    @staticmethod
    def validate_syntax(playbook_content: str) -> Dict[str, Any]:
        """Validate playbook YAML syntax"""
        try:
            data = yaml.safe_load(playbook_content)
            return {"valid": True, "data": data}
        except yaml.YAMLError as e:
            return {"valid": False, "error": str(e)}

    @staticmethod
    def validate_structure(playbook_data: List[Dict]) -> List[str]:
        """Validate playbook structure and return warnings"""
        warnings = []

        for play in playbook_data:
            # Check required fields
            if "hosts" not in play:
                warnings.append("Play missing 'hosts' field")

            if "tasks" not in play and "roles" not in play:
                warnings.append("Play has neither 'tasks' nor 'roles'")

            # Check tasks
            if "tasks" in play:
                for idx, task in enumerate(play["tasks"]):
                    if "name" not in task:
                        warnings.append(f"Task {idx + 1} missing 'name' field")

                    # Check for at least one action
                    action_modules = [
                        k
                        for k in task.keys()
                        if k
                        not in [
                            "name",
                            "tags",
                            "when",
                            "register",
                            "delegate_to",
                            "become",
                            "become_user",
                            "vars",
                            "notify",
                            "loop",
                            "with_items",
                            "block",
                            "rescue",
                            "always",
                            "environment",
                            "changed_when",
                            "failed_when",
                            "ignore_errors",
                        ]
                    ]
                    if not action_modules:
                        warnings.append(
                            f"Task '{task.get('name', idx + 1)}' has no action module"
                        )

        return warnings


def main():
    """Main function for testing"""
    generator = PlaybookGenerator()

    # Test prompts
    test_prompts = [
        "Deploy a kubernetes application with 5 replicas and monitoring",
        "Setup Docker with compose and secure the system",
        "Configure PostgreSQL database with replication and backup",
        "Install and configure Prometheus and Grafana for monitoring",
        "Harden system security with firewall and SSH configuration",
    ]

    for prompt in test_prompts:
        print(f"\n{'='*60}")
        print(f"Prompt: {prompt}")
        print(f"{'='*60}")

        context = generator.analyze_prompt(prompt)
        print(f"Detected type: {context.playbook_type}")
        print(f"Environment: {context.environment}")
        print(f"Requirements: {context.requirements}")
        print(f"Tags: {context.tags}")

        playbook = generator.generate(context)

        # Validate
        validator = PlaybookValidator()
        validation = validator.validate_syntax(playbook)

        if validation["valid"]:
            warnings = validator.validate_structure(validation["data"])
            print("\nValidation: ✓ Valid")
            if warnings:
                print(f"Warnings: {warnings}")
        else:
            print(f"\nValidation: ✗ Invalid - {validation['error']}")

        print("\nGenerated Playbook Preview:")
        print(playbook[:500] + "..." if len(playbook) > 500 else playbook)


if __name__ == "__main__":
    main()
