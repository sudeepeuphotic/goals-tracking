# AI evaluator module (Gemini 3 Flash via google-genai SDK)
# Exposes a router factory so server.py can wire up shared deps (db, auth).
import os
import json
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

try:
    from google import genai
    from google.genai import types as genai_types
    GENAI_AVAILABLE = True
except Exception:
    GENAI_AVAILABLE = False

logger = logging.getLogger(__name__)

GOOGLE_API_KEY = os.environ.get('GOOGLE_API_KEY', '')
AI_ENABLED = os.environ.get('AI_ENABLED', 'false').lower() == 'true'
AI_MODEL = os.environ.get('AI_MODEL', 'gemini-3-flash-preview')

_client = None


def _get_client():
    global _client
    if _client is None and AI_ENABLED and GENAI_AVAILABLE and GOOGLE_API_KEY:
        _client = genai.Client(api_key=GOOGLE_API_KEY)
    return _client


AI_INDIVIDUAL_SCHEMA = {
    "type": "object",
    "properties": {
        "executive_summary": {"type": "string"},
        "strength_signals": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
        "risk_signals": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
        "evidence_gaps": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
        "tentative_score": {"type": "integer", "minimum": 1, "maximum": 5},
        "manager_attention_points": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
        "verify_this": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
    },
    "required": ["executive_summary", "strength_signals", "risk_signals",
                 "tentative_score", "manager_attention_points"],
    "propertyOrdering": ["executive_summary", "strength_signals", "risk_signals",
                         "evidence_gaps", "tentative_score",
                         "manager_attention_points", "verify_this"],
}

AI_OBJECTIVE_SCHEMA = {
    "type": "object",
    "properties": {
        "objective_outcome_summary": {"type": "string"},
        "leadership_signals": {
            "type": "object",
            "properties": {
                "clarity": {"type": "string"},
                "alignment": {"type": "string"},
                "decision_making": {"type": "string"},
                "unblocking": {"type": "string"},
                "quality_bar": {"type": "string"},
            },
            "required": ["clarity", "alignment", "decision_making", "unblocking", "quality_bar"],
            "propertyOrdering": ["clarity", "alignment", "decision_making",
                                 "unblocking", "quality_bar"],
        },
        "team_feedback_patterns": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
        "mismatch": {"type": "string"},
        "risks_in_execution": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
        "tentative_dri_score": {"type": "integer", "minimum": 1, "maximum": 5},
    },
    "required": ["objective_outcome_summary", "leadership_signals",
                 "team_feedback_patterns", "tentative_dri_score"],
    "propertyOrdering": ["objective_outcome_summary", "leadership_signals",
                         "team_feedback_patterns", "mismatch",
                         "risks_in_execution", "tentative_dri_score"],
}


async def call_gemini(system_instruction: str, user_prompt: str, schema: dict) -> dict:
    client = _get_client()
    if not client:
        raise HTTPException(status_code=503,
                            detail="AI is disabled. Set AI_ENABLED=true and GOOGLE_API_KEY.")
    try:
        response = client.models.generate_content(
            model=AI_MODEL,
            contents=user_prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.4,
                response_mime_type="application/json",
                response_json_schema=schema,
            ),
        )
        return json.loads(response.text)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("AI call failed")
        raise HTTPException(status_code=502, detail=f"AI call failed: {str(e)[:200]}")


def build_ai_router(db, require_role, get_current_user, now_utc):
    router = APIRouter(prefix="/ai", tags=["ai"])

    @router.get("/status")
    async def ai_status(_: dict = Depends(get_current_user)):
        return {"enabled": AI_ENABLED and GENAI_AVAILABLE and bool(GOOGLE_API_KEY),
                "model": AI_MODEL}

    @router.post("/evaluate-individual")
    async def ai_evaluate_individual(user_id: str, objective_id: str,
                                     _: dict = Depends(require_role("admin", "manager"))):
        target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        obj = await db.objectives.find_one({"id": objective_id}, {"_id": 0})
        if not target or not obj:
            raise HTTPException(status_code=404, detail="Not found")
        plan = await db.plans.find_one({"user_id": user_id, "objective_id": objective_id}, {"_id": 0})
        updates = await db.updates.find({"user_id": user_id, "objective_id": objective_id},
                                        {"_id": 0}).to_list(500)
        refl = await db.individual_reflections.find_one(
            {"user_id": user_id, "objective_id": objective_id}, {"_id": 0})
        payload = {
            "person": {"name": target["name"], "role": target["role"]},
            "objective": {"title": obj["title"], "description": obj["description"],
                          "success_metric": obj["success_metric"],
                          "target_value": obj.get("target_value"),
                          "current_value": obj.get("current_value")},
            "plan": plan, "weekly_updates": updates, "reflection": refl,
        }
        system = (
            "You are an internal performance evaluator for a startup's 3-month execution cycle. "
            "Be evidence-based. If data is thin, say so in evidence_gaps. Never invent facts. "
            "Tone: sharp, concrete, operator-minded. Output JSON matching the schema exactly."
        )
        prompt = ("Evaluate the contributor below using only the evidence provided.\n\n"
                  + json.dumps(payload, default=str))
        result = await call_gemini(system, prompt, AI_INDIVIDUAL_SCHEMA)
        record = {
            "id": str(uuid.uuid4()),
            "kind": "individual",
            "user_id": user_id,
            "objective_id": objective_id,
            "output": result,
            "model": AI_MODEL,
            "created_at": now_utc(),
        }
        await db.ai_evaluations.insert_one(dict(record))
        record.pop("_id", None)
        return record

    @router.post("/evaluate-objective")
    async def ai_evaluate_objective(objective_id: str,
                                    _: dict = Depends(require_role("admin", "manager"))):
        obj = await db.objectives.find_one({"id": objective_id}, {"_id": 0})
        if not obj:
            raise HTTPException(status_code=404, detail="Objective not found")
        dri = await db.users.find_one({"id": obj["dri_id"]}, {"_id": 0, "password_hash": 0})
        dri_refl = await db.dri_reflections.find_one({"objective_id": objective_id}, {"_id": 0})
        feedback = await db.feedback.find({"objective_id": objective_id},
                                          {"_id": 0, "user_id": 0}).to_list(500)
        updates = await db.updates.find({"objective_id": objective_id}, {"_id": 0}).to_list(500)
        contributor_plans = await db.plans.find(
            {"objective_id": objective_id, "user_id": {"$in": obj.get("contributor_ids", [])}},
            {"_id": 0, "user_id": 1, "rigor_questions": 1, "assigned_goals": 1},
        ).to_list(500)
        payload = {
            "objective": {k: obj.get(k) for k in ["title", "description", "success_metric",
                                                  "current_value", "target_value"]},
            "contributor_plans": contributor_plans,
            "dri": {"name": dri["name"] if dri else "", "role": dri["role"] if dri else ""},
            "dri_reflection": dri_refl, "team_feedback": feedback, "weekly_updates": updates,
        }
        system = (
            "You are an internal performance evaluator for a 3-month execution cycle. "
            "Evaluate DRI leadership across clarity, alignment, decision-making, unblocking, quality_bar. "
            "Compare DRI self-view to team feedback and flag mismatches honestly. "
            "Output JSON matching the schema exactly."
        )
        prompt = ("Evaluate the DRI and objective using only the evidence below.\n\n"
                  + json.dumps(payload, default=str))
        result = await call_gemini(system, prompt, AI_OBJECTIVE_SCHEMA)
        record = {
            "id": str(uuid.uuid4()),
            "kind": "objective",
            "objective_id": objective_id,
            "output": result,
            "model": AI_MODEL,
            "created_at": now_utc(),
        }
        await db.ai_evaluations.insert_one(dict(record))
        record.pop("_id", None)
        return record

    @router.get("/evaluations")
    async def list_ai_evaluations(kind: Optional[str] = None,
                                  user_id: Optional[str] = None,
                                  objective_id: Optional[str] = None,
                                  _: dict = Depends(require_role("admin", "manager"))):
        q = {}
        if kind:
            q["kind"] = kind
        if user_id:
            q["user_id"] = user_id
        if objective_id:
            q["objective_id"] = objective_id
        return await db.ai_evaluations.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)

    return router
