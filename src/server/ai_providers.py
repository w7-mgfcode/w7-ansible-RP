"""
AI Providers for Playbook Generation
Supports: Gemini, OpenAI, Anthropic
"""

import os
import json
import logging
import httpx
from typing import Optional, Dict, Any
from abc import ABC, abstractmethod

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AIProvider(ABC):
    """Abstract base class for AI providers"""

    @abstractmethod
    async def generate(self, prompt: str, system_prompt: str = "") -> str:
        """Generate content from prompt"""
        pass

    @abstractmethod
    def get_name(self) -> str:
        """Get provider name"""
        pass


class GeminiProvider(AIProvider):
    """Google Gemini AI Provider"""

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash"):
        self.api_key = api_key
        self.model = model
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"

    def get_name(self) -> str:
        return "gemini"

    async def generate(self, prompt: str, system_prompt: str = "") -> str:
        """Generate content using Gemini API"""

        # Combine system prompt with user prompt
        full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt

        url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"

        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": full_prompt}]
                }
            ],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 4096,
                "topP": 0.95,
            },
            "safetySettings": [
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
            ]
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(url, json=payload)
                response.raise_for_status()

                data = response.json()

                # Extract text from response
                if "candidates" in data and len(data["candidates"]) > 0:
                    candidate = data["candidates"][0]
                    if "content" in candidate and "parts" in candidate["content"]:
                        parts = candidate["content"]["parts"]
                        if len(parts) > 0 and "text" in parts[0]:
                            return parts[0]["text"]

                logger.error(f"Unexpected Gemini response structure: {data}")
                raise ValueError("Invalid response structure from Gemini API")

            except httpx.HTTPStatusError as e:
                logger.error(f"Gemini API error: {e.response.status_code} - {e.response.text}")
                raise
            except Exception as e:
                logger.error(f"Gemini generation failed: {str(e)}")
                raise


class OpenAIProvider(AIProvider):
    """OpenAI API Provider"""

    def __init__(self, api_key: str, model: str = "gpt-4"):
        self.api_key = api_key
        self.model = model
        self.base_url = "https://api.openai.com/v1"

    def get_name(self) -> str:
        return "openai"

    async def generate(self, prompt: str, system_prompt: str = "") -> str:
        """Generate content using OpenAI API"""

        url = f"{self.base_url}/chat/completions"

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 4096,
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()

                data = response.json()
                return data["choices"][0]["message"]["content"]

            except httpx.HTTPStatusError as e:
                logger.error(f"OpenAI API error: {e.response.status_code} - {e.response.text}")
                raise
            except Exception as e:
                logger.error(f"OpenAI generation failed: {str(e)}")
                raise


class AnthropicProvider(AIProvider):
    """Anthropic Claude API Provider"""

    def __init__(self, api_key: str, model: str = "claude-3-sonnet-20240229"):
        self.api_key = api_key
        self.model = model
        self.base_url = "https://api.anthropic.com/v1"

    def get_name(self) -> str:
        return "anthropic"

    async def generate(self, prompt: str, system_prompt: str = "") -> str:
        """Generate content using Anthropic API"""

        url = f"{self.base_url}/messages"

        payload = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}]
        }

        if system_prompt:
            payload["system"] = system_prompt

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()

                data = response.json()
                return data["content"][0]["text"]

            except httpx.HTTPStatusError as e:
                logger.error(f"Anthropic API error: {e.response.status_code} - {e.response.text}")
                raise
            except Exception as e:
                logger.error(f"Anthropic generation failed: {str(e)}")
                raise


def create_provider(
    provider: str = "gemini",
    model: Optional[str] = None,
    api_key: Optional[str] = None
) -> AIProvider:
    """
    Factory function to create AI provider from parameters or environment variables.

    Args:
        provider: Provider name (gemini, openai, anthropic)
        model: Model name (optional, uses defaults)
        api_key: API key (optional, reads from environment)

    Returns:
        AIProvider instance
    """

    provider = provider.lower()

    if provider == "gemini":
        key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not key:
            raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY environment variable required")
        return GeminiProvider(key, model or "gemini-2.5-flash")

    elif provider == "openai":
        key = api_key or os.getenv("OPENAI_API_KEY")
        if not key:
            raise ValueError("OPENAI_API_KEY environment variable required")
        return OpenAIProvider(key, model or "gpt-4")

    elif provider == "anthropic":
        key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise ValueError("ANTHROPIC_API_KEY environment variable required")
        return AnthropicProvider(key, model or "claude-3-sonnet-20240229")

    else:
        raise ValueError(f"Unknown provider: {provider}. Supported: gemini, openai, anthropic")


def get_default_provider() -> AIProvider:
    """
    Get the default AI provider based on environment variables.

    Reads AI_PROVIDER and AI_MODEL from environment.
    """
    provider = os.getenv("AI_PROVIDER", "gemini")
    model = os.getenv("AI_MODEL")

    return create_provider(provider, model)


# System prompt for playbook generation
PLAYBOOK_SYSTEM_PROMPT = """You are an expert Ansible playbook generator. Generate production-ready,
well-structured Ansible playbooks based on user requirements.

Guidelines:
1. Always use YAML format with proper indentation (2 spaces)
2. Include meaningful task names
3. Use variables for configurable values
4. Add appropriate tags for selective execution
5. Include handlers when needed
6. Follow Ansible best practices
7. Add comments for complex logic
8. Use become: yes for tasks requiring root
9. Include error handling where appropriate
10. Output ONLY the YAML playbook, no explanations

Start your response with '---' and end with a complete playbook."""
