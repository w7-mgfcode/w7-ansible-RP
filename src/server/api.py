"""
FastAPI wrapper for the Playbook Generator service.
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import logging

from .playbook_generator import PlaybookGenerator, PlaybookContext, PlaybookType

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Ansible Playbook Generator API",
    description="AI-powered Ansible playbook generation service",
    version="1.0.0"
)

# Initialize generator
generator = PlaybookGenerator()

class GenerateRequest(BaseModel):
    prompt: str
    template: Optional[str] = None
    target_hosts: Optional[str] = "all"
    environment: Optional[str] = "production"
    tags: Optional[List[str]] = []

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
    """Generate an Ansible playbook from a prompt."""
    try:
        logger.info(f"Generating playbook for prompt: {request.prompt[:100]}...")

        # Analyze prompt
        context = generator.analyze_prompt(request.prompt)

        # Override with request parameters
        if request.target_hosts:
            context.target_hosts = request.target_hosts
        if request.environment:
            context.environment = request.environment
        if request.tags:
            context.tags = request.tags

        # Generate playbook
        playbook = generator.generate(context)

        return GenerateResponse(
            success=True,
            playbook=playbook,
            playbook_type=context.playbook_type.value if context.playbook_type else None
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
