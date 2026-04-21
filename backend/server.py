from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from ai import build_ai_router
from email_utils import send_email, password_reset_html


# ============ CONFIG ============
mongo_url = os.environ['MONGO_URL']
db_name = os.environ['DB_NAME']
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')

# Brute force config
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============ HELPERS ============
def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email,
               "exp": datetime.now(timezone.utc) + timedelta(hours=12), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none",
                        max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none",
                        max_age=604800, path="/")


def clean_user(u: dict) -> dict:
    if not u:
        return u
    u.pop("_id", None)
    u.pop("password_hash", None)
    return u


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_role(*roles):
    async def _check(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return _check


# ============ BRUTE FORCE HELPERS ============
async def is_locked_out(identifier: str) -> bool:
    rec = await db.login_attempts.find_one({"identifier": identifier})
    if not rec:
        return False
    if rec.get("locked_until"):
        until = datetime.fromisoformat(rec["locked_until"])
        return datetime.now(timezone.utc) < until
    return False


async def record_failure(identifier: str):
    rec = await db.login_attempts.find_one({"identifier": identifier})
    count = (rec.get("count", 0) if rec else 0) + 1
    update = {"identifier": identifier, "count": count, "last_at": now_utc()}
    if count >= MAX_LOGIN_ATTEMPTS:
        update["locked_until"] = (datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
    await db.login_attempts.update_one({"identifier": identifier}, {"$set": update}, upsert=True)


async def clear_failures(identifier: str):
    await db.login_attempts.delete_one({"identifier": identifier})


# ============ MODELS ============
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Literal["admin", "manager", "dri", "contributor"] = "contributor"


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class FocusCycleCreate(BaseModel):
    name: str
    start_date: str
    end_date: str


class FocusCycleUpdate(BaseModel):
    status: Literal["active", "closed"]


class ObjectiveCreate(BaseModel):
    cycle_id: str
    title: str
    description: str
    dri_id: str
    success_metric: str
    current_value: str = ""
    target_value: str = ""
    contributor_ids: List[str] = []
    rigor_questions: List[str] = []


class ObjectiveUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    dri_id: Optional[str] = None
    success_metric: Optional[str] = None
    current_value: Optional[str] = None
    target_value: Optional[str] = None
    contributor_ids: Optional[List[str]] = None
    rigor_questions: Optional[List[str]] = None


class IndividualPlanPayload(BaseModel):
    objective_id: str
    mission_context: str = ""
    role_in_objective: str = ""
    ownership_metric: str = ""
    metric_current: str = ""
    metric_target: str = ""
    goals: List[str] = []
    key_bets: str = ""
    risks: str = ""
    kill_list: str = ""


class WeeklyUpdatePayload(BaseModel):
    objective_id: str
    week: str  # e.g. "2026-W06"
    status: Literal["green", "yellow", "red"]
    update_text: str
    blockers: str = ""
    progress: str = ""
    priority_shift: str = ""


class IndividualReflectionPayload(BaseModel):
    objective_id: str
    goal_outcomes: str = ""
    contribution_to_objective: str = ""
    what_moved_metric: str = ""
    wins: str = ""
    failures: str = ""
    learnings: str = ""
    support_needed: str = ""
    bottlenecks: str = ""
    trajectory_change: str = ""
    ceo_question_response: str = ""
    rigor_answers: dict = {}  # question -> answer


class DRIReflectionPayload(BaseModel):
    objective_id: str
    objective_outcome: Literal["achieved", "partial", "not_achieved"]
    actual_metrics: str = ""
    what_worked: str = ""
    what_failed: str = ""
    alignment_quality: str = ""
    execution_quality: str = ""
    major_blockers: str = ""
    what_should_change: str = ""
    ceo_question_response: str = ""


ENUM_OPTIONS = ["excellent", "good", "okay", "poor"]


class DRIFeedbackPayload(BaseModel):
    objective_id: str
    clarity: Literal["excellent", "good", "okay", "poor"]
    alignment: Literal["excellent", "good", "okay", "poor"]
    unblocking: Literal["excellent", "good", "okay", "poor"]
    decision_making: Literal["excellent", "good", "okay", "poor"]
    quality_bar: Literal["excellent", "good", "okay", "poor"]
    trajectory_impact: Literal["excellent", "good", "okay", "poor"]
    clarity_example: str = ""
    alignment_example: str = ""
    unblocking_example: str = ""
    decision_example: str = ""
    quality_example: str = ""
    trajectory_example: str = ""
    what_worked: str = ""
    what_should_improve: str = ""


class ManagerReviewPayload(BaseModel):
    subject_type: Literal["individual", "objective"]  # reviewing a person or an objective/DRI
    subject_id: str  # user_id or objective_id
    cycle_id: str
    final_evaluation: str = ""
    optional_score: Optional[int] = None  # 1-5
    disagreement_note_vs_ai: str = ""


# ============ APP ============
app = FastAPI(title="Nosh Focus Cycles API")
api = APIRouter(prefix="/api")


# ---------- AUTH ----------
@api.post("/auth/register")
async def register(payload: UserRegister, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": payload.role,
        "created_at": now_utc(),
    }
    await db.users.insert_one(doc)
    access = create_access_token(user_id, email)
    refresh = create_refresh_token(user_id)
    set_auth_cookies(response, access, refresh)
    return clean_user({**doc})


@api.post("/auth/login")
async def login(payload: UserLogin, request: Request, response: Response):
    email = payload.email.lower()
    xff = (request.headers.get('x-forwarded-for') or '').split(',')[0].strip()
    ip = xff or (request.client.host if request.client else "unknown")
    identifier = f"{ip}:{email}"
    if await is_locked_out(identifier):
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {LOCKOUT_MINUTES} minutes.")
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        await record_failure(identifier)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    await clear_failures(identifier)
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return clean_user({**user})


class ForgotPasswordPayload(BaseModel):
    email: EmailStr


class ResetPasswordPayload(BaseModel):
    token: str
    new_password: str


@api.post("/auth/forgot-password")
async def forgot_password(payload: ForgotPasswordPayload):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    # Always respond 200 (don't leak email existence)
    if user:
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        await db.password_reset_tokens.insert_one({
            "id": str(uuid.uuid4()),
            "token": token,
            "user_id": user["id"],
            "expires_at": expires_at,
            "used": False,
            "created_at": now_utc(),
        })
        reset_link = f"{FRONTEND_URL}/reset-password?token={token}"
        html = password_reset_html(user.get("name", ""), reset_link)
        result = await send_email(email, "Reset your Nosh password", html)
        logger.info(f"[PASSWORD_RESET] email={email} link={reset_link} sent={result.get('sent')}")
    return {"ok": True, "message": "If an account exists, a reset link has been sent."}


@api.post("/auth/reset-password")
async def reset_password(payload: ResetPasswordPayload):
    rec = await db.password_reset_tokens.find_one({"token": payload.token})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="Invalid or used token")
    if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Token expired")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password too short (min 6)")
    await db.users.update_one({"id": rec["user_id"]},
                              {"$set": {"password_hash": hash_password(payload.new_password)}})
    await db.password_reset_tokens.update_one({"id": rec["id"]}, {"$set": {"used": True}})
    return {"ok": True}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        access = create_access_token(user["id"], user["email"])
        response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none",
                            max_age=43200, path="/")
        return {"ok": True}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


# ---------- USERS ----------
@api.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    projection = {"_id": 0, "password_hash": 0}
    users = await db.users.find({}, projection).to_list(500)
    if user["role"] not in ("admin", "manager"):
        users = [{"id": u["id"], "name": u["name"], "role": u["role"]} for u in users]
    return users


@api.post("/users")
async def create_user(payload: UserRegister, _: dict = Depends(require_role("admin"))):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": payload.role,
        "created_at": now_utc(),
    }
    await db.users.insert_one(doc)
    return clean_user({**doc})


# ---------- FOCUS CYCLES ----------
@api.get("/cycles")
async def list_cycles(_: dict = Depends(get_current_user)):
    return await db.cycles.find({}, {"_id": 0}).sort("start_date", -1).to_list(200)


@api.post("/cycles")
async def create_cycle(payload: FocusCycleCreate, _: dict = Depends(require_role("admin"))):
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "status": "active",
        "created_at": now_utc(),
    }
    await db.cycles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/cycles/{cycle_id}")
async def update_cycle(cycle_id: str, payload: FocusCycleUpdate, _: dict = Depends(require_role("admin"))):
    await db.cycles.update_one({"id": cycle_id}, {"$set": {"status": payload.status}})
    c = await db.cycles.find_one({"id": cycle_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return c


# ---------- OBJECTIVES ----------
@api.get("/objectives")
async def list_objectives(cycle_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if cycle_id:
        q["cycle_id"] = cycle_id
    objs = await db.objectives.find(q, {"_id": 0}).to_list(500)
    return objs


@api.get("/objectives/{objective_id}")
async def get_objective(objective_id: str, _: dict = Depends(get_current_user)):
    obj = await db.objectives.find_one({"id": objective_id}, {"_id": 0})
    if not obj:
        raise HTTPException(status_code=404, detail="Objective not found")
    return obj


@api.post("/objectives")
async def create_objective(payload: ObjectiveCreate, _: dict = Depends(require_role("admin"))):
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_utc()
    await db.objectives.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/objectives/{objective_id}")
async def update_objective(objective_id: str, payload: ObjectiveUpdate, user: dict = Depends(get_current_user)):
    obj = await db.objectives.find_one({"id": objective_id})
    if not obj:
        raise HTTPException(status_code=404, detail="Objective not found")
    if user["role"] != "admin" and obj.get("dri_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.objectives.update_one({"id": objective_id}, {"$set": updates})
    return await db.objectives.find_one({"id": objective_id}, {"_id": 0})


# ---------- INDIVIDUAL PLANS ----------
@api.get("/plans")
async def list_plans(objective_id: Optional[str] = None, user_id: Optional[str] = None,
                     user: dict = Depends(get_current_user)):
    q = {}
    if objective_id:
        q["objective_id"] = objective_id
    if user_id:
        q["user_id"] = user_id
    # Contributors see only their own unless manager/admin
    if user["role"] not in ("admin", "manager"):
        q["user_id"] = user["id"]
    return await db.plans.find(q, {"_id": 0}).to_list(500)


@api.post("/plans")
async def upsert_plan(payload: IndividualPlanPayload, user: dict = Depends(get_current_user)):
    doc = payload.model_dump()
    doc["user_id"] = user["id"]
    doc["updated_at"] = now_utc()
    existing = await db.plans.find_one({"user_id": user["id"], "objective_id": payload.objective_id})
    if existing:
        await db.plans.update_one({"id": existing["id"]}, {"$set": doc})
        return await db.plans.find_one({"id": existing["id"]}, {"_id": 0})
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_utc()
    await db.plans.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- WEEKLY UPDATES ----------
@api.get("/updates")
async def list_updates(objective_id: Optional[str] = None, user_id: Optional[str] = None,
                       user: dict = Depends(get_current_user)):
    q = {}
    if objective_id:
        q["objective_id"] = objective_id
    if user_id:
        q["user_id"] = user_id
    if user["role"] not in ("admin", "manager") and not user_id:
        q["user_id"] = user["id"]
    return await db.updates.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api.post("/updates")
async def create_update(payload: WeeklyUpdatePayload, user: dict = Depends(get_current_user)):
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["id"]
    doc["created_at"] = now_utc()
    await db.updates.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- REFLECTIONS ----------
@api.get("/reflections/individual")
async def list_individual_reflections(objective_id: Optional[str] = None, user_id: Optional[str] = None,
                                      user: dict = Depends(get_current_user)):
    q = {}
    if objective_id:
        q["objective_id"] = objective_id
    if user_id:
        q["user_id"] = user_id
    if user["role"] not in ("admin", "manager") and not user_id:
        q["user_id"] = user["id"]
    return await db.individual_reflections.find(q, {"_id": 0}).to_list(500)


@api.post("/reflections/individual")
async def upsert_individual_reflection(payload: IndividualReflectionPayload, user: dict = Depends(get_current_user)):
    doc = payload.model_dump()
    doc["user_id"] = user["id"]
    doc["updated_at"] = now_utc()
    existing = await db.individual_reflections.find_one(
        {"user_id": user["id"], "objective_id": payload.objective_id})
    if existing:
        await db.individual_reflections.update_one({"id": existing["id"]}, {"$set": doc})
        return await db.individual_reflections.find_one({"id": existing["id"]}, {"_id": 0})
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_utc()
    await db.individual_reflections.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/reflections/dri")
async def list_dri_reflections(objective_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if objective_id:
        q["objective_id"] = objective_id
    return await db.dri_reflections.find(q, {"_id": 0}).to_list(500)


@api.post("/reflections/dri")
async def upsert_dri_reflection(payload: DRIReflectionPayload, user: dict = Depends(get_current_user)):
    obj = await db.objectives.find_one({"id": payload.objective_id})
    if not obj:
        raise HTTPException(status_code=404, detail="Objective not found")
    if obj.get("dri_id") != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only the DRI can submit")
    doc = payload.model_dump()
    doc["user_id"] = user["id"]
    doc["updated_at"] = now_utc()
    existing = await db.dri_reflections.find_one(
        {"user_id": user["id"], "objective_id": payload.objective_id})
    if existing:
        await db.dri_reflections.update_one({"id": existing["id"]}, {"$set": doc})
        return await db.dri_reflections.find_one({"id": existing["id"]}, {"_id": 0})
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_utc()
    await db.dri_reflections.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- DRI FEEDBACK ----------
@api.get("/feedback")
async def list_feedback(objective_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    # raw feedback: manager/admin only; contributors see only their own submissions
    q = {}
    if objective_id:
        q["objective_id"] = objective_id
    items = await db.feedback.find(q, {"_id": 0}).to_list(1000)
    if user["role"] not in ("admin", "manager"):
        items = [f for f in items if f.get("user_id") == user["id"]]
    return items


@api.get("/feedback/summary")
async def feedback_summary(objective_id: str, user: dict = Depends(get_current_user)):
    items = await db.feedback.find({"objective_id": objective_id}, {"_id": 0}).to_list(1000)
    dims = ["clarity", "alignment", "unblocking", "decision_making", "quality_bar", "trajectory_impact"]
    score_map = {"excellent": 4, "good": 3, "okay": 2, "poor": 1}
    summary = {"count": len(items), "dimensions": {}}
    for d in dims:
        vals = [score_map.get(i.get(d), 0) for i in items if i.get(d)]
        summary["dimensions"][d] = {
            "avg": round(sum(vals) / len(vals), 2) if vals else 0,
            "distribution": {opt: sum(1 for i in items if i.get(d) == opt) for opt in ENUM_OPTIONS},
        }
    return summary


@api.get("/feedback/my-dri-view")
async def feedback_dri_self_view(user: dict = Depends(get_current_user)):
    """Aggregated view of feedback for the calling user's DRI'd objectives.
    Returns dimension averages + anonymized qualitative quotes. Safe for DRIs."""
    objectives = await db.objectives.find({"dri_id": user["id"]}, {"_id": 0}).to_list(200)
    dims = ["clarity", "alignment", "unblocking", "decision_making", "quality_bar", "trajectory_impact"]
    score_map = {"excellent": 4, "good": 3, "okay": 2, "poor": 1}
    out = []
    for obj in objectives:
        items = await db.feedback.find({"objective_id": obj["id"]},
                                       {"_id": 0, "user_id": 0}).to_list(500)
        dim_stats = {}
        for d in dims:
            vals = [score_map.get(i.get(d), 0) for i in items if i.get(d)]
            dim_stats[d] = {
                "avg": round(sum(vals) / len(vals), 2) if vals else 0,
                "distribution": {opt: sum(1 for i in items if i.get(d) == opt) for opt in ENUM_OPTIONS},
            }
        quotes_worked = [i["what_worked"] for i in items if i.get("what_worked")]
        quotes_improve = [i["what_should_improve"] for i in items if i.get("what_should_improve")]
        out.append({
            "objective": {k: obj.get(k) for k in ["id", "title", "description",
                                                   "success_metric", "current_value", "target_value"]},
            "count": len(items),
            "dimensions": dim_stats,
            "what_worked": quotes_worked,
            "what_should_improve": quotes_improve,
        })
    return out


@api.post("/feedback")
async def submit_feedback(payload: DRIFeedbackPayload, user: dict = Depends(get_current_user)):
    obj = await db.objectives.find_one({"id": payload.objective_id})
    if not obj:
        raise HTTPException(status_code=404, detail="Objective not found")
    if user["id"] == obj.get("dri_id"):
        raise HTTPException(status_code=400, detail="DRI cannot rate themselves")
    if user["id"] not in obj.get("contributor_ids", []) and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only contributors can submit feedback")
    doc = payload.model_dump()
    doc["user_id"] = user["id"]
    doc["updated_at"] = now_utc()
    existing = await db.feedback.find_one(
        {"user_id": user["id"], "objective_id": payload.objective_id})
    if existing:
        await db.feedback.update_one({"id": existing["id"]}, {"$set": doc})
        return await db.feedback.find_one({"id": existing["id"]}, {"_id": 0})
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_utc()
    await db.feedback.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- MANAGER REVIEW ----------
@api.get("/manager-review")
async def list_manager_review(subject_id: Optional[str] = None,
                              _: dict = Depends(require_role("admin", "manager"))):
    q = {}
    if subject_id:
        q["subject_id"] = subject_id
    return await db.manager_reviews.find(q, {"_id": 0}).to_list(500)


@api.post("/manager-review")
async def upsert_manager_review(payload: ManagerReviewPayload,
                                user: dict = Depends(require_role("admin", "manager"))):
    doc = payload.model_dump()
    doc["manager_id"] = user["id"]
    doc["updated_at"] = now_utc()
    existing = await db.manager_reviews.find_one({
        "manager_id": user["id"], "subject_id": payload.subject_id, "subject_type": payload.subject_type,
        "cycle_id": payload.cycle_id,
    })
    if existing:
        await db.manager_reviews.update_one({"id": existing["id"]}, {"$set": doc})
        return await db.manager_reviews.find_one({"id": existing["id"]}, {"_id": 0})
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_utc()
    await db.manager_reviews.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- HEALTH ----------
@api.get("/")
async def root():
    return {"service": "nosh-focus-cycles", "status": "ok"}


# ============ SEED ============
async def seed_if_empty():
    # ensure admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@noshrobotics.co")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": now_utc(),
        })
        logger.info("Admin seeded")

    # demo users (idempotent)
    demo = [
        ("manager@noshrobotics.co", "password123", "Morgan Lee", "manager"),
        ("dri@noshrobotics.co", "password123", "Dana Rao", "dri"),
        ("alice@noshrobotics.co", "password123", "Alice Chen", "contributor"),
        ("bob@noshrobotics.co", "password123", "Bob Singh", "contributor"),
    ]
    user_ids = {}
    for email, pw, name, role in demo:
        u = await db.users.find_one({"email": email})
        if not u:
            uid = str(uuid.uuid4())
            await db.users.insert_one({
                "id": uid, "email": email, "password_hash": hash_password(pw),
                "name": name, "role": role, "created_at": now_utc(),
            })
            user_ids[email] = uid
        else:
            user_ids[email] = u["id"]

    # demo cycle + objectives
    if await db.cycles.count_documents({}) == 0:
        cycle_id = str(uuid.uuid4())
        await db.cycles.insert_one({
            "id": cycle_id,
            "name": "Q1 2026 — Growth",
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "status": "active",
            "created_at": now_utc(),
        })
        dri_id = user_ids["dri@noshrobotics.co"]
        alice = user_ids["alice@noshrobotics.co"]
        bob = user_ids["bob@noshrobotics.co"]

        obj1_id = str(uuid.uuid4())
        await db.objectives.insert_one({
            "id": obj1_id,
            "cycle_id": cycle_id,
            "title": "Ship self-serve onboarding v2",
            "description": "Reduce time-to-first-value and lift activation rate for new workspaces.",
            "dri_id": dri_id,
            "success_metric": "Activation rate (D7)",
            "current_value": "34%",
            "target_value": "55%",
            "contributor_ids": [alice, bob],
            "rigor_questions": [
                "What would you do differently if you had to ship this in half the time?",
                "Which assumption is most likely to be wrong?",
            ],
            "created_at": now_utc(),
        })

        obj2_id = str(uuid.uuid4())
        await db.objectives.insert_one({
            "id": obj2_id,
            "cycle_id": cycle_id,
            "title": "Lift retention in the first 30 days",
            "description": "Drive repeat usage via messaging, habit loops, and feature discovery.",
            "dri_id": dri_id,
            "success_metric": "D30 retention",
            "current_value": "18%",
            "target_value": "28%",
            "contributor_ids": [alice],
            "rigor_questions": [
                "What is the single highest-leverage lever you believe in?",
            ],
            "created_at": now_utc(),
        })

        # a plan + weekly update for Alice
        await db.plans.insert_one({
            "id": str(uuid.uuid4()), "user_id": alice, "objective_id": obj1_id,
            "mission_context": "Own activation telemetry and experiment ingestion.",
            "role_in_objective": "Contributor — experiments and analytics",
            "ownership_metric": "Experiment velocity",
            "metric_current": "2/week", "metric_target": "5/week",
            "goals": ["Instrument activation funnel", "Ship 3 growth experiments", "Document playbook"],
            "key_bets": "Funnel clarity unlocks experiment throughput",
            "risks": "Data pipeline latency", "kill_list": "Legacy UTM reports",
            "created_at": now_utc(), "updated_at": now_utc(),
        })
        await db.updates.insert_one({
            "id": str(uuid.uuid4()), "user_id": alice, "objective_id": obj1_id,
            "week": "2026-W05", "status": "yellow",
            "update_text": "Funnel instrumentation 70% done. Waiting on backend events spec. Two experiments queued.",
            "blockers": "Backend events spec", "progress": "70%", "priority_shift": "",
            "created_at": now_utc(),
        })
        logger.info("Demo data seeded")


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.cycles.create_index("id", unique=True)
    await db.objectives.create_index("id", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.password_reset_tokens.create_index("token")
    await seed_if_empty()


@app.on_event("shutdown")
async def shutdown():
    client.close()


# ============ CORS + INCLUDE ============
api.include_router(build_ai_router(db, require_role, get_current_user, now_utc))
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
