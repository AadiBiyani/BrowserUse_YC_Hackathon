import os
from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise EnvironmentError(
            f"Missing required environment variable: {key}\n"
            f"Copy backend/.env.example to backend/.env and fill in your values."
        )
    return val


class Config:
    # LLM providers
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")

    # Observability
    LAMINAR_API_KEY: str = os.getenv("LAMINAR_API_KEY", "")

    # Evaluation
    HUD_API_KEY: str = os.getenv("HUD_API_KEY", "")

    # Convex
    CONVEX_SITE_URL: str = os.getenv("CONVEX_SITE_URL", "")
    CONVEX_URL: str = os.getenv("CONVEX_URL", "")

    # App
    HAR_OUTPUT_DIR: str = os.getenv("HAR_OUTPUT_DIR", "./runs")
    DEFAULT_MODEL: str = os.getenv("DEFAULT_MODEL", "gpt-4o")

    SUPPORTED_MODELS = [
        "gpt-4o",
        "claude-3-5-sonnet-20241022",
        "gemini-2.0-flash",
    ]

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
