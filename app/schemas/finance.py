from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


def validate_nonblank(value: Optional[str]) -> Optional[str]:
    if value is not None and not value.strip():
        raise ValueError("Qiymat bo'sh bo'lmasligi kerak")
    return value.strip() if value is not None else None


def normalize_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return value.strip() or None


class TransactionCreate(BaseModel):
    type: Literal["income", "expense"]
    amount: float = Field(gt=0, allow_inf_nan=False)
    category: str = Field(min_length=1, max_length=50)
    description: Optional[str] = Field(default=None, max_length=500)
    date: Optional[datetime] = None

    _validate_category = field_validator("category")(validate_nonblank)
    _normalize_description = field_validator("description")(normalize_optional_text)


class BudgetCreate(BaseModel):
    category: str = Field(min_length=1, max_length=50)
    limit_amount: float = Field(gt=0, allow_inf_nan=False)
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2000, le=2200)

    _validate_category = field_validator("category")(validate_nonblank)


class GoalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    target_amount: float = Field(gt=0, allow_inf_nan=False)
    deadline: Optional[datetime] = None

    _validate_name = field_validator("name")(validate_nonblank)


class GoalUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    target_amount: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    deadline: Optional[datetime] = None

    _validate_name = field_validator("name")(validate_nonblank)


class GoalContribution(BaseModel):
    amount: float = Field(gt=0, allow_inf_nan=False)


class ChatMessage(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class TwinScenario(BaseModel):
    months: int = Field(default=12, ge=1, le=120)
    monthly_income: float = Field(ge=0, allow_inf_nan=False)
    monthly_expenses: float = Field(ge=0, allow_inf_nan=False)
    monthly_savings: float = Field(ge=0, allow_inf_nan=False)
    annual_inflation_percent: float = Field(default=8, ge=0, le=100, allow_inf_nan=False)
    starting_balance: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)


class DecisionScenario(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    monthly_savings: float = Field(ge=0, allow_inf_nan=False)

    _validate_name = field_validator("name")(validate_nonblank)


class DecisionComparison(BaseModel):
    target_amount: float = Field(gt=0, allow_inf_nan=False)
    current_savings: float = Field(default=0, ge=0, allow_inf_nan=False)
    monthly_income: float = Field(default=0, ge=0, allow_inf_nan=False)
    monthly_expenses: float = Field(default=0, ge=0, allow_inf_nan=False)
    scenarios: list[DecisionScenario] = Field(min_length=2, max_length=4)


class LifeEventPlan(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    target_amount: float = Field(gt=0, allow_inf_nan=False)
    current_savings: float = Field(default=0, ge=0, allow_inf_nan=False)
    months: int = Field(ge=1, le=600)

    _validate_name = field_validator("name")(validate_nonblank)


class MemoryPreference(BaseModel):
    enabled: bool


class MemoryCreate(BaseModel):
    content: str = Field(min_length=1, max_length=1000)

    _validate_content = field_validator("content")(validate_nonblank)


class ImportTransaction(TransactionCreate):
    pass


class ImportCommit(BaseModel):
    transactions: list[ImportTransaction] = Field(min_length=1, max_length=500)


class FinancialSearch(BaseModel):
    query: str = Field(min_length=1, max_length=100)

    _validate_query = field_validator("query")(validate_nonblank)
