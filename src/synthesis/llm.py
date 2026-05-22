import httpx
import json
import boto3
import structlog
from src.config import settings

logger = structlog.get_logger(__name__)

def call_llm(prompt: str, max_tokens: int = 1000, temperature: float = 0.2) -> dict:
    """
    Unified LLM API router supporting Ollama, OpenAI, Anthropic, Bedrock Converse, and Mock.
    Returns:
        {
            "text": str,
            "input_tokens": int,
            "output_tokens": int,
            "model_used": str
        }
    """
    provider = settings.llm_provider
    if not provider:
        provider = "mock"
        
    logger.info("Routing LLM request", provider=provider)
    
    if provider == "mock":
        text = ""
        if "rationale" in prompt.lower():
            text = json.dumps({
                "ticker": "AAPL",
                "category": "S&P 500",
                "rationale": {
                    "Why": "Apple Inc. designs and manufactures premium consumer hardware and services. Its core competitive advantage is ecosystem lock-in, differentiating it from modular Android competitors.",
                    "Numbers": "Strong balance sheet with $50B free cash flow, operating margin at 30%, and consistent dividend yield of 0.5%.",
                    "Catalysts": "1. Launch of new on-device AI capabilities in iOS. 2. Continued expansion of services segment margins.",
                    "Risks": "1. Weakness in Chinese consumer demand. 2. Regulatory antitrust pressure on the App Store.",
                    "BottomLine": "A robust core holding for growth and quality-focused investors seeking premium margins."
                }
            })
        else:
            text = json.dumps({
                "WhatsHappening": "The ticker closed with positive momentum, supported by stable macro indicators. Market dynamics point to accumulation trends and high retail trading volume.",
                "WhatToWatch": "Product launches and upcoming regulatory filings in the coming weeks.",
                "Technicals": "Stable momentum above the 50-day moving average, with RSI indicating a healthy baseline.",
                "Risks": "Geopolitical uncertainty and sector-wide growth stock revaluations.",
                "BottomLine": "A favorable long-term addition with support holding at current key levels.",
                "Signal": "HOLD"
            })
        return {
            "text": text,
            "input_tokens": 100,
            "output_tokens": 150,
            "model_used": "local-mock"
        }
        
    elif provider == "ollama":
        try:
            resp = httpx.post(
                f"{settings.ollama_url}/api/generate",
                json={
                    "model": settings.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": temperature}
                },
                timeout=120.0
            )
            resp.raise_for_status()
            full_text = resp.json().get('response', '')
            input_tokens = len(prompt) // 4
            output_tokens = len(full_text) // 4
            return {
                "text": full_text,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "model_used": f"ollama-{settings.ollama_model}"
            }
        except Exception as e:
            logger.error("Ollama invocation failed", error=str(e))
            raise
            
    elif provider == "openai":
        if not settings.openai_api_key:
            raise ValueError("openai_api_key settings missing in environment")
        try:
            headers = {
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": settings.openai_model,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            if "json" in prompt.lower():
                payload["response_format"] = {"type": "json_object"}
                
            with httpx.Client(timeout=90.0) as client:
                resp = client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                full_text = data['choices'][0]['message']['content']
                input_tokens = data['usage']['prompt_tokens']
                output_tokens = data['usage']['completion_tokens']
                return {
                    "text": full_text,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "model_used": f"openai-{settings.openai_model}"
                }
        except Exception as e:
            logger.error("OpenAI invocation failed", error=str(e))
            raise
            
    elif provider == "anthropic":
        if not settings.anthropic_api_key:
            raise ValueError("anthropic_api_key settings missing in environment")
        try:
            headers = {
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
            payload = {
                "model": settings.anthropic_model,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": max_tokens,
                "temperature": temperature
            }
            with httpx.Client(timeout=90.0) as client:
                resp = client.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                full_text = data['content'][0]['text']
                input_tokens = data['usage']['input_tokens']
                output_tokens = data['usage']['output_tokens']
                return {
                    "text": full_text,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "model_used": f"anthropic-{settings.anthropic_model}"
                }
        except Exception as e:
            logger.error("Anthropic native invocation failed", error=str(e))
            raise
            
    elif provider == "bedrock":
        try:
            bedrock = boto3.client('bedrock-runtime', region_name=settings.aws_default_region)
            model_id = "anthropic.claude-3-haiku-20240307-v1:0"
            
            messages = [
                {
                    "role": "user",
                    "content": [{"text": prompt}]
                }
            ]
            response = bedrock.converse(
                modelId=model_id,
                messages=messages,
                inferenceConfig={
                    "maxTokens": max_tokens,
                    "temperature": temperature
                }
            )
            full_text = response['output']['message']['content'][0]['text']
            input_tokens = response['usage']['inputTokens']
            output_tokens = response['usage']['outputTokens']
            return {
                "text": full_text,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "model_used": f"bedrock-{model_id}"
            }
        except Exception as e:
            logger.error("AWS Bedrock Converse API failed", error=str(e))
            raise
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")
