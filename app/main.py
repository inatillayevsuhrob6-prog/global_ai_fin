import logging

from fastapi import FastAPI, HTTPException, Request, status
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine, get_db
from app.models.user import User
from app.models.financial_memory import FinancialMemory
from app.api.auth import router as auth_router
from app.api.finance import router as finance_router
from app.api.premium import router as premium_router
from app.core.security import decode_access_token
from app.schemas.finance import ChatMessage
from groq import (
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    Groq,
    RateLimitError,
)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    debug=settings.DEBUG
)

# Include routers
app.include_router(auth_router)
app.include_router(finance_router)
app.include_router(premium_router)
logger = logging.getLogger(__name__)
optional_oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/auth/login",
    auto_error=False,
)

# Initialize Groq Client
try:
    groq_client = Groq(api_key=settings.GROQ_API_KEY)
except Exception as e:
    print(f"Warning: Could not initialize Groq client: {e}")
    groq_client = None

# Static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Templates
templates = Jinja2Templates(directory="app/templates")

@app.on_event("startup")
def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)

def get_user_count():
    db = SessionLocal()
    try:
        return db.query(User).count()
    finally:
        db.close()

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    user_count = get_user_count()
    return templates.TemplateResponse("landing.html", {
        "request": request,
        "title": "Bosh Sahifa",
        "user_count": user_count
    })

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "title": "Kirish"})

@app.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    return templates.TemplateResponse("register.html", {"request": request, "title": "Ro'yxatdan o'tish"})

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request):
    # Note: Real auth check happens in JS via /api/auth/me
    # This just renders the template
    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "title": "Dashboard"
    })

@app.get("/api/stats")
async def get_stats():
    return {"users": get_user_count(), "support": "24/7"}

@app.post("/api/chat")
async def chat_with_ai(
    data: ChatMessage,
    token: str | None = Depends(optional_oauth2_scheme),
    db: Session = Depends(get_db),
):
    message = data.message.strip()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Savolingizni yozing.",
        )
    if not groq_client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI xizmati hozircha sozlanmagan.",
        )
    
    memory_context = ""
    if token:
        username = decode_access_token(token)
        if username:
            user = db.query(User).filter(User.username == username, User.is_active.is_(True)).first()
            if user and user.memory_enabled:
                memories = (
                    db.query(FinancialMemory)
                    .filter(FinancialMemory.user_id == user.id)
                    .order_by(FinancialMemory.created_at.desc())
                    .limit(20)
                    .all()
                )
                if memories:
                    memory_context = "\nFoydalanuvchi ruxsat bergan moliyaviy xotiralar:\n" + "\n".join(
                        f"- {memory.content}" for memory in memories
                    )
    system_prompt = (
        "Siz Global AI Fin-Assistant botsiz. Siz foydalanuvchiga FAQAT o'zbek tilida javob berishingiz kerak. "
        "Sizning vazifangiz moliyaviy maslahat berish, byudjet tuzishga yordam berish va xarajatlarni tahlil qilishdir. "
        "Javoblaringiz qisqa, aniq, foydali va do'stona bo'lsin."
        f"{memory_context}"
    )
    
    try:
        completion = groq_client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ],
            temperature=0.7,
            max_tokens=500,
        )
        return {"response": completion.choices[0].message.content}
    except AuthenticationError:
        logger.exception("AI chat authentication failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI API kaliti yaroqsiz yoki ruxsati yo'q. GROQ_API_KEY sozlamasini tekshiring.",
        )
    except RateLimitError:
        logger.exception("AI chat rate limit reached")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI xizmati so'rovlar limiti tugagan. Birozdan keyin qayta urinib ko'ring.",
        )
    except APIConnectionError:
        logger.exception("AI chat connection failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI xizmatiga ulanib bo'lmadi. Internet yoki AI xizmati holatini tekshirib qayta urinib ko'ring.",
        )
    except APIStatusError as error:
        logger.exception("AI chat provider rejected request")
        if error.status_code == status.HTTP_404_NOT_FOUND:
            detail = "AI modeli topilmadi. GROQ_MODEL sozlamasini tekshiring."
        else:
            detail = "AI xizmati so'rovni qabul qilmadi. API sozlamalarini tekshiring."
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        )
    except Exception:
        logger.exception("AI chat request failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI javobini olishda xatolik yuz berdi. Qayta urinib ko'ring.",
        )

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
