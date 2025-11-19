"""
AI Providers for Playbook Generation
Supports: Gemini, OpenAI, Anthropic
"""

import os
import json
import logging
import httpx
from typing import Optional, Dict, Any, Tuple
from abc import ABC, abstractmethod

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AIProvider(ABC):
    """Abstract base class for AI providers with centralized HTTP handling"""

    base_url: str
    default_model: str

    def __init__(self, api_key: str, model: Optional[str] = None):
        self.api_key = api_key
        self.model = model or self.default_model

    @abstractmethod
    def _build_request(self, prompt: str, system_prompt: str) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        """
        Build request for this provider.

        Returns:
            Tuple of (path, json_body, headers)
        """
        pass

    @abstractmethod
    def _extract_text(self, data: Dict[str, Any]) -> str:
        """Extract generated text from the provider's JSON response."""
        pass

    @abstractmethod
    def get_name(self) -> str:
        """Get provider name"""
        pass

    async def _post(self, path: str, json_body: dict, headers: dict) -> dict:
        """Centralized HTTP POST with error handling"""
        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(url, json=json_body, headers=headers)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                logger.error(
                    f"{self.get_name()} API error: "
                    f"{e.response.status_code} - {e.response.text}"
                )
                raise
            except Exception as e:
                logger.error(f"{self.get_name()} generation failed: {e}")
                raise

    async def generate(self, prompt: str, system_prompt: str = "") -> str:
        """Generate content from prompt using centralized HTTP handling"""
        path, body, headers = self._build_request(prompt, system_prompt)
        data = await self._post(path, body, headers)
        return self._extract_text(data)


class GeminiProvider(AIProvider):
    """Google Gemini AI Provider"""

    base_url = "https://generativelanguage.googleapis.com/v1beta"
    default_model = "gemini-2.5-flash"

    def get_name(self) -> str:
        return "gemini"

    def _build_request(self, prompt: str, system_prompt: str) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        # Combine system prompt with user prompt
        full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt

        path = f"/models/{self.model}:generateContent?key={self.api_key}"
        headers = {"Content-Type": "application/json"}

        body = {
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

        return path, body, headers

    def _extract_text(self, data: Dict[str, Any]) -> str:
        # Validate response structure
        if (
            isinstance(data, dict)
            and "candidates" in data
            and isinstance(data["candidates"], list)
            and len(data["candidates"]) > 0
            and "content" in data["candidates"][0]
            and "parts" in data["candidates"][0]["content"]
            and isinstance(data["candidates"][0]["content"]["parts"], list)
            and len(data["candidates"][0]["content"]["parts"]) > 0
            and "text" in data["candidates"][0]["content"]["parts"][0]
        ):
            return data["candidates"][0]["content"]["parts"][0]["text"]

        logger.error(f"Unexpected Gemini response structure: {data}")
        raise ValueError("Invalid response structure from Gemini API")


class OpenAIProvider(AIProvider):
    """OpenAI API Provider"""

    base_url = "https://api.openai.com/v1"
    default_model = "gpt-4"

    def get_name(self) -> str:
        return "openai"

    def _build_request(self, prompt: str, system_prompt: str) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        path = "/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        body = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 4096,
        }

        return path, body, headers

    def _extract_text(self, data: Dict[str, Any]) -> str:
        # Validate response structure
        if (
            isinstance(data, dict)
            and "choices" in data
            and isinstance(data["choices"], list)
            and len(data["choices"]) > 0
            and "message" in data["choices"][0]
            and "content" in data["choices"][0]["message"]
        ):
            return data["choices"][0]["message"]["content"]

        logger.error(f"OpenAI response missing required keys: {data}")
        raise ValueError("Invalid response structure from OpenAI API")


class AnthropicProvider(AIProvider):
    """Anthropic Claude API Provider"""

    base_url = "https://api.anthropic.com/v1"
    default_model = "claude-3-sonnet-20240229"

    def get_name(self) -> str:
        return "anthropic"

    def _build_request(self, prompt: str, system_prompt: str) -> Tuple[str, Dict[str, Any], Dict[str, str]]:
        path = "/messages"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }

        body = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}]
        }

        if system_prompt:
            body["system"] = system_prompt

        return path, body, headers

    def _extract_text(self, data: Dict[str, Any]) -> str:
        # Validate Anthropic response structure
        if (
            "content" not in data
            or not isinstance(data["content"], list)
            or len(data["content"]) == 0
            or "text" not in data["content"][0]
        ):
            logger.error(f"Unexpected Anthropic response structure: {data}")
            raise ValueError("Invalid response structure from Anthropic API")

        return data["content"][0]["text"]


def create_provider(
    provider: Optional[str] = "gemini",
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

    # Handle None provider gracefully
    provider_name = (provider or "gemini").lower()

    if provider_name == "gemini":
        key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not key:
            raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY environment variable required")
        return GeminiProvider(key, model)

    elif provider_name == "openai":
        key = api_key or os.getenv("OPENAI_API_KEY")
        if not key:
            raise ValueError("OPENAI_API_KEY environment variable required")
        return OpenAIProvider(key, model)

    elif provider_name == "anthropic":
        key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise ValueError("ANTHROPIC_API_KEY environment variable required")
        return AnthropicProvider(key, model)

    else:
        raise ValueError(f"Unknown provider: {provider_name}. Supported: gemini, openai, anthropic")


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
