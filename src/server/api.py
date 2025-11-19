"""
FastAPI wrapper for the Playbook Generator service.
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import logging
import os

from .playbook_generator import PlaybookGenerator, PlaybookContext, PlaybookType
from .ai_providers import create_provider, get_default_provider, PLAYBOOK_SYSTEM_PROMPT

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

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(status="healthy", version="1.0.0")

@app.post("/generate", response_model=GenerateResponse)
async def generate_playbook(request: GenerateRequest):
    """Generate an Ansible playbook from a prompt using AI."""
    try:
        logger.info(f"Generating playbook for prompt: {request.prompt[:100]}...")

        # Build context info for AI
        context_parts = []
        if request.target_hosts and request.target_hosts != "all":
            context_parts.append(f"Target hosts: {request.target_hosts}")
        if request.environment:
            context_parts.append(f"Environment: {request.environment}")
        if request.tags:
            context_parts.append(f"Tags: {', '.join(request.tags)}")

        # Build full prompt
        full_prompt = request.prompt
        if context_parts:
            full_prompt += "\n\nAdditional context:\n" + "\n".join(context_parts)

        playbook = None
        playbook_type = None

        # Try AI generation first
        if request.use_ai:
            try:
                # Get provider (from request or environment)
                provider_name = request.provider or os.getenv("AI_PROVIDER", "gemini")
                model_name = request.model or os.getenv("AI_MODEL")

                logger.info(f"Using AI provider: {provider_name}, model: {model_name or 'default'}")

                # Create provider
                ai_provider = create_provider(provider_name, model_name)

                # Generate with AI
                playbook = await ai_provider.generate(full_prompt, PLAYBOOK_SYSTEM_PROMPT)

                # Clean up response - extract YAML if wrapped in markdown
                if playbook:
                    playbook = playbook.strip()
                    # Remove markdown code blocks if present
                    if playbook.startswith("```yaml"):
                        playbook = playbook[7:]
                    elif playbook.startswith("```"):
                        playbook = playbook[3:]
                    if playbook.endswith("```"):
                        playbook = playbook[:-3]
                    playbook = playbook.strip()

                # Detect playbook type from content
                playbook_lower = playbook.lower()
                if "kubernetes" in playbook_lower or "k8s" in playbook_lower:
                    playbook_type = "kubernetes"
                elif "docker" in playbook_lower:
                    playbook_type = "docker"
                elif "nginx" in playbook_lower or "apache" in playbook_lower:
                    playbook_type = "web"
                elif "postgres" in playbook_lower or "mysql" in playbook_lower:
                    playbook_type = "database"
                elif "prometheus" in playbook_lower or "grafana" in playbook_lower:
                    playbook_type = "monitoring"
                elif "firewall" in playbook_lower or "ssh" in playbook_lower:
                    playbook_type = "security"
                else:
                    playbook_type = "general"

                logger.info(f"AI generation successful, type: {playbook_type}")

            except Exception as ai_error:
                logger.warning(f"AI generation failed, falling back to template: {str(ai_error)}")
                playbook = None

        # Fallback to template-based generation
        if not playbook:
            logger.info("Using template-based generation")
            context = generator.analyze_prompt(request.prompt)

            if request.target_hosts:
                context.target_hosts = request.target_hosts
            if request.environment:
                context.environment = request.environment
            if request.tags:
                context.tags = request.tags

            playbook = generator.generate(context)
            playbook_type = context.playbook_type.value if context.playbook_type else "general"

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
    return {
        "templates": [t.value for t in PlaybookType]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
