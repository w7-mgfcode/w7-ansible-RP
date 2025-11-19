"""
FastAPI wrapper for the Playbook Generator service.
"""
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional, List, Tuple
import logging
import os

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
