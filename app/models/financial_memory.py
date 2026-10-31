import sqlalchemy as sa
from sqlalchemy import Column, DateTime, ForeignKey, Integer
from sqlalchemy.sql import func

from app.core.database import Base


class FinancialMemory(Base):
    __tablename__ = "financial_memories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    content = Column(sa.Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
