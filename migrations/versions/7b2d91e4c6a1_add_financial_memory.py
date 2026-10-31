"""Add user-controlled financial memory.

Revision ID: 7b2d91e4c6a1
Revises: c4fdb5c93899
Create Date: 2026-10-22 17:55:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7b2d91e4c6a1"
down_revision: Union[str, None] = "c4fdb5c93899"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("memory_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "financial_memories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_financial_memories_id"), "financial_memories", ["id"], unique=False)
    op.create_index(op.f("ix_financial_memories_user_id"), "financial_memories", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_financial_memories_user_id"), table_name="financial_memories")
    op.drop_index(op.f("ix_financial_memories_id"), table_name="financial_memories")
    op.drop_table("financial_memories")
    op.drop_column("users", "memory_enabled")
