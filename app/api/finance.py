from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.core.database import get_db
from app.models.budget import Budget
from app.models.savings import SavingsGoal
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.schemas.finance import (
    BudgetCreate,
    GoalContribution,
    GoalCreate,
    GoalUpdate,
    TransactionCreate,
)

router = APIRouter(prefix="/api", tags=["Finance"])


def transaction_data(transaction: Transaction) -> dict:
    return {
        "id": transaction.id,
        "type": transaction.type.value.lower(),
        "amount": transaction.amount,
        "category": transaction.category,
        "description": transaction.description or "",
        "date": transaction.date.isoformat() if transaction.date else None,
    }


def budget_data(budget: Budget, spent_amount: float) -> dict:
    return {
        "id": budget.id,
        "category": budget.category,
        "limit_amount": budget.limit_amount,
        "spent_amount": spent_amount,
        "month": budget.month,
        "year": budget.year,
    }


def goal_data(goal: SavingsGoal) -> dict:
    return {
        "id": goal.id,
        "name": goal.name,
        "target_amount": goal.target_amount,
        "current_amount": goal.current_amount or 0,
        "deadline": goal.deadline.isoformat() if goal.deadline else None,
        "is_completed": goal.is_completed,
    }


def month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


@router.get("/dashboard/stats")
def dashboard_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    now = datetime.now(timezone.utc)
    month_start, next_month = month_bounds(now.year, now.month)
    month_keys = []
    for offset in reversed(range(6)):
        month_index = now.year * 12 + now.month - 1 - offset
        month_keys.append((month_index // 12, month_index % 12 + 1))
    history_start, _ = month_bounds(*month_keys[0])
    monthly_history = {
        key: {"year": key[0], "month": key[1], "income": 0.0, "expense": 0.0}
        for key in month_keys
    }
    history_transactions = (
        db.query(Transaction.type, Transaction.amount, Transaction.date)
        .filter(
            Transaction.user_id == user.id,
            Transaction.date >= history_start,
            Transaction.date < next_month,
        )
        .all()
    )
    for transaction_type, amount, transaction_date in history_transactions:
        if transaction_date is None:
            continue
        month = monthly_history.get((transaction_date.year, transaction_date.month))
        if month is not None:
            field = "income" if transaction_type == TransactionType.INCOME else "expense"
            month[field] += float(amount)

    totals = db.query(
        func.coalesce(
            func.sum(
                case(
                    (Transaction.type == TransactionType.INCOME, Transaction.amount),
                    else_=0,
                )
            ),
            0,
        ).label("income"),
        func.coalesce(
            func.sum(
                case(
                    (Transaction.type == TransactionType.EXPENSE, Transaction.amount),
                    else_=0,
                )
            ),
            0,
        ).label("expense"),
    ).filter(
        Transaction.user_id == user.id,
        Transaction.date >= month_start,
        Transaction.date < next_month,
    ).one()

    balance = db.query(
        func.coalesce(
            func.sum(
                case(
                    (Transaction.type == TransactionType.INCOME, Transaction.amount),
                    else_=-Transaction.amount,
                )
            ),
            0,
        )
    ).filter(Transaction.user_id == user.id).scalar()

    recent = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(8)
        .all()
    )
    active_goal_totals = db.query(
        func.count(SavingsGoal.id).label("count"),
        func.coalesce(func.sum(SavingsGoal.current_amount), 0).label("saved"),
        func.coalesce(func.sum(SavingsGoal.target_amount), 0).label("target"),
    ).filter(
        SavingsGoal.user_id == user.id,
        SavingsGoal.is_completed.is_(False),
    ).one()
    goal_target = float(active_goal_totals.target or 0)
    goal_saved = float(active_goal_totals.saved or 0)
    monthly_income = float(totals.income or 0)
    monthly_expense = float(totals.expense or 0)
    return {
        "balance": float(balance or 0),
        "income": monthly_income,
        "expense": monthly_expense,
        "monthly_net": monthly_income - monthly_expense,
        "savings_rate": round(
            (monthly_income - monthly_expense) / monthly_income * 100,
            1,
        ) if monthly_income else 0,
        "monthly_transaction_count": len([
            item for item in history_transactions
            if item.date is not None and item.date.year == now.year and item.date.month == now.month
        ]),
        "active_goals": int(active_goal_totals.count or 0),
        "goal_saved": goal_saved,
        "goal_target": goal_target,
        "goal_progress_percent": min(goal_saved / goal_target * 100, 100) if goal_target else 0,
        "monthly_history": list(monthly_history.values()),
        "transactions": [transaction_data(item) for item in recent],
    }


@router.get("/transactions")
def list_transactions(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    transactions = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(limit)
        .all()
    )
    return [transaction_data(item) for item in transactions]


@router.post("/transactions", status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    transaction = Transaction(
        user_id=user.id,
        type=TransactionType(payload.type),
        amount=payload.amount,
        category=payload.category.strip(),
        description=payload.description.strip() if payload.description else None,
        date=payload.date or datetime.now(timezone.utc),
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return transaction_data(transaction)


@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    transaction = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user.id)
        .first()
    )
    if transaction is None:
        raise HTTPException(status_code=404, detail="Operatsiya topilmadi")
    db.delete(transaction)
    db.commit()


@router.put("/transactions/{transaction_id}")
def update_transaction(
    transaction_id: int,
    payload: TransactionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    transaction = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user.id)
        .first()
    )
    if transaction is None:
        raise HTTPException(status_code=404, detail="Operatsiya topilmadi")
    transaction.type = TransactionType(payload.type)
    transaction.amount = payload.amount
    transaction.category = payload.category.strip()
    transaction.description = payload.description.strip() if payload.description else None
    if payload.date is not None:
        transaction.date = payload.date
    db.commit()
    db.refresh(transaction)
    return transaction_data(transaction)


@router.get("/budgets")
def list_budgets(
    month: int = Query(ge=1, le=12),
    year: int = Query(ge=2000, le=2200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    start, end = month_bounds(year, month)
    budgets = (
        db.query(Budget)
        .filter(
            Budget.user_id == user.id,
            Budget.month == month,
            Budget.year == year,
        )
        .order_by(Budget.category)
        .all()
    )
    result = []
    for budget in budgets:
        spent = (
            db.query(func.coalesce(func.sum(Transaction.amount), 0))
            .filter(
                Transaction.user_id == user.id,
                Transaction.type == TransactionType.EXPENSE,
                Transaction.category == budget.category,
                Transaction.date >= start,
                Transaction.date < end,
            )
            .scalar()
        )
        result.append(budget_data(budget, float(spent or 0)))
    return result


@router.post("/budgets", status_code=status.HTTP_201_CREATED)
def create_or_update_budget(
    payload: BudgetCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    category = payload.category.strip()
    budget = (
        db.query(Budget)
        .filter(
            Budget.user_id == user.id,
            Budget.category == category,
            Budget.month == payload.month,
            Budget.year == payload.year,
        )
        .first()
    )
    if budget is None:
        budget = Budget(
            user_id=user.id,
            category=category,
            month=payload.month,
            year=payload.year,
            limit_amount=payload.limit_amount,
        )
        db.add(budget)
    else:
        budget.limit_amount = payload.limit_amount
    db.commit()
    db.refresh(budget)
    start, end = month_bounds(payload.year, payload.month)
    spent = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.user_id == user.id,
            Transaction.type == TransactionType.EXPENSE,
            Transaction.category == category,
            Transaction.date >= start,
            Transaction.date < end,
        )
        .scalar()
    )
    return budget_data(budget, float(spent or 0))


@router.delete("/budgets/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    budget = (
        db.query(Budget)
        .filter(Budget.id == budget_id, Budget.user_id == user.id)
        .first()
    )
    if budget is None:
        raise HTTPException(status_code=404, detail="Byudjet topilmadi")
    db.delete(budget)
    db.commit()


@router.get("/goals")
def list_goals(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    goals = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.user_id == user.id)
        .order_by(SavingsGoal.created_at.desc(), SavingsGoal.id.desc())
        .all()
    )
    return [goal_data(goal) for goal in goals]


@router.post("/goals", status_code=status.HTTP_201_CREATED)
def create_goal(
    payload: GoalCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    goal = SavingsGoal(
        user_id=user.id,
        name=payload.name.strip(),
        target_amount=payload.target_amount,
        deadline=payload.deadline,
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal_data(goal)


@router.patch("/goals/{goal_id}")
def update_goal(
    goal_id: int,
    payload: GoalUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    goal = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == user.id)
        .first()
    )
    if goal is None:
        raise HTTPException(status_code=404, detail="Maqsad topilmadi")
    if payload.name is not None:
        goal.name = payload.name.strip()
    if payload.target_amount is not None:
        goal.target_amount = payload.target_amount
        goal.current_amount = min(goal.current_amount or 0, payload.target_amount)
    if "deadline" in payload.model_fields_set:
        goal.deadline = payload.deadline
    goal.is_completed = (goal.current_amount or 0) >= goal.target_amount
    db.commit()
    db.refresh(goal)
    return goal_data(goal)


@router.post("/goals/{goal_id}/contributions")
def contribute_to_goal(
    goal_id: int,
    payload: GoalContribution,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    goal = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == user.id)
        .first()
    )
    if goal is None:
        raise HTTPException(status_code=404, detail="Maqsad topilmadi")
    if goal.is_completed:
        raise HTTPException(status_code=400, detail="Bu maqsad allaqachon bajarilgan")
    goal.current_amount = min(
        (goal.current_amount or 0) + payload.amount,
        goal.target_amount,
    )
    goal.is_completed = goal.current_amount >= goal.target_amount
    db.commit()
    db.refresh(goal)
    return goal_data(goal)


@router.delete("/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    goal_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    goal = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == user.id)
        .first()
    )
    if goal is None:
        raise HTTPException(status_code=404, detail="Maqsad topilmadi")
    db.delete(goal)
    db.commit()
