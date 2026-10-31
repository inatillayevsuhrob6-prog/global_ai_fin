from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    # Groq API
    GROQ_API_KEY: str
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    
    # Database
    DATABASE_URL: str
    
    # Security
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # Admin
    ADMIN_USERNAME: str
    ADMIN_PASSWORD: str
    
    # App
    APP_NAME: str = "GLOBAL AI FIN-ASSISTANT"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_mode(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().casefold()
            if normalized in {"1", "true", "yes", "on", "debug", "development", "dev"}:
                return True
            if normalized in {"0", "false", "no", "off", "release", "production", "prod"}:
                return False
        raise ValueError(
            "DEBUG must be a boolean or one of: debug, development, release, production"
        )
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
