from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import json
import bcrypt
import jwt
import secrets
import boto3
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal
from botocore.exceptions import ClientError, NoCredentialsError

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from ai import build_ai_router
from email_utils import send_email, password_reset_html
from notifications import notify_objective_created, notify_objective_updated, notify_goals_assigned


# ============ CONFIG ============
mongo_url = os.environ['MONGO_URL']
db_name = os.environ['DB_NAME']
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')
CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "CORS_ORIGINS",
    f"{FRONTEND_URL},http://localhost:3000"
).split(",") if o.strip()]
COGNITO_ENABLED = os.environ.get("COGNITO_ENABLED", "false").lower() == "true"
COGNITO_REGION = os.environ.get("COGNITO_REGION", "")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")
COGNITO_ROLE_ATTRIBUTE = os.environ.get("COGNITO_ROLE_ATTRIBUTE", "custom:role")
DEFAULT_ROLE_GROUP_MAP = {
    "admin": "admin",
    "manager": "manager",
    "dri": "dri",
    "contributor": "contributor",
}
try:
    COGNITO_GROUP_ROLE_MAP = json.loads(os.environ.get("COGNITO_GROUP_ROLE_MAP", json.dumps(DEFAULT_ROLE_GROUP_MAP)))
except json.JSONDecodeError:
    COGNITO_GROUP_ROLE_MAP = DEFAULT_ROLE_GROUP_MAP
SUPPORTED_ROLES = {"admin", "manager", "dri", "contributor"}
ROLE_PRIORITY = ["admin", "manager", "dri", "contributor"]

# Brute force config (set MAX_LOGIN_ATTEMPTS=0 in .env to disable the lockout entirely)
MAX_LOGIN_ATTEMPTS = int(os.environ.get('MAX_LOGIN_ATTEMPTS', '0'))
LOCKOUT_MINUTES = int(os.environ.get('LOCKOUT_MINUTES', '15'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
cognito_client = boto3.client("cognito-idp", region_name=COGNITO_REGION) if COGNITO_ENABLED else None


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
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="lax",
                        max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="lax",
                        max_age=604800, path="/")


def clean_user(u: dict) -> dict:
    if not u:
        return u
    u.pop("_id", None)
    u.pop("password_hash", None)
    return u


def normalize_role(role: Optional[str]) -> Optional[str]:
    if not role:
        return None
    normalized = role.strip().lower()
    return normalized if normalized in SUPPORTED_ROLES else None


def derive_role_from_cognito(attrs: dict, groups: List[str]) -> Optional[str]:
    attr_role = normalize_role(attrs.get(COGNITO_ROLE_ATTRIBUTE) or attrs.get("role"))
    if attr_role:
        return attr_role

    mapped_roles = []
    group_map = {k.lower(): v for k, v in COGNITO_GROUP_ROLE_MAP.items()}
    for group in groups:
        mapped = normalize_role(group_map.get(group.lower()))
        if mapped:
            mapped_roles.append(mapped)
    if not mapped_roles:
        return None
    mapped_roles.sort(key=lambda r: ROLE_PRIORITY.index(r))
    return mapped_roles[0]


def decode_unverified_claims(token: str) -> dict:
    if not token:
        return {}
    try:
        return jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
    except jwt.InvalidTokenError:
        return {}


def extract_groups_from_claims(claims: dict) -> List[str]:
    groups = claims.get("cognito:groups") or []
    if isinstance(groups, list):
        return [str(g) for g in groups]
    if isinstance(groups, str):
        return [groups]
    return []


def extract_cognito_username(claims: dict, attrs: dict, fallback_email: str) -> str:
    return (
        claims.get("cognito:username")
        or attrs.get("preferred_username")
        or attrs.get("email")
        or fallback_email
    )


def merge_user_doc(existing: Optional[dict], email: str, name: str, role: Optional[str]) -> dict:
    doc = existing.copy() if existing else {
        "id": str(uuid.uuid4()),
        "email": email,
        "created_at": now_utc(),
    }
    doc["name"] = name or doc.get("name") or email.split("@")[0]
    if role:
        doc["role"] = role
    elif not doc.get("role"):
        doc["role"] = "contributor"
    return doc


async def fetch_cognito_groups(username: str) -> List[str]:
    if not username or not COGNITO_USER_POOL_ID:
        return []
    try:
        resp = cognito_client.admin_list_groups_for_user(
            Username=username,
            UserPoolId=COGNITO_USER_POOL_ID,
        )
        return [g.get("GroupName") for g in resp.get("Groups", []) if g.get("GroupName")]
    except NoCredentialsError:
        logger.warning("Skipping Cognito group lookup: AWS credentials not configured")
        return []
    except ClientError as exc:
        logger.warning("Unable to list Cognito groups for %s: %s", username, exc)
        return []


async def upsert_user_from_cognito(
    *,
    email: str,
    name: str,
    attrs: dict,
    groups: List[str],
) -> dict:
    existing = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    cognito_role = derive_role_from_cognito(attrs, groups)
    if existing and existing.get("role"):
        role = existing.get("role")
    else:
        role = cognito_role
    merged = merge_user_doc(existing, email=email, name=name, role=role)
    await db.users.update_one({"email": email}, {"$set": merged}, upsert=True)
    return clean_user(merged)


async def get_current_user(request: Request) -> dict:
    cookie_token = request.cookies.get("access_token")
    auth_header = request.headers.get("Authorization", "")
    bearer_token = auth_header[7:] if auth_header.startswith("Bearer ") else None

    # 1) Try existing app JWT flow first (cookie or bearer).
    token = cookie_token or bearer_token
    if token:
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
            # fall through to Cognito bearer validation when enabled
            pass

    # 2) Cognito token validation (bearer only) for migration path.
    if COGNITO_ENABLED and bearer_token:
        try:
            resp = cognito_client.get_user(AccessToken=bearer_token)
            attrs = {a["Name"]: a["Value"] for a in resp.get("UserAttributes", [])}
            email = attrs.get("email", "").lower()
            if not email:
                raise HTTPException(status_code=401, detail="Invalid Cognito token: email missing")
            claims = decode_unverified_claims(bearer_token)
            groups = extract_groups_from_claims(claims)
            username = extract_cognito_username(claims, attrs, email)
            if not groups:
                groups = await fetch_cognito_groups(username)
            user = await upsert_user_from_cognito(
                email=email,
                name=attrs.get("name", email.split("@")[0]),
                attrs=attrs,
                groups=groups,
            )
            return user
        except ClientError:
            raise HTTPException(status_code=401, detail="Invalid Cognito token")

    raise HTTPException(status_code=401, detail="Not authenticated")


async def authenticate_with_cognito(email: str, password: str) -> dict:
    if not COGNITO_ENABLED or not cognito_client or not COGNITO_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Cognito auth is not configured")
    try:
        auth_response = cognito_client.initiate_auth(
            ClientId=COGNITO_CLIENT_ID,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": email, "PASSWORD": password},
        )
        result = auth_response.get("AuthenticationResult", {})
        access_token = result.get("AccessToken")
        id_token = result.get("IdToken")
        if not access_token:
            raise HTTPException(status_code=401, detail="Cognito login failed")
        user_response = cognito_client.get_user(AccessToken=access_token)
        attrs = {a["Name"]: a["Value"] for a in user_response.get("UserAttributes", [])}
        claims = decode_unverified_claims(id_token)
        groups = extract_groups_from_claims(claims)
        username = extract_cognito_username(claims, attrs, email)
        if not groups:
            groups = await fetch_cognito_groups(username)
        return {
            "email": attrs.get("email", email).lower(),
            "name": attrs.get("name", email.split("@")[0]),
            "attrs": attrs,
            "groups": groups,
        }
    except ClientError as exc:
        logger.warning("Cognito auth failed for %s: %s", email, exc)
        raise HTTPException(status_code=401, detail="Invalid credentials")


def require_role(*roles):
    async def _check(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return _check


# ============ HIERARCHY ============
async def can_manage(current: dict, target_id: str) -> bool:
    """Admin can manage anyone. Self always. Otherwise walk the target's manager chain."""
    if current.get("role") in ("admin", "manager"):
        return True
    if current["id"] == target_id:
        return True
    visited = set()
    cur = await db.users.find_one({"id": target_id}, {"_id": 0, "password_hash": 0})
    while cur and cur["id"] not in visited:
        visited.add(cur["id"])
        mgr_id = cur.get("manager_id")
        if not mgr_id:
            return False
        if mgr_id == current["id"]:
            return True
        cur = await db.users.find_one({"id": mgr_id}, {"_id": 0, "password_hash": 0})
    return False


async def manageable_ids(current: dict) -> set:
    """All user ids the current user can act on."""
    all_users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    if current.get("role") in ("admin", "manager"):
        return {u["id"] for u in all_users}
    result = {current["id"]}
    # BFS downward from current using manager_id edges
    queue = [current["id"]]
    by_mgr = {}
    for u in all_users:
        by_mgr.setdefault(u.get("manager_id"), []).append(u["id"])
    while queue:
        mgr = queue.pop()
        for uid in by_mgr.get(mgr, []):
            if uid not in result:
                result.add(uid)
                queue.append(uid)
    return result


async def dri_reportee_ids(dri_id: str) -> set:
    """Direct reportees of a DRI (users whose manager_id is the DRI)."""
    reportees = await db.users.find({"manager_id": dri_id}, {"_id": 0, "id": 1}).to_list(500)
    return {u["id"] for u in reportees}


async def validate_contributors_for_dri(dri_id: str, contributor_ids: List[str]):
    if not contributor_ids:
        return
    reportees = await dri_reportee_ids(dri_id)
    invalid = [c for c in contributor_ids if c not in reportees]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail="All contributors must be direct reportees of the DRI",
        )


def plan_goal_completion_percent(plan: Optional[dict]) -> Optional[int]:
    if not plan:
        return None
    goals = plan.get("assigned_goals") or []
    if not goals:
        return None
    completed = sum(
        1 for g in goals
        if (isinstance(g, dict) and g.get("completed")) or False
    )
    return round(completed / len(goals) * 100)


async def compute_parent_rollup(parent_id: str) -> Optional[dict]:
    children = await db.objectives.find(
        {"parent_objective_id": parent_id}, {"_id": 0}
    ).to_list(100)
    if not children:
        return None
    child_rows = []
    for child in children:
        contribs = child.get("contributor_ids") or []
        if not contribs:
            continue
        uid = contribs[0]
        plan = await db.plans.find_one(
            {"objective_id": child["id"], "user_id": uid}, {"_id": 0}
        )
        pct = plan_goal_completion_percent(plan) if plan else 0
        child_rows.append({
            "objective_id": child["id"],
            "title": child.get("title", ""),
            "contributor_id": uid,
            "percent": pct if pct is not None else 0,
        })
    if not child_rows:
        return None
    avg = round(sum(r["percent"] for r in child_rows) / len(child_rows))
    return {"percent": avg, "children": child_rows}


async def sync_parent_rollup(parent_id: str):
    rollup = await compute_parent_rollup(parent_id)
    if not rollup:
        return
    await db.objectives.update_one(
        {"id": parent_id},
        {"$set": {
            "current_value": str(rollup["percent"]),
            "target_value": "100",
            "rollup_progress": rollup["percent"],
            "rollup_updated_at": now_utc(),
        }},
    )


async def validate_child_objective_create(payload: "ObjectiveCreate", user: dict):
    if not payload.parent_objective_id:
        return
    parent = await get_objective_or_404(payload.parent_objective_id)
    if parent.get("parent_objective_id"):
        raise HTTPException(status_code=400, detail="Parent must be a top-level objective")
    if len(payload.contributor_ids) != 1:
        raise HTTPException(
            status_code=400,
            detail="Team sub-objectives require exactly one contributor",
        )
    payload.dri_id = parent["dri_id"]
    payload.cycle_id = parent["cycle_id"]


async def enrich_objective(obj: dict) -> dict:
    enriched = dict(obj)
    children = await db.objectives.find(
        {"parent_objective_id": obj["id"]}, {"_id": 0}
    ).to_list(100)
    enriched["child_objectives"] = children
    if not obj.get("parent_objective_id"):
        rollup = await compute_parent_rollup(obj["id"])
        if rollup:
            enriched["rollup"] = rollup
            enriched["rollup_progress"] = rollup["percent"]
    if obj.get("parent_objective_id"):
        parent = await db.objectives.find_one(
            {"id": obj["parent_objective_id"]},
            {"_id": 0, "id": 1, "title": 1},
        )
        enriched["parent_objective"] = parent
    return enriched


def can_toggle_goal_completion(user: dict, obj: dict, member_user_id: str) -> bool:
    if member_user_id not in objective_member_ids(obj):
        return False
    if user["role"] in ("admin", "manager"):
        return True
    if member_user_id == user["id"]:
        return True
    if is_objective_dri(user, obj):
        return member_user_id in obj.get("contributor_ids", [])
    return False


async def can_toggle_goal_completion_async(user: dict, obj: dict, member_user_id: str) -> bool:
    if member_user_id not in objective_member_ids(obj):
        return False
    if user["role"] in ("admin", "manager"):
        return True
    if member_user_id == user["id"]:
        return True
    if await user_is_dri_for_objective(user, obj):
        return member_user_id in obj.get("contributor_ids", [])
    return False


async def get_objective_or_404(objective_id: str) -> dict:
    obj = await db.objectives.find_one({"id": objective_id}, {"_id": 0})
    if not obj:
        raise HTTPException(status_code=404, detail="Objective not found")
    return obj


def is_objective_dri(user: dict, obj: dict) -> bool:
    return obj.get("dri_id") == user.get("id")


async def user_is_dri_for_objective(user: dict, obj: dict) -> bool:
    """Match DRI by user id or email (handles Cognito vs DB id drift)."""
    if not obj:
        return False
    if obj.get("dri_id") == user.get("id"):
        return True
    dri_id = obj.get("dri_id")
    if not dri_id:
        return False
    dri = await db.users.find_one({"id": dri_id}, {"_id": 0, "email": 1})
    user_email = (user.get("email") or "").strip().lower()
    dri_email = (dri.get("email") or "").strip().lower() if dri else ""
    return bool(user_email and dri_email and user_email == dri_email)


def objective_member_ids(obj: dict) -> List[str]:
    return [obj["dri_id"]] + list(obj.get("contributor_ids") or [])


def can_set_rigor_questions(user: dict, obj: dict, target_user_id: str) -> bool:
    if target_user_id == obj.get("dri_id"):
        return False
    if target_user_id not in obj.get("contributor_ids", []):
        return False
    return is_objective_dri(user, obj)


async def can_set_assigned_goals(user: dict, obj: dict, target_user_id: str) -> bool:
    if target_user_id not in objective_member_ids(obj):
        return False
    if user["role"] in ("admin", "manager"):
        return True
    if await user_is_dri_for_objective(user, obj):
        if target_user_id == obj.get("dri_id"):
            return False
        return target_user_id in obj.get("contributor_ids", [])
    return False


async def can_set_rigor_questions_async(user: dict, obj: dict, target_user_id: str) -> bool:
    if target_user_id == obj.get("dri_id"):
        return False
    if target_user_id not in obj.get("contributor_ids", []):
        return False
    return await user_is_dri_for_objective(user, obj)


async def ensure_plan(target_user_id: str, objective_id: str) -> dict:
    existing = await db.plans.find_one({"user_id": target_user_id, "objective_id": objective_id})
    if existing:
        return existing
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": target_user_id,
        "objective_id": objective_id,
        "mission_context": "",
        "role_in_objective": "",
        "ownership_metric": "",
        "metric_current": "",
        "metric_target": "",
        "goals": [],
        "assigned_goals": [],
        "rigor_questions": [],
        "key_bets": "",
        "risks": "",
        "kill_list": "",
        "tasks": [],
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    await db.plans.insert_one(doc)
    return doc


def build_assigned_goals(texts: List[str], user: dict) -> List[dict]:
    role = user.get("role", "contributor")
    goals = []
    for t in texts:
        text = (t or "").strip()
        if not text:
            continue
        goals.append({
            "id": str(uuid.uuid4()),
            "text": text,
            "completed": False,
            "set_by": user["id"],
            "set_by_role": role,
            "created_at": now_utc(),
        })
        if len(goals) >= 3:
            break
    return goals


def merge_assigned_goals(texts: List[str], existing: List, user: dict) -> List[dict]:
    existing_goals = [g for g in (existing or []) if isinstance(g, dict)]
    by_text = {g.get("text", ""): g for g in existing_goals}
    merged = []
    for i, raw in enumerate(texts):
        text = (raw or "").strip()
        if not text:
            continue
        prev = by_text.get(text) or (existing_goals[i] if i < len(existing_goals) else None)
        if prev and prev.get("text") == text:
            merged.append({**prev, "text": text})
        else:
            merged.append({
                "id": str(uuid.uuid4()),
                "text": text,
                "completed": False,
                "set_by": user["id"],
                "set_by_role": user.get("role", "contributor"),
                "created_at": now_utc(),
            })
        if len(merged) >= 3:
            break
    return merged


# ============ BRUTE FORCE HELPERS ============
async def is_locked_out(identifier: str) -> bool:
    if MAX_LOGIN_ATTEMPTS <= 0:
        return False
    rec = await db.login_attempts.find_one({"identifier": identifier})
    if not rec:
        return False
    if rec.get("locked_until"):
        until = datetime.fromisoformat(rec["locked_until"])
        return datetime.now(timezone.utc) < until
    return False


async def record_failure(identifier: str):
    if MAX_LOGIN_ATTEMPTS <= 0:
        return
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
    parent_objective_id: Optional[str] = None
    initial_assigned_goals: Optional[List[str]] = None


class ObjectiveUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    dri_id: Optional[str] = None
    success_metric: Optional[str] = None
    current_value: Optional[str] = None
    target_value: Optional[str] = None
    contributor_ids: Optional[List[str]] = None
    parent_objective_id: Optional[str] = None


class ObjectiveMemberConfig(BaseModel):
    assigned_goals: Optional[List[str]] = None
    rigor_questions: Optional[List[str]] = None


class GoalCompletionUpdate(BaseModel):
    completed: bool


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


class GoalOutcomeEntry(BaseModel):
    goal_text: str = ""
    achievement: Literal["fully", "partially", "not_achieved", ""] = ""
    actual_result: str = ""
    biggest_difference: str = ""


class IndividualReflectionPayload(BaseModel):
    objective_id: str
    goal_outcomes: List[GoalOutcomeEntry] = []
    objective_succeeded: str = ""
    my_contribution: str = ""
    system_breaks: str = ""
    what_moved_metric: str = ""
    quality_built_shipped: str = ""
    quality_validation: str = ""
    quality_edge_cases: str = ""
    quality_what_would_break: str = ""
    peer_reviewed: str = ""
    peer_feedback: str = ""
    peer_improved_after: str = ""
    what_didnt_work: str = ""
    biggest_wins: str = ""
    where_fell_short: str = ""
    key_learnings: str = ""
    friction_bottlenecks: str = ""
    should_change_next_cycle: str = ""
    support_needed: str = ""
    beyond_where: str = ""
    beyond_what_did: str = ""
    beyond_why_mattered: str = ""
    beyond_what_changed: str = ""
    ceo_slowing_down: str = ""
    ceo_doesnt_matter: str = ""
    ceo_over_under_invest: str = ""
    rigor_answers: dict = {}
    # legacy fields (read/write compat)
    contribution_to_objective: str = ""
    wins: str = ""
    failures: str = ""
    learnings: str = ""
    bottlenecks: str = ""
    trajectory_change: str = ""
    ceo_question_response: str = ""


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
    if COGNITO_ENABLED:
        cognito_user = await authenticate_with_cognito(email, payload.password)
        user = await upsert_user_from_cognito(
            email=cognito_user["email"],
            name=cognito_user["name"],
            attrs=cognito_user["attrs"],
            groups=cognito_user["groups"],
        )
    else:
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


@api.get("/meta")
async def api_meta():
    """Public build info — use to confirm deployed backend version."""
    return {
        "version": "2026-05-sub-objectives",
        "features": ["parent_objective_id", "dri_sub_objectives", "goal_rollup"],
    }


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api.get("/auth/roles")
async def auth_roles(_: dict = Depends(get_current_user)):
    return {"roles": ROLE_PRIORITY}


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
        response.set_cookie("access_token", access, httponly=True, secure=True, samesite="lax",
                            max_age=43200, path="/")
        return {"ok": True}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


# ---------- USERS ----------
class UserPatch(BaseModel):
    manager_id: Optional[str] = None
    role: Optional[Literal["admin", "manager", "dri", "contributor"]] = None
    name: Optional[str] = None
    clear_manager: Optional[bool] = False


@api.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    projection = {"_id": 0, "password_hash": 0}
    users = await db.users.find({}, projection).to_list(500)
    if user["role"] not in ("admin", "manager"):
        users = [{"id": u["id"], "name": u["name"], "role": u["role"],
                  "manager_id": u.get("manager_id")} for u in users]
    return users


@api.get("/users/manageable")
async def list_manageable(user: dict = Depends(get_current_user)):
    """Users the caller can edit plans/updates for (self + entire downline, or all for admin)."""
    ids = await manageable_ids(user)
    users = await db.users.find({"id": {"$in": list(ids)}},
                                {"_id": 0, "password_hash": 0}).to_list(500)
    return users


@api.get("/users/reportees")
async def list_reportees(manager_id: str, user: dict = Depends(get_current_user)):
    """Direct reportees of a manager/DRI (for contributor selection on objectives)."""
    if user["role"] not in ("admin", "manager") and user["id"] != manager_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return await db.users.find(
        {"manager_id": manager_id},
        {"_id": 0, "password_hash": 0},
    ).to_list(500)


@api.patch("/users/{user_id}")
@api.put("/users/{user_id}")
async def patch_user(user_id: str, payload: UserPatch, _: dict = Depends(require_role("admin"))):
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    updates = {}
    if payload.role is not None:
        updates["role"] = payload.role
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.clear_manager:
        updates["manager_id"] = None
    elif payload.manager_id is not None:
        if payload.manager_id == user_id:
            raise HTTPException(status_code=400, detail="A user cannot manage themselves")
        # prevent cycles
        visited = {user_id}
        cur_id = payload.manager_id
        while cur_id:
            if cur_id in visited:
                raise HTTPException(status_code=400, detail="Assignment would create a cycle")
            visited.add(cur_id)
            up = await db.users.find_one({"id": cur_id}, {"manager_id": 1, "_id": 0})
            cur_id = up.get("manager_id") if up else None
        updates["manager_id"] = payload.manager_id
    if updates:
        await db.users.update_one({"id": user_id}, {"$set": updates})
    return await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})


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
        "manager_id": None,
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
@api.put("/cycles/{cycle_id}")
async def update_cycle(cycle_id: str, payload: FocusCycleUpdate, _: dict = Depends(require_role("admin"))):
    await db.cycles.update_one({"id": cycle_id}, {"$set": {"status": payload.status}})
    c = await db.cycles.find_one({"id": cycle_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return c


# ---------- OBJECTIVES ----------
@api.get("/objectives")
async def list_objectives(
    cycle_id: Optional[str] = None,
    parent_objective_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = {}
    if cycle_id:
        q["cycle_id"] = cycle_id
    if parent_objective_id:
        q["parent_objective_id"] = parent_objective_id
    objs = await db.objectives.find(q, {"_id": 0}).to_list(500)
    enriched = []
    for obj in objs:
        item = dict(obj)
        if not obj.get("parent_objective_id"):
            rollup = await compute_parent_rollup(obj["id"])
            if rollup:
                item["rollup"] = rollup
                item["rollup_progress"] = rollup["percent"]
        enriched.append(item)
    return enriched


@api.get("/objectives/{objective_id}")
async def get_objective(objective_id: str, _: dict = Depends(get_current_user)):
    obj = await db.objectives.find_one({"id": objective_id}, {"_id": 0})
    if not obj:
        raise HTTPException(status_code=404, detail="Objective not found")
    return await enrich_objective(obj)


@api.post("/objectives")
async def create_objective(
    payload: ObjectiveCreate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    parent = None
    if payload.parent_objective_id:
        parent = await get_objective_or_404(payload.parent_objective_id)
        await validate_child_objective_create(payload, user)
        if user["role"] not in ("admin", "manager") and not await user_is_dri_for_objective(user, parent):
            raise HTTPException(
                status_code=403,
                detail="You can only create team sub-objectives under objectives where you are the DRI",
            )
    elif user["role"] not in ("admin", "manager"):
        raise HTTPException(
            status_code=403,
            detail="Only managers and admins can create top-level objectives",
        )
    await validate_contributors_for_dri(payload.dri_id, payload.contributor_ids)
    initial_goals = payload.initial_assigned_goals
    doc = payload.model_dump()
    doc.pop("initial_assigned_goals", None)
    if not doc.get("parent_objective_id"):
        doc["parent_objective_id"] = None
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_utc()
    await db.objectives.insert_one(doc)
    doc.pop("_id", None)
    if initial_goals and payload.contributor_ids:
        contributor_id = payload.contributor_ids[0]
        plan = await ensure_plan(contributor_id, doc["id"])
        goals = merge_assigned_goals(initial_goals, [], user)
        await db.plans.update_one(
            {"id": plan["id"]},
            {"$set": {"assigned_goals": goals, "updated_at": now_utc()}},
        )
    if doc.get("parent_objective_id"):
        await sync_parent_rollup(doc["parent_objective_id"])
    background_tasks.add_task(
        notify_objective_created,
        db,
        doc,
        user,
        FRONTEND_URL,
        initial_goals,
    )
    return doc


@api.patch("/objectives/{objective_id}")
@api.put("/objectives/{objective_id}")
async def update_objective(
    objective_id: str,
    payload: ObjectiveUpdate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    obj = await db.objectives.find_one({"id": objective_id})
    if not obj:
        raise HTTPException(status_code=404, detail="Objective not found")
    if user["role"] not in ("admin", "manager") and obj.get("dri_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    previous = {k: obj.get(k) for k in (
        "dri_id", "contributor_ids", "title", "description",
        "success_metric", "current_value", "target_value",
    )}
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        new_dri = updates.get("dri_id", obj.get("dri_id"))
        new_contribs = updates.get("contributor_ids", obj.get("contributor_ids", []))
        await validate_contributors_for_dri(new_dri, new_contribs)
        await db.objectives.update_one({"id": objective_id}, {"$set": updates})
    updated = await db.objectives.find_one({"id": objective_id}, {"_id": 0})
    if updates:
        background_tasks.add_task(
            notify_objective_updated,
            db,
            updated,
            updates,
            user,
            FRONTEND_URL,
            previous,
        )
    return updated


@api.put("/objectives/{objective_id}/members/{member_user_id}/config")
@api.patch("/objectives/{objective_id}/members/{member_user_id}/config")
async def upsert_objective_member_config(
    objective_id: str,
    member_user_id: str,
    payload: ObjectiveMemberConfig,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """Set assigned goals (manager/admin or DRI for contributors) and rigor questions (DRI for contributors)."""
    obj = await get_objective_or_404(objective_id)
    if payload.assigned_goals is None and payload.rigor_questions is None:
        raise HTTPException(status_code=400, detail="No config fields provided")

    plan = await ensure_plan(member_user_id, objective_id)
    updates = {"updated_at": now_utc()}
    merged_goals = None

    if payload.assigned_goals is not None:
        if not await can_set_assigned_goals(user, obj, member_user_id):
            raise HTTPException(status_code=403, detail="Not authorized to set assigned goals for this member")
        existing_goals = plan.get("assigned_goals") or []
        merged_goals = merge_assigned_goals(payload.assigned_goals, existing_goals, user)
        updates["assigned_goals"] = merged_goals

    if payload.rigor_questions is not None:
        if not await can_set_rigor_questions_async(user, obj, member_user_id):
            raise HTTPException(
                status_code=403,
                detail="Only the DRI can set rigor questions for contributors",
            )
        updates["rigor_questions"] = [q.strip() for q in payload.rigor_questions if q and q.strip()]

    await db.plans.update_one({"id": plan["id"]}, {"$set": updates})
    updated_plan = await db.plans.find_one({"id": plan["id"]}, {"_id": 0})
    if merged_goals is not None:
        background_tasks.add_task(
            notify_goals_assigned,
            db,
            obj,
            member_user_id,
            merged_goals,
            user,
            FRONTEND_URL,
        )
    if obj.get("parent_objective_id"):
        await sync_parent_rollup(obj["parent_objective_id"])
    return updated_plan


@api.patch("/objectives/{objective_id}/members/{member_user_id}/goals/{goal_id}")
async def update_goal_completion(
    objective_id: str,
    member_user_id: str,
    goal_id: str,
    payload: GoalCompletionUpdate,
    user: dict = Depends(get_current_user),
):
    obj = await get_objective_or_404(objective_id)
    if not await can_toggle_goal_completion_async(user, obj, member_user_id):
        raise HTTPException(status_code=403, detail="Not authorized to update goal completion")
    plan = await ensure_plan(member_user_id, objective_id)
    goals = plan.get("assigned_goals") or []
    found = False
    updated_goals = []
    for g in goals:
        if isinstance(g, dict) and g.get("id") == goal_id:
            updated_goals.append({**g, "completed": payload.completed, "completed_at": now_utc() if payload.completed else None})
            found = True
        else:
            updated_goals.append(g)
    if not found:
        raise HTTPException(status_code=404, detail="Goal not found")
    await db.plans.update_one(
        {"id": plan["id"]},
        {"$set": {"assigned_goals": updated_goals, "updated_at": now_utc()}},
    )
    if obj.get("parent_objective_id"):
        await sync_parent_rollup(obj["parent_objective_id"])
    return await db.plans.find_one({"id": plan["id"]}, {"_id": 0})


# ---------- INDIVIDUAL PLANS ----------
@api.get("/plans")
async def list_plans(objective_id: Optional[str] = None, user_id: Optional[str] = None,
                     user: dict = Depends(get_current_user)):
    q = {}
    if objective_id:
        q["objective_id"] = objective_id
    if user_id:
        q["user_id"] = user_id
    if user["role"] not in ("admin", "manager"):
        if objective_id:
            obj = await db.objectives.find_one({"id": objective_id}, {"_id": 0})
            if not (obj and await user_is_dri_for_objective(user, obj)):
                q["user_id"] = user_id or user["id"]
        else:
            q["user_id"] = user_id or user["id"]
    return await db.plans.find(q, {"_id": 0}).to_list(500)


@api.post("/plans")
async def upsert_plan(payload: IndividualPlanPayload,
                      user_id: Optional[str] = None,
                      user: dict = Depends(get_current_user)):
    target_user_id = user_id or user["id"]
    if not await can_manage(user, target_user_id):
        raise HTTPException(status_code=403, detail="Not authorized to edit this user's plan")
    doc = payload.model_dump()
    doc["user_id"] = target_user_id
    doc["updated_at"] = now_utc()
    existing = await db.plans.find_one({"user_id": target_user_id, "objective_id": payload.objective_id})
    if existing:
        doc["tasks"] = existing.get("tasks", [])
        doc["assigned_goals"] = existing.get("assigned_goals", [])
        doc["rigor_questions"] = existing.get("rigor_questions", [])
        await db.plans.update_one({"id": existing["id"]}, {"$set": doc})
        return await db.plans.find_one({"id": existing["id"]}, {"_id": 0})
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_utc()
    doc["tasks"] = []
    doc["assigned_goals"] = []
    doc["rigor_questions"] = []
    await db.plans.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---------- TASKS ----------
class TaskPayload(BaseModel):
    title: str
    status: Literal["todo", "doing", "done"] = "todo"
    due_date: Optional[str] = None


class TaskPatch(BaseModel):
    title: Optional[str] = None
    status: Optional[Literal["todo", "doing", "done"]] = None
    due_date: Optional[str] = None


@api.post("/plans/{plan_id}/tasks")
async def add_task(plan_id: str, payload: TaskPayload, user: dict = Depends(get_current_user)):
    plan = await db.plans.find_one({"id": plan_id})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if not await can_manage(user, plan["user_id"]):
        raise HTTPException(status_code=403, detail="Not authorized")
    task = {
        "id": str(uuid.uuid4()),
        "title": payload.title,
        "status": payload.status,
        "due_date": payload.due_date,
        "created_by": user["id"],
        "created_at": now_utc(),
    }
    await db.plans.update_one({"id": plan_id}, {"$push": {"tasks": task}})
    return task


@api.patch("/plans/{plan_id}/tasks/{task_id}")
@api.put("/plans/{plan_id}/tasks/{task_id}")
async def patch_task(plan_id: str, task_id: str, payload: TaskPatch,
                     user: dict = Depends(get_current_user)):
    plan = await db.plans.find_one({"id": plan_id})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if not await can_manage(user, plan["user_id"]):
        raise HTTPException(status_code=403, detail="Not authorized")
    update = {f"tasks.$.{k}": v for k, v in payload.model_dump(exclude_none=True).items()}
    if update:
        await db.plans.update_one({"id": plan_id, "tasks.id": task_id}, {"$set": update})
    p = await db.plans.find_one({"id": plan_id}, {"_id": 0})
    for t in p.get("tasks", []):
        if t["id"] == task_id:
            return t
    raise HTTPException(status_code=404, detail="Task not found")


@api.delete("/plans/{plan_id}/tasks/{task_id}")
async def delete_task(plan_id: str, task_id: str, user: dict = Depends(get_current_user)):
    plan = await db.plans.find_one({"id": plan_id})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if not await can_manage(user, plan["user_id"]):
        raise HTTPException(status_code=403, detail="Not authorized")
    await db.plans.update_one({"id": plan_id}, {"$pull": {"tasks": {"id": task_id}}})
    return {"ok": True}


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
async def create_update(payload: WeeklyUpdatePayload,
                        user_id: Optional[str] = None,
                        user: dict = Depends(get_current_user)):
    target_user_id = user_id or user["id"]
    if not await can_manage(user, target_user_id):
        raise HTTPException(status_code=403, detail="Not authorized to submit for this user")
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = target_user_id
    doc["submitted_by"] = user["id"]
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
    # Intentionally no additional demo users or data.


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
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
