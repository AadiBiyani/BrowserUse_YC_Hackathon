import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # Browser Use Cloud (optional fallback -- open-source lib needs no key)
    BROWSER_USE_API_KEY: str = os.getenv("BROWSER_USE_API_KEY", "")

    # LLM providers
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")

    # Observability - Laminar
    LAMINAR_API_KEY: str = os.getenv("LAMINAR_API_KEY", "")

    # Evaluation - HUD
    HUD_API_KEY: str = os.getenv("HUD_API_KEY", "")

    # Convex
    CONVEX_SITE_URL: str = os.getenv("CONVEX_SITE_URL", "")
    CONVEX_URL: str = os.getenv("CONVEX_URL", "")

    # App
    HAR_OUTPUT_DIR: str = os.getenv("HAR_OUTPUT_DIR", "./runs")
    DEFAULT_MODEL: str = os.getenv("DEFAULT_MODEL", "gpt-4o")

    # Canonical model IDs used throughout the codebase
    MODELS = {
        "gpt-4o": {
            "provider": "openai",
            "display_name": "GPT-4o",
        },
        "claude-3-5-sonnet-20241022": {
            "provider": "anthropic",
            "display_name": "Claude 3.5 Sonnet",
        },
        "gemini-2.0-flash": {
            "provider": "google",
            "display_name": "Gemini 2.0 Flash",
        },
    }

    def get_langchain_llm(self, model_id: str):
        """Return the correct LangChain chat model for a given model ID."""
        if model_id not in self.MODELS:
            raise ValueError(f"Unsupported model: {model_id}. Choose from {list(self.MODELS)}")

        provider = self.MODELS[model_id]["provider"]

        if provider == "openai":
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(model=model_id, api_key=self.OPENAI_API_KEY)

        if provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(model=model_id, api_key=self.ANTHROPIC_API_KEY)

        if provider == "google":
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(model=model_id, google_api_key=self.GOOGLE_API_KEY)

    def validate(self):
        """Call at startup to catch missing keys early."""
        errors = []
        required = {
            "OPENAI_API_KEY": self.OPENAI_API_KEY,
            "ANTHROPIC_API_KEY": self.ANTHROPIC_API_KEY,
            "GOOGLE_API_KEY": self.GOOGLE_API_KEY,
            "LAMINAR_API_KEY": self.LAMINAR_API_KEY,
            "CONVEX_SITE_URL": self.CONVEX_SITE_URL,
        }
        for key, val in required.items():
            if not val:
                errors.append(key)
        if errors:
            raise EnvironmentError(
                f"Missing environment variables: {', '.join(errors)}\n"
                f"Copy backend/.env.example to backend/.env and fill in your values."
            )
        os.makedirs(self.HAR_OUTPUT_DIR, exist_ok=True)


config = Config()
