import { Router, Response, NextFunction } from 'express';
import { authMiddleware, optionalAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Predefined templates - in production, these would come from database or MCP server
const templates = new Map<string, {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  variables: string[];
}>();

// Initialize default templates
templates.set('kubernetes_deployment', {
  id: 'kubernetes_deployment',
  name: 'Kubernetes Deployment',
  description: 'Deploy applications to Kubernetes with namespace, replicas, and resource management',
  category: 'kubernetes',
  content: `---
- name: Deploy to Kubernetes
  hosts: "{{ target_hosts | default('localhost') }}"
  become: yes
  vars:
    app_name: "{{ app_name | default('myapp') }}"
    namespace: "{{ namespace | default('default') }}"
    replicas: "{{ replicas | default(3) }}"
    image: "{{ image | default('nginx:latest') }}"

  tasks:
    - name: Create namespace
      kubernetes.core.k8s:
        name: "{{ namespace }}"
        api_version: v1
        kind: Namespace
        state: present

    - name: Deploy application
      kubernetes.core.k8s:
        state: present
        definition:
          apiVersion: apps/v1
          kind: Deployment
          metadata:
            name: "{{ app_name }}"
            namespace: "{{ namespace }}"
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
                      - containerPort: 80
`,
  variables: ['app_name', 'namespace', 'replicas', 'image', 'target_hosts']
});

templates.set('docker_setup', {
  id: 'docker_setup',
  name: 'Docker Setup',
  description: 'Install and configure Docker and Docker Compose',
  category: 'docker',
  content: `---
- name: Docker Setup
  hosts: "{{ target_hosts | default('docker_hosts') }}"
  become: yes

  tasks:
    - name: Install Docker dependencies
      apt:
        name:
          - apt-transport-https
          - ca-certificates
          - curl
          - gnupg
          - lsb-release
        state: present
        update_cache: yes

    - name: Add Docker GPG key
      apt_key:
        url: https://download.docker.com/linux/ubuntu/gpg
        state: present

    - name: Add Docker repository
      apt_repository:
        repo: "deb [arch=amd64] https://download.docker.com/linux/ubuntu {{ ansible_distribution_release }} stable"
        state: present

    - name: Install Docker
      apt:
        name:
          - docker-ce
          - docker-ce-cli
          - containerd.io
          - docker-compose-plugin
        state: present
        update_cache: yes

    - name: Start Docker service
      service:
        name: docker
        state: started
        enabled: yes
`,
  variables: ['target_hosts']
});

templates.set('system_hardening', {
  id: 'system_hardening',
  name: 'System Hardening',
  description: 'Security hardening for Linux systems including SSH, firewall, and fail2ban',
  category: 'security',
  content: `---
- name: System Security Hardening
  hosts: "{{ target_hosts | default('all') }}"
  become: yes

  tasks:
    - name: Install security packages
      apt:
        name:
          - ufw
          - fail2ban
          - unattended-upgrades
        state: present

    - name: Configure SSH
      lineinfile:
        path: /etc/ssh/sshd_config
        regexp: "{{ item.regexp }}"
        line: "{{ item.line }}"
      loop:
        - { regexp: '^PermitRootLogin', line: 'PermitRootLogin no' }
        - { regexp: '^PasswordAuthentication', line: 'PasswordAuthentication no' }
        - { regexp: '^X11Forwarding', line: 'X11Forwarding no' }
      notify: restart sshd

    - name: Configure UFW defaults
      ufw:
        direction: "{{ item.direction }}"
        policy: "{{ item.policy }}"
      loop:
        - { direction: 'incoming', policy: 'deny' }
        - { direction: 'outgoing', policy: 'allow' }

    - name: Allow SSH
      ufw:
        rule: allow
        port: 22
        proto: tcp

    - name: Enable UFW
      ufw:
        state: enabled

  handlers:
    - name: restart sshd
      service:
        name: sshd
        state: restarted
`,
  variables: ['target_hosts']
});

templates.set('nginx_setup', {
  id: 'nginx_setup',
  name: 'Nginx Web Server',
  description: 'Install and configure Nginx web server with SSL support',
  category: 'web',
  content: `---
- name: Setup Nginx Web Server
  hosts: "{{ target_hosts | default('webservers') }}"
  become: yes
  vars:
    server_name: "{{ server_name | default('localhost') }}"
    ssl_enabled: "{{ ssl_enabled | default(false) }}"

  tasks:
    - name: Install Nginx
      apt:
        name: nginx
        state: present
        update_cache: yes

    - name: Configure Nginx site
      template:
        src: nginx_site.conf.j2
        dest: /etc/nginx/sites-available/default
      notify: reload nginx

    - name: Ensure Nginx is running
      service:
        name: nginx
        state: started
        enabled: yes

  handlers:
    - name: reload nginx
      service:
        name: nginx
        state: reloaded
`,
  variables: ['target_hosts', 'server_name', 'ssl_enabled']
});

templates.set('postgresql_setup', {
  id: 'postgresql_setup',
  name: 'PostgreSQL Database',
  description: 'Install and configure PostgreSQL database server',
  category: 'database',
  content: `---
- name: Setup PostgreSQL
  hosts: "{{ target_hosts | default('db_servers') }}"
  become: yes
  vars:
    db_name: "{{ db_name | default('myapp') }}"
    db_user: "{{ db_user | default('appuser') }}"
    # SECURITY: No default password - must be provided via extra vars
    db_password: "{{ db_password }}"

  tasks:
    - name: Install PostgreSQL
      apt:
        name:
          - postgresql
          - postgresql-contrib
          - python3-psycopg2
        state: present
        update_cache: yes

    - name: Ensure PostgreSQL is running
      service:
        name: postgresql
        state: started
        enabled: yes

    - name: Create database
      postgresql_db:
        name: "{{ db_name }}"
        state: present
      become_user: postgres

    - name: Create database user
      postgresql_user:
        name: "{{ db_user }}"
        password: "{{ db_password }}"
        db: "{{ db_name }}"
        priv: ALL
        state: present
      become_user: postgres
`,
  variables: ['target_hosts', 'db_name', 'db_user', 'db_password']
});

// GET /api/templates - List templates
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { category, search } = req.query;

  let result = Array.from(templates.values());

  if (category) {
    result = result.filter(t => t.category === category);
  }

  if (search) {
    const searchLower = (search as string).toLowerCase();
    result = result.filter(t =>
      t.name.toLowerCase().includes(searchLower) ||
      t.description.toLowerCase().includes(searchLower)
    );
  }

  res.json({
    templates: result.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      variables: t.variables
    }))
  });
});

// GET /api/templates/meta/categories - Get template categories
// NOTE: This route must be defined before /:id to avoid "meta" being treated as an ID
router.get('/meta/categories', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  const categories = new Set(Array.from(templates.values()).map(t => t.category));
  res.json({ categories: Array.from(categories) });
});

// GET /api/templates/:id - Get template by ID
router.get('/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const template = templates.get(req.params.id);

    if (!template) {
      throw new AppError('Template not found', 404);
    }

    res.json(template);
  } catch (error) {
    next(error);
  }
});

// POST /api/templates/:id/enrich - Enrich prompt with template
router.post('/:id/enrich', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const template = templates.get(req.params.id);

    if (!template) {
      throw new AppError('Template not found', 404);
    }

    const { prompt, variables: templateVariables } = req.body;

    if (!prompt) {
      throw new AppError('Prompt is required', 400);
    }

    // Validate variables if provided
    let validatedVariables: Record<string, string> = {};
    if (templateVariables) {
      if (typeof templateVariables !== 'object' || Array.isArray(templateVariables)) {
        throw new AppError('Variables must be an object', 400);
      }
      // Only accept string values for template variables
      for (const [key, value] of Object.entries(templateVariables)) {
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          throw new AppError(`Variable "${key}" must be a string, number, or boolean`, 400);
        }
        validatedVariables[key] = String(value);
      }
    }

    // This will integrate with MCP server's enrich_prompt tool
    res.json({
      success: true,
      originalPrompt: prompt,
      templateId: template.id,
      enrichedPrompt: `Using ${template.name} template: ${prompt}`,
      providedVariables: validatedVariables,
      templateVariables: template.variables
    });
  } catch (error) {
    next(error);
  }
});

export default router;
