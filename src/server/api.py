"""
FastAPI wrapper for the Playbook Generator service.
"""
from fastapi import FastAPI, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Tuple, Dict, Any
import logging
import os
import asyncio
import subprocess
import tempfile
import yaml
import json
import uuid
from pathlib import Path

from .playbook_generator import PlaybookGenerator
from .ai_providers import create_provider, PLAYBOOK_SYSTEM_PROMPT

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Ansible Playbook Generator API",
    description="AI-powered Ansible playbook generation service",
    version="2.0.0"
)

# Initialize generator (for template fallback)
generator = PlaybookGenerator()


# Request/Response Models
class GenerateRequest(BaseModel):
    prompt: str
    template: Optional[str] = None
    target_hosts: Optional[str] = "all"
    environment: Optional[str] = "production"
    tags: Optional[List[str]] = []
    # AI provider settings
    provider: Optional[str] = None  # gemini, openai, anthropic
    model: Optional[str] = None  # e.g., gemini-2.5-pro, gpt-4
    use_ai: Optional[bool] = True  # Set to False to use template-only generation


class GenerateResponse(BaseModel):
    success: bool
    playbook: Optional[str] = None
    playbook_type: Optional[str] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str


class ValidateRequest(BaseModel):
    playbook_content: str
    check_syntax: bool = True  # Also run ansible-playbook --syntax-check


class ValidateResponse(BaseModel):
    valid: bool
    yaml_valid: bool
    syntax_valid: Optional[bool] = None
    errors: List[str] = []
    warnings: List[str] = []


class LintRequest(BaseModel):
    playbook_content: str
    rules: Optional[List[str]] = None  # Specific rules to check
    skip_rules: Optional[List[str]] = None  # Rules to skip


class LintIssue(BaseModel):
    rule: str
    severity: str  # error, warning, info
    message: str
    line: Optional[int] = None
    column: Optional[int] = None


class LintResponse(BaseModel):
    success: bool
    issues: List[LintIssue] = []
    summary: Dict[str, int] = {}  # Count by severity
    error: Optional[str] = None


class ExecuteRequest(BaseModel):
    playbook_content: str
    inventory: str = "localhost,"  # Default to localhost
    extra_vars: Optional[Dict[str, Any]] = None
    limit: Optional[str] = None  # Limit to specific hosts
    tags: Optional[List[str]] = None
    skip_tags: Optional[List[str]] = None
    check_mode: bool = False  # Dry run
    diff_mode: bool = False  # Show changes
    verbosity: int = 0  # 0-4 for -v to -vvvv


class ExecuteResponse(BaseModel):
    success: bool
    execution_id: str
    status: str  # pending, running, success, failed
    output: str = ""
    error: Optional[str] = None
    stats: Optional[Dict[str, Any]] = None
    duration_seconds: Optional[float] = None


# Service class for AI playbook generation
class AIPlaybookService:
    """Service for AI-powered playbook generation with fallback to templates"""

    def __init__(
        self,
        default_provider: Optional[str] = None,
        default_model: Optional[str] = None
    ):
        self.default_provider = default_provider or os.getenv("AI_PROVIDER", "gemini")
        self.default_model = default_model or os.getenv("AI_MODEL")
        self.generator = PlaybookGenerator()

    async def generate(
        self,
        prompt: str,
        target_hosts: Optional[str],
        environment: Optional[str],
        tags: Optional[List[str]],
        use_ai: bool,
        provider: Optional[str],
        model: Optional[str]
    ) -> Tuple[str, str]:
        """
        Generate a playbook from prompt.

        Returns:
            Tuple of (playbook_content, playbook_type)
        """
        # Build full prompt with context
        full_prompt = self._build_full_prompt(prompt, target_hosts, environment, tags)

        # Try AI generation first
        if use_ai:
            try:
                playbook = await self._generate_with_ai(full_prompt, provider, model)
                playbook_type = self._detect_playbook_type(playbook)
                return playbook, playbook_type
            except Exception as e:
                logger.warning(f"AI generation failed, falling back to template: {e}")

        # Fallback to template-based generation
        return self._generate_with_template(prompt, target_hosts, environment, tags)

    def _build_full_prompt(
        self,
        prompt: str,
        target_hosts: Optional[str],
        environment: Optional[str],
        tags: Optional[List[str]]
    ) -> str:
        """Build full prompt with additional context"""
        context_parts = []

        if target_hosts and target_hosts != "all":
            context_parts.append(f"Target hosts: {target_hosts}")
        if environment:
            context_parts.append(f"Environment: {environment}")
        if tags:
            context_parts.append(f"Tags: {', '.join(tags)}")

        if context_parts:
            return prompt + "\n\nAdditional context:\n" + "\n".join(context_parts)

        return prompt

    async def _generate_with_ai(
        self,
        full_prompt: str,
        provider: Optional[str],
        model: Optional[str]
    ) -> str:
        """Generate playbook using AI provider"""
        provider_name = provider or self.default_provider
        model_name = model or self.default_model

        logger.info(f"Using AI provider: {provider_name}, model: {model_name or 'default'}")

        ai_provider = create_provider(provider_name, model_name)
        raw_playbook = await ai_provider.generate(full_prompt, PLAYBOOK_SYSTEM_PROMPT)

        # Clean up response
        playbook = self._clean_codeblock(raw_playbook)

        logger.info("AI generation successful")
        return playbook

    def _generate_with_template(
        self,
        prompt: str,
        target_hosts: Optional[str],
        environment: Optional[str],
        tags: Optional[List[str]]
    ) -> Tuple[str, str]:
        """Generate playbook using template-based approach"""
        logger.info("Using template-based generation")

        context = self.generator.analyze_prompt(prompt)

        if target_hosts:
            context.target_hosts = target_hosts
        if environment:
            context.environment = environment
        if tags:
            context.tags = tags

        playbook = self.generator.generate(context)
        playbook_type = context.playbook_type.value if context.playbook_type else "general"

        return playbook, playbook_type

    def _clean_codeblock(self, text: str) -> str:
        """Remove markdown code blocks from text"""
        text = text.strip()

        # Remove opening code block
        if text.startswith("```yaml"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]

        # Remove closing code block
        if text.endswith("```"):
            text = text[:-3]

        return text.strip()

    def _detect_playbook_type(self, playbook: str) -> str:
        """Detect playbook type from content"""
        lower = playbook.lower()

        if any(x in lower for x in ("kubernetes", "k8s")):
            return "kubernetes"
        if "docker" in lower:
            return "docker"
        if any(x in lower for x in ("nginx", "apache")):
            return "web"
        if any(x in lower for x in ("postgres", "mysql")):
            return "database"
        if any(x in lower for x in ("prometheus", "grafana")):
            return "monitoring"
        if any(x in lower for x in ("firewall", "ssh")):
            return "security"

        return "general"


# Initialize service
ai_service = AIPlaybookService()


# API Endpoints
@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(status="healthy", version="2.0.0")


@app.post("/generate", response_model=GenerateResponse)
async def generate_playbook(request: GenerateRequest):
    """Generate an Ansible playbook from a prompt using AI."""
    try:
        logger.info(f"Generating playbook for prompt: {request.prompt[:100]}...")

        playbook, playbook_type = await ai_service.generate(
            prompt=request.prompt,
            target_hosts=request.target_hosts,
            environment=request.environment,
            tags=request.tags,
            use_ai=request.use_ai,
            provider=request.provider,
            model=request.model
        )

        return GenerateResponse(
            success=True,
            playbook=playbook,
            playbook_type=playbook_type
        )

    except Exception as e:
        logger.error(f"Generation failed: {str(e)}")
        return GenerateResponse(
            success=False,
            error=str(e)
        )


@app.get("/templates")
async def list_templates():
    """List available playbook templates."""
    from .playbook_generator import PlaybookType
    return {
        "templates": [t.value for t in PlaybookType]
    }


@app.post("/validate", response_model=ValidateResponse)
async def validate_playbook(request: ValidateRequest):
    """Validate an Ansible playbook for YAML syntax and Ansible syntax errors."""
    errors = []
    warnings = []
    yaml_valid = False
    syntax_valid = None

    try:
        # Step 1: Validate YAML syntax
        try:
            parsed = yaml.safe_load(request.playbook_content)
            if parsed is None:
                errors.append("Empty playbook content")
            elif not isinstance(parsed, list):
                errors.append("Playbook must be a YAML list of plays")
            else:
                yaml_valid = True
        except yaml.YAMLError as e:
            errors.append(f"YAML syntax error: {str(e)}")

        # Step 2: Run ansible-playbook --syntax-check if YAML is valid
        if yaml_valid and request.check_syntax:
            with tempfile.NamedTemporaryFile(
                mode='w',
                suffix='.yml',
                delete=False
            ) as f:
                f.write(request.playbook_content)
                temp_path = f.name

            try:
                result = subprocess.run(
                    [
                        'ansible-playbook',
                        '--syntax-check',
                        temp_path
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30
                )

                if result.returncode == 0:
                    syntax_valid = True
                else:
                    syntax_valid = False
                    # Parse error output
                    error_output = result.stderr or result.stdout
                    if error_output:
                        errors.append(f"Ansible syntax error: {error_output.strip()}")

                # Check for warnings in output
                if result.stdout and 'WARNING' in result.stdout:
                    for line in result.stdout.split('\n'):
                        if 'WARNING' in line:
                            warnings.append(line.strip())

            except subprocess.TimeoutExpired:
                errors.append("Syntax check timed out after 30 seconds")
                syntax_valid = False
            except FileNotFoundError:
                errors.append("ansible-playbook command not found")
                syntax_valid = False
            finally:
                Path(temp_path).unlink(missing_ok=True)

        is_valid = yaml_valid and (syntax_valid is None or syntax_valid)

        return ValidateResponse(
            valid=is_valid,
            yaml_valid=yaml_valid,
            syntax_valid=syntax_valid,
            errors=errors,
            warnings=warnings
        )

    except Exception as e:
        logger.error(f"Validation failed: {str(e)}")
        return ValidateResponse(
            valid=False,
            yaml_valid=False,
            errors=[f"Validation error: {str(e)}"]
        )


@app.post("/lint", response_model=LintResponse)
async def lint_playbook(request: LintRequest):
    """Lint an Ansible playbook using ansible-lint."""
    try:
        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.yml',
            delete=False
        ) as f:
            f.write(request.playbook_content)
            temp_path = f.name

        try:
            cmd = ['ansible-lint', '-f', 'json', temp_path]

            # Add skip rules if specified
            if request.skip_rules:
                for rule in request.skip_rules:
                    cmd.extend(['--skip-list', rule])

            # Add specific rules if specified
            if request.rules:
                for rule in request.rules:
                    cmd.extend(['-r', rule])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )

            issues = []
            summary = {'error': 0, 'warning': 0, 'info': 0}

            # Parse JSON output
            if result.stdout:
                try:
                    lint_output = json.loads(result.stdout)

                    # ansible-lint JSON output is a list of issues
                    if isinstance(lint_output, list):
                        for item in lint_output:
                            severity = item.get('severity', 'warning').lower()
                            if severity not in summary:
                                severity = 'warning'

                            issue = LintIssue(
                                rule=item.get('rule', {}).get('id', 'unknown') if isinstance(item.get('rule'), dict) else item.get('rule', 'unknown'),
                                severity=severity,
                                message=item.get('message', item.get('description', 'No message')),
                                line=item.get('linenumber'),
                                column=item.get('column')
                            )
                            issues.append(issue)
                            summary[severity] = summary.get(severity, 0) + 1

                except json.JSONDecodeError:
                    # Fallback to text parsing if JSON fails
                    pass

            # Also check stderr for errors
            if result.stderr and 'error' in result.stderr.lower():
                issues.append(LintIssue(
                    rule='parse-error',
                    severity='error',
                    message=result.stderr.strip()
                ))
                summary['error'] += 1

            return LintResponse(
                success=result.returncode == 0,
                issues=issues,
                summary=summary
            )

        except subprocess.TimeoutExpired:
            return LintResponse(
                success=False,
                error="Lint check timed out after 60 seconds"
            )
        except FileNotFoundError:
            return LintResponse(
                success=False,
                error="ansible-lint command not found. Please install it with: pip install ansible-lint"
            )
        finally:
            Path(temp_path).unlink(missing_ok=True)

    except Exception as e:
        logger.error(f"Lint failed: {str(e)}")
        return LintResponse(
            success=False,
            error=str(e)
        )


@app.post("/execute", response_model=ExecuteResponse)
async def execute_playbook(request: ExecuteRequest):
    """Execute an Ansible playbook and return results."""
    import time

    execution_id = str(uuid.uuid4())
    start_time = time.time()

    try:
        # Create temporary playbook file
        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.yml',
            delete=False
        ) as f:
            f.write(request.playbook_content)
            playbook_path = f.name

        # Create temporary inventory file if needed
        inventory_path = None
        if request.inventory and ',' not in request.inventory:
            # It's a path, use directly
            inventory_arg = request.inventory
        else:
            # It's inline inventory (e.g., "localhost,")
            with tempfile.NamedTemporaryFile(
                mode='w',
                suffix='.ini',
                delete=False
            ) as f:
                f.write(f"[all]\n{request.inventory.rstrip(',')}\n")
                inventory_path = f.name
                inventory_arg = inventory_path

        try:
            # Build ansible-playbook command
            cmd = [
                'ansible-playbook',
                '-i', inventory_arg,
                playbook_path
            ]

            # Add extra vars
            if request.extra_vars:
                cmd.extend(['-e', json.dumps(request.extra_vars)])

            # Add limit
            if request.limit:
                cmd.extend(['-l', request.limit])

            # Add tags
            if request.tags:
                cmd.extend(['-t', ','.join(request.tags)])

            # Add skip tags
            if request.skip_tags:
                cmd.extend(['--skip-tags', ','.join(request.skip_tags)])

            # Add check mode
            if request.check_mode:
                cmd.append('--check')

            # Add diff mode
            if request.diff_mode:
                cmd.append('--diff')

            # Add verbosity
            if request.verbosity > 0:
                cmd.append('-' + 'v' * min(request.verbosity, 4))

            logger.info(f"Executing playbook: {' '.join(cmd)}")

            # Run ansible-playbook
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,  # 10 minute timeout
                env={
                    **os.environ,
                    'ANSIBLE_HOST_KEY_CHECKING': 'False',
                    'ANSIBLE_FORCE_COLOR': 'false'
                }
            )

            duration = time.time() - start_time

            # Parse stats from output if possible
            stats = None
            output = result.stdout or ""

            # Try to extract play recap
            if "PLAY RECAP" in output:
                recap_start = output.find("PLAY RECAP")
                recap_section = output[recap_start:]
                stats = {"raw_recap": recap_section.split('\n')[0:10]}

            if result.returncode == 0:
                return ExecuteResponse(
                    success=True,
                    execution_id=execution_id,
                    status="success",
                    output=output,
                    stats=stats,
                    duration_seconds=round(duration, 2)
                )
            else:
                return ExecuteResponse(
                    success=False,
                    execution_id=execution_id,
                    status="failed",
                    output=output,
                    error=result.stderr or "Playbook execution failed",
                    stats=stats,
                    duration_seconds=round(duration, 2)
                )

        except subprocess.TimeoutExpired:
            return ExecuteResponse(
                success=False,
                execution_id=execution_id,
                status="failed",
                error="Execution timed out after 10 minutes",
                duration_seconds=600.0
            )
        except FileNotFoundError:
            return ExecuteResponse(
                success=False,
                execution_id=execution_id,
                status="failed",
                error="ansible-playbook command not found"
            )
        finally:
            # Cleanup temporary files
            Path(playbook_path).unlink(missing_ok=True)
            if inventory_path:
                Path(inventory_path).unlink(missing_ok=True)

    except Exception as e:
        logger.error(f"Execution failed: {str(e)}")
        return ExecuteResponse(
            success=False,
            execution_id=execution_id,
            status="failed",
            error=str(e),
            duration_seconds=round(time.time() - start_time, 2)
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
