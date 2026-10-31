import csv
import io
import math
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from openpyxl import load_workbook
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
import pytesseract
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.api.finance import month_bounds, transaction_data
from app.core.database import get_db
from app.models.budget import Budget
from app.models.financial_memory import FinancialMemory
from app.models.savings import SavingsGoal
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.schemas.finance import (
    DecisionComparison,
    FinancialSearch,
    ImportCommit,
    LifeEventPlan,
    MemoryCreate,
    MemoryPreference,
    TwinScenario,
)

router = APIRouter(prefix="/api/premium", tags=["Premium finance"])
MAX_IMPORT_SIZE = 5 * 1024 * 1024
SUBSCRIPTION_TERMS = (
    "subscription",
    "obuna",
    "netflix",
    "spotify",
    "youtube premium",
    "icloud",
    "monthly",
    "membership",
)
HEADER_ALIASES = {
    "date": {"date", "sana", "transaction date", "created_at"},
    "type": {"type", "turi", "kind", "transaction type"},
    "amount": {"amount", "summa", "value", "miqdor"},
    "category": {"category", "kategoriya", "type"},
    "description": {"description", "izoh", "nomi", "name", "merchant"},
}


def get_transactions(db: Session, user_id: int, since: datetime | None = None) -> list[Transaction]:
    query = db.query(Transaction).filter(Transaction.user_id == user_id)
    if since is not None:
        query = query.filter(Transaction.date >= since)
    return query.order_by(Transaction.date.asc(), Transaction.id.asc()).all()


def utc_datetime(value: datetime | None) -> datetime:
    if value is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def monthly_totals(transactions: list[Transaction]) -> tuple[float, float]:
    now = datetime.now(timezone.utc)
    start, end = month_bounds(now.year, now.month)
    income = sum(
        item.amount for item in transactions
        if item.type == TransactionType.INCOME and start <= utc_datetime(item.date) < end
    )
    expenses = sum(
        item.amount for item in transactions
        if item.type == TransactionType.EXPENSE and start <= utc_datetime(item.date) < end
    )
    return income, expenses


def category_expenses(transactions: list[Transaction]) -> dict[str, float]:
    totals: dict[str, float] = defaultdict(float)
    for item in transactions:
        if item.type == TransactionType.EXPENSE:
            totals[item.category] += item.amount
    return dict(totals)


def recurring_candidates(transactions: list[Transaction]) -> list[dict]:
    groups: dict[tuple[str, int], list[Transaction]] = defaultdict(list)
    for item in transactions:
        if item.type == TransactionType.EXPENSE:
            groups[(item.category.lower(), round(item.amount))].append(item)
    candidates = []
    for items in groups.values():
        if len(items) < 2:
            continue
        items.sort(key=lambda item: item.date)
        gaps = [(right.date - left.date).days for left, right in zip(items, items[1:])]
        if not gaps or not all(20 <= gap <= 45 for gap in gaps):
            continue
        description = items[-1].description or ""
        looks_like_subscription = any(
            term in f"{items[-1].category} {description}".lower()
            for term in SUBSCRIPTION_TERMS
        )
        candidates.append({
            "category": items[-1].category,
            "amount": float(items[-1].amount),
            "occurrences": len(items),
            "confidence": "likely" if looks_like_subscription else "possible recurring",
            "note": "Bekor qilishdan oldin xizmatni tekshiring; bu faqat takrorlanish belgisi.",
        })
    return sorted(candidates, key=lambda item: item["amount"], reverse=True)


def spending_anomalies(transactions: list[Transaction]) -> list[dict]:
    by_category: dict[str, list[Transaction]] = defaultdict(list)
    for item in transactions:
        if item.type == TransactionType.EXPENSE:
            by_category[item.category].append(item)
    anomalies = []
    for items in by_category.values():
        if len(items) < 4:
            continue
        values = [item.amount for item in items]
        baseline = median(values)
        if baseline <= 0:
            continue
        for item in items:
            if item.amount >= baseline * 2.5 and item.amount - baseline >= 1:
                anomalies.append({
                    "transaction": transaction_data(item),
                    "category_median": float(baseline),
                    "ratio": round(item.amount / baseline, 1),
                    "note": "Bu statistik ogohlantirish, firibgarlik aniqlovi emas.",
                })
    return sorted(anomalies, key=lambda item: item["transaction"]["amount"], reverse=True)[:20]


@router.get("/autopilot")
def autopilot(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    now = datetime.now(timezone.utc)
    recent = get_transactions(db, user.id, now - timedelta(days=90))
    income, expenses = monthly_totals(recent)
    current_budgets = (
        db.query(Budget)
        .filter(Budget.user_id == user.id, Budget.month == now.month, Budget.year == now.year)
        .all()
    )
    month_start, month_end = month_bounds(now.year, now.month)
    elapsed_days = max(1, (now.date() - month_start.date()).days + 1)
    days_in_month = (month_end.date() - month_start.date()).days
    recommendations = []
    for budget in current_budgets:
        spent = sum(
            item.amount for item in recent
            if item.type == TransactionType.EXPENSE
            and item.category.casefold() == budget.category.casefold()
            and month_start <= utc_datetime(item.date) < month_end
        )
        percent = spent / budget.limit_amount * 100 if budget.limit_amount else 0
        projected_spend = spent / elapsed_days * days_in_month
        projected_percent = projected_spend / budget.limit_amount * 100 if budget.limit_amount else 0
        if percent >= 80 or projected_percent >= 80:
            recommendations.append({
                "kind": "budget_warning",
                "category": budget.category,
                "spent": round(spent, 2),
                "limit": budget.limit_amount,
                "usage_percent": round(percent, 1),
                "projected_spend": round(projected_spend, 2),
                "projected_percent": round(projected_percent, 1),
                "message": (
                    f"{budget.category} byudjeti oy oxirigacha taxminan "
                    f"{projected_percent:.0f}% ishlatilishi mumkin."
                ),
            })

    categories = category_expenses(recent)
    months_observed = max(1, min(3, (90 + now.day - 1) // 30))
    for category, total in sorted(categories.items(), key=lambda pair: pair[1], reverse=True):
        if not any(item.category.casefold() == category.casefold() for item in current_budgets):
            suggested = max(1, round((total / months_observed) * 1.1))
            recommendations.append({
                "kind": "budget_suggestion",
                "category": category,
                "suggested_limit": suggested,
                "message": f"{category} uchun oyiga taxminan {suggested:,.0f} so'm limitni ko'rib chiqing.",
            })

    goals = db.query(SavingsGoal).filter(
        SavingsGoal.user_id == user.id,
        SavingsGoal.is_completed.is_(False),
    ).all()
    free_cash = max(0, income - expenses)
    for goal in goals:
        remaining = max(0, goal.target_amount - (goal.current_amount or 0))
        recommendations.append({
            "kind": "savings_plan",
            "goal": goal.name,
            "remaining": round(remaining, 2),
            "monthly_suggestion": round(min(remaining, free_cash * 0.2), 2),
            "message": f"{goal.name} maqsadiga muntazam jamg'arish rejasini ko'rib chiqing.",
        })

    return {
        "generated_at": now.isoformat(),
        "automatic_changes": False,
        "period_days": 90,
        "monthly_income": round(income, 2),
        "monthly_expenses": round(expenses, 2),
        "recommendations": recommendations,
        "recurring_candidates": recurring_candidates(recent),
        "anomalies": spending_anomalies(recent),
        "disclaimer": "Tavsiyalar faqat ko'rib chiqish uchun. Hech qanday moliyaviy ma'lumot avtomatik o'zgartirilmadi.",
    }


@router.get("/war-room")
def war_room(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    now = datetime.now(timezone.utc)
    transactions = get_transactions(db, user.id, now - timedelta(days=180))
    income, expenses = monthly_totals(transactions)
    budgets = db.query(Budget).filter(
        Budget.user_id == user.id,
        Budget.month == now.month,
        Budget.year == now.year,
    ).all()
    goals = db.query(SavingsGoal).filter(SavingsGoal.user_id == user.id).all()
    expenses_by_category = category_expenses(transactions)
    budget_agent = []
    month_start, month_end = month_bounds(now.year, now.month)
    for budget in budgets:
        spent = sum(
            item.amount for item in transactions
            if item.type == TransactionType.EXPENSE
            and item.category.casefold() == budget.category.casefold()
            and month_start <= utc_datetime(item.date) < month_end
        )
        if budget.limit_amount and spent / budget.limit_amount >= 0.8:
            budget_agent.append({
                "category": budget.category,
                "usage_percent": round(spent / budget.limit_amount * 100, 1),
                "severity": "high" if spent >= budget.limit_amount else "warning",
            })
    goal_agent = [
        {
            "name": goal.name,
            "progress_percent": round(min(100, (goal.current_amount or 0) / goal.target_amount * 100), 1),
            "remaining": round(max(0, goal.target_amount - (goal.current_amount or 0)), 2),
        }
        for goal in goals
    ]
    monthly_net = income - expenses
    agents = [
        {"agent": "Budget Agent", "status": "complete", "findings": budget_agent},
        {"agent": "Savings Agent", "status": "complete", "findings": goal_agent},
        {"agent": "Risk Agent", "status": "complete", "findings": spending_anomalies(transactions)},
        {"agent": "Forecast Agent", "status": "complete", "findings": {
            "monthly_income": round(income, 2),
            "monthly_expenses": round(expenses, 2),
            "monthly_net": round(monthly_net, 2),
            "six_month_net_projection": round(monthly_net * 6, 2),
            "method": "So'nggi ma'lumotlardan hisoblangan sodda chiziqli taxmin.",
        }},
        {"agent": "Subscription Agent", "status": "complete", "findings": recurring_candidates(transactions)},
        {"agent": "Report Agent", "status": "complete", "findings": {
            "largest_categories": sorted(
                [{"category": key, "amount": round(value, 2)} for key, value in expenses_by_category.items()],
                key=lambda item: item["amount"],
                reverse=True,
            )[:5],
        }},
    ]
    return {
        "generated_at": now.isoformat(),
        "agents": agents,
        "automatic_changes": False,
        "disclaimer": "Hisobot matematik xulosalardan tuzildi; kelajak prognozi kafolat emas.",
    }


@router.post("/digital-twin")
def digital_twin(
    payload: TwinScenario,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    starting_balance = payload.starting_balance
    if starting_balance is None:
        starting_balance = db.query(func.coalesce(
            func.sum(
                case(
                    (Transaction.type == TransactionType.INCOME, Transaction.amount),
                    else_=-Transaction.amount,
                )
            ),
            0,
        )).filter(Transaction.user_id == user.id).scalar() or 0
    balance = float(starting_balance)
    adjusted_expenses = payload.monthly_expenses
    monthly_inflation = (1 + payload.annual_inflation_percent / 100) ** (1 / 12) - 1
    projection = []
    for month in range(1, payload.months + 1):
        adjusted_expenses *= 1 + monthly_inflation
        monthly_net = payload.monthly_income - adjusted_expenses + payload.monthly_savings
        balance += monthly_net
        projection.append({
            "month": month,
            "projected_expenses": round(adjusted_expenses, 2),
            "monthly_net": round(monthly_net, 2),
            "projected_savings_contributions": round(payload.monthly_savings * month, 2),
            "projected_balance": round(balance, 2),
        })
    return {
        "projection": projection,
        "starting_balance": round(float(starting_balance), 2),
        "ending_balance": round(balance, 2),
        "monthly_savings_assumption": payload.monthly_savings,
        "note": "Oylik jamg'arma daromad va xarajatlar farqidan tashqari kiritiladigan alohida badal deb olinadi.",
        "disclaimer": "Soddalashtirilgan taxmin; daromad va xarajatlar o'zgarishi mumkin.",
    }


@router.post("/decision-lab")
def decision_lab(payload: DecisionComparison, user: User = Depends(get_current_user)) -> dict:
    del user
    results = []
    available = payload.monthly_income - payload.monthly_expenses
    for scenario in payload.scenarios:
        if payload.current_savings >= payload.target_amount:
            months_to_goal = 0
        elif scenario.monthly_savings > 0:
            months_to_goal = math.ceil(
                (payload.target_amount - payload.current_savings)
                / scenario.monthly_savings
            )
        else:
            months_to_goal = None
        results.append({
            "name": scenario.name,
            "monthly_savings": scenario.monthly_savings,
            "estimated_savings_12_months": round(payload.current_savings + scenario.monthly_savings * 12, 2),
            "months_to_goal": months_to_goal if payload.current_savings < payload.target_amount else 0,
            "monthly_budget_remaining": round(available - scenario.monthly_savings, 2),
            "within_current_surplus": scenario.monthly_savings <= available,
        })
    return {
        "target_amount": payload.target_amount,
        "scenarios": results,
        "monthly_difference": round(
            max(item["monthly_savings"] for item in results)
            - min(item["monthly_savings"] for item in results),
            2,
        ),
        "disclaimer": "Hisob-kitob foiz daromadini hisobga olmaydi va moliyaviy maslahat o'rnini bosmaydi.",
    }


@router.post("/life-planner")
def life_planner(payload: LifeEventPlan, user: User = Depends(get_current_user)) -> dict:
    del user
    gap = max(0, payload.target_amount - payload.current_savings)
    monthly_savings = gap / payload.months
    return {
        "name": payload.name,
        "target_amount": payload.target_amount,
        "current_savings": payload.current_savings,
        "gap": round(gap, 2),
        "months": payload.months,
        "monthly_savings_required": round(monthly_savings, 2),
        "milestones": [
            {
                "month": month,
                "saved_total": round(min(payload.target_amount, payload.current_savings + monthly_savings * month), 2),
            }
            for month in sorted(set([1, max(1, payload.months // 2), payload.months]))
        ],
        "alternatives": [
            {"monthly_savings": round(monthly_savings * 0.8, 2), "estimated_months": max(1, int((gap / (monthly_savings * 0.8)) + 0.999)) if gap else 0},
            {"monthly_savings": round(monthly_savings * 1.2, 2), "estimated_months": max(1, int((gap / (monthly_savings * 1.2)) + 0.999)) if gap else 0},
        ],
        "automatic_goal_created": False,
    }


@router.get("/report")
def financial_report(
    days: int = 7,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if days not in (7, 30, 90):
        raise HTTPException(status_code=422, detail="days 7, 30 yoki 90 bo'lishi kerak")
    transactions = get_transactions(db, user.id, datetime.now(timezone.utc) - timedelta(days=days))
    income = sum(item.amount for item in transactions if item.type == TransactionType.INCOME)
    expenses = sum(item.amount for item in transactions if item.type == TransactionType.EXPENSE)
    return {
        "period_days": days,
        "transaction_count": len(transactions),
        "income": round(income, 2),
        "expenses": round(expenses, 2),
        "net": round(income - expenses, 2),
        "categories": sorted(
            [{"category": key, "amount": round(value, 2)} for key, value in category_expenses(transactions).items()],
            key=lambda item: item["amount"],
            reverse=True,
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/search")
def financial_search(
    payload: FinancialSearch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    term = f"%{payload.query.strip()}%"
    transactions = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user.id,
            (Transaction.category.ilike(term) | Transaction.description.ilike(term)),
        )
        .order_by(Transaction.date.desc())
        .limit(50)
        .all()
    )
    goals = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.user_id == user.id, SavingsGoal.name.ilike(term))
        .limit(20)
        .all()
    )
    budgets = (
        db.query(Budget)
        .filter(Budget.user_id == user.id, Budget.category.ilike(term))
        .limit(20)
        .all()
    )
    return {
        "transactions": [transaction_data(item) for item in transactions],
        "goals": [{"id": item.id, "name": item.name} for item in goals],
        "budgets": [{"id": item.id, "category": item.category, "month": item.month, "year": item.year} for item in budgets],
    }


def normalize_header(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower().replace("_", " "))


def parse_import_rows(rows: list[list[object]]) -> list[dict]:
    if not rows:
        raise HTTPException(status_code=400, detail="Faylda ma'lumot topilmadi")
    header = [normalize_header(value) for value in rows[0]]
    columns: dict[str, int] = {}
    for name, aliases in HEADER_ALIASES.items():
        for index, value in enumerate(header):
            if value in {normalize_header(alias) for alias in aliases}:
                columns[name] = index
                break
    missing = [name for name in ("amount", "category") if name not in columns]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Ustunlar aniqlanmadi: {', '.join(missing)}. amount/summa va category/kategoriya kerak.",
        )
    preview = []
    errors = []
    for row_number, row in enumerate(rows[1:501], start=2):
        if not any(str(value or "").strip() for value in row):
            continue
        try:
            get_value = lambda field, default="": (
                row[columns[field]] if field in columns and columns[field] < len(row) else default
            )
            raw_amount = str(get_value("amount")).strip().replace(" ", "").replace(",", ".")
            amount = float(raw_amount)
            if amount <= 0:
                raise ValueError("Summa noldan katta bo'lishi kerak")
            raw_type = str(get_value("type", "expense")).strip().lower()
            transaction_type = (
                "income" if raw_type in {"income", "daromad", "kirim", "credit"} else "expense"
            )
            raw_date = get_value("date")
            if isinstance(raw_date, datetime):
                normalized_date = utc_datetime(raw_date)
                date_value = normalized_date.isoformat()
            elif raw_date:
                parsed = datetime.fromisoformat(str(raw_date).strip())
                date_value = utc_datetime(parsed).isoformat()
            else:
                date_value = datetime.now(timezone.utc).isoformat()
            category = str(get_value("category")).strip()
            if not category:
                raise ValueError("Kategoriya bo'sh")
            preview.append({
                "type": transaction_type,
                "amount": amount,
                "category": category[:50],
                "description": str(get_value("description")).strip()[:500] or None,
                "date": date_value,
                "source_row": row_number,
            })
        except (ValueError, TypeError, OverflowError) as error:
            errors.append({"row": row_number, "error": str(error)})
    return {"preview": preview, "errors": errors}


@router.post("/documents/preview")
async def preview_document(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
) -> dict:
    del user
    filename = (file.filename or "").lower()
    if not filename.endswith((".csv", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg", ".webp")):
        raise HTTPException(
            status_code=415,
            detail="CSV, XLSX, matnli PDF va PNG/JPG/WEBP chek rasmlari qo'llab-quvvatlanadi.",
        )
    content = await file.read(MAX_IMPORT_SIZE + 1)
    if len(content) > MAX_IMPORT_SIZE:
        raise HTTPException(status_code=413, detail="Fayl hajmi 5 MB dan oshmasligi kerak")
    extracted_document_text: str | None = None
    if filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
        try:
            with Image.open(io.BytesIO(content)) as image:
                if image.width * image.height > 20_000_000:
                    raise HTTPException(status_code=413, detail="Rasm o'lchami 20 megapikseldan oshmasligi kerak")
                extracted_text = pytesseract.image_to_string(image.convert("RGB"), lang="eng+rus")
        except HTTPException:
            raise
        except (UnidentifiedImageError, OSError) as error:
            raise HTTPException(status_code=422, detail="Rasm faylini o'qib bo'lmadi") from error
        except pytesseract.TesseractNotFoundError as error:
            raise HTTPException(status_code=503, detail="OCR xizmati serverda sozlanmagan") from error
        if not extracted_text.strip():
            raise HTTPException(status_code=422, detail="Rasmdan o'qiladigan matn topilmadi")
        return {
            "preview": [],
            "errors": [],
            "accepted_count": 0,
            "extracted_text": extracted_text[:12000],
            "requires_confirmation": True,
            "note": "Chek rasmini OCR o'qidi. Matnni tekshiring; yozuvlarni qo'lda kiritib tasdiqlashingiz kerak.",
        }
    if filename.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(content))
            if len(reader.pages) > 50:
                raise HTTPException(status_code=413, detail="PDF 50 sahifadan oshmasligi kerak")
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=422, detail="PDF faylni o'qib bo'lmadi") from error
        if not text.strip():
            raise HTTPException(
                status_code=422,
                detail="PDF ichida matn topilmadi. Skanerlangan PDF uchun OCR rasmini yuklang.",
            )
        extracted_document_text = text
        rows = list(csv.reader(io.StringIO(text)))
    elif filename.endswith(".csv"):
        try:
            text = content.decode("utf-8-sig")
            sample = text[:4096]
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel
            rows = list(csv.reader(io.StringIO(text), dialect))
        except UnicodeDecodeError as error:
            raise HTTPException(status_code=422, detail="CSV UTF-8 formatida bo'lishi kerak") from error
    else:
        try:
            workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            sheet = workbook.active
            rows = [list(row) for row in sheet.iter_rows(values_only=True, max_row=501)]
            workbook.close()
        except Exception as error:
            raise HTTPException(status_code=422, detail="XLSX faylni o'qib bo'lmadi") from error
    try:
        result = parse_import_rows(rows)
    except HTTPException as error:
        if not extracted_document_text or error.status_code != status.HTTP_422_UNPROCESSABLE_ENTITY:
            raise
        return {
            "preview": [],
            "errors": [],
            "accepted_count": 0,
            "extracted_text": extracted_document_text[:12000],
            "requires_confirmation": True,
            "note": "PDF matni ajratildi, lekin operatsiya jadvali avtomatik aniqlanmadi. Matnni tekshirib, yozuvlarni qo'lda kiriting.",
        }
    return {
        **result,
        "accepted_count": len(result["preview"]),
        "requires_confirmation": True,
        "note": "Hujjatdan olingan yozuvlar import qilinmadi. Tekshirib, alohida tasdiqlang.",
    }


@router.post("/documents/import", status_code=status.HTTP_201_CREATED)
def import_confirmed_transactions(
    payload: ImportCommit,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    objects = [
        Transaction(
            user_id=user.id,
            type=TransactionType(item.type),
            amount=item.amount,
            category=item.category.strip(),
            description=item.description,
            date=item.date or datetime.now(timezone.utc),
        )
        for item in payload.transactions
    ]
    db.add_all(objects)
    db.commit()
    return {"imported_count": len(objects)}


@router.get("/memory")
def get_memory(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    entries = []
    if user.memory_enabled:
        entries = (
            db.query(FinancialMemory)
            .filter(FinancialMemory.user_id == user.id)
            .order_by(FinancialMemory.created_at.desc())
            .limit(100)
            .all()
        )
    return {
        "enabled": bool(user.memory_enabled),
        "memories": [
            {"id": item.id, "content": item.content, "created_at": item.created_at.isoformat() if item.created_at else None}
            for item in entries
        ],
    }


@router.put("/memory")
def set_memory_preference(
    payload: MemoryPreference,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    user.memory_enabled = payload.enabled
    if not payload.enabled:
        db.query(FinancialMemory).filter(FinancialMemory.user_id == user.id).delete()
    db.commit()
    return {"enabled": bool(user.memory_enabled), "memories": []}


@router.post("/memory", status_code=status.HTTP_201_CREATED)
def create_memory(
    payload: MemoryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if not user.memory_enabled:
        raise HTTPException(status_code=403, detail="Avval sozlamalarda Financial Memory'ni yoqing")
    entry = FinancialMemory(user_id=user.id, content=payload.content.strip())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "content": entry.content}


@router.delete("/memory", status_code=status.HTTP_204_NO_CONTENT)
def clear_memory(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    db.query(FinancialMemory).filter(FinancialMemory.user_id == user.id).delete()
    db.commit()
