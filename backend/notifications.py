"""Email notifications for objective and goal assignment changes."""
import logging
from typing import List, Optional

from email_utils import (
    send_email,
    objective_assigned_html,
    objective_updated_html,
    goals_assigned_html,
)

logger = logging.getLogger(__name__)

OBJECTIVE_DETAIL_FIELDS = (
    "title",
    "description",
    "success_metric",
    "current_value",
    "target_value",
)


def objective_link(frontend_url: str, objective_id: str) -> str:
    base = (frontend_url or "").rstrip("/")
    return f"{base}/objectives/{objective_id}"


def goal_texts(goals: list) -> List[str]:
    texts = []
    for g in goals or []:
        if isinstance(g, dict):
            text = (g.get("text") or "").strip()
        else:
            text = str(g or "").strip()
        if text:
            texts.append(text)
    return texts


def describe_objective_changes(updates: dict) -> List[str]:
    labels = {
        "title": "Title",
        "description": "Description",
        "success_metric": "Success metric",
        "current_value": "Current value",
        "target_value": "Target value",
        "dri_id": "DRI",
        "contributor_ids": "Contributors",
    }
    changes = []
    for key, label in labels.items():
        if key in updates:
            changes.append(label)
    return changes


async def _send_to_user(
    user: Optional[dict],
    actor_id: str,
    subject: str,
    html: str,
) -> None:
    if not user:
        return
    if user.get("id") == actor_id:
        return
    email = (user.get("email") or "").strip().lower()
    if not email:
        return
    result = await send_email(email, subject, html)
    logger.info(
        "[OBJECTIVE_NOTIFY] to=%s subject=%s sent=%s",
        email,
        subject,
        result.get("sent"),
    )


async def notify_objective_created(
    db,
    objective: dict,
    actor: dict,
    frontend_url: str,
    initial_goals: Optional[List[str]] = None,
) -> None:
    actor_name = actor.get("name") or "Your manager"
    link = objective_link(frontend_url, objective["id"])
    goals = [g.strip() for g in (initial_goals or []) if g and g.strip()]

    dri_id = objective.get("dri_id")
    if dri_id:
        dri = await db.users.find_one({"id": dri_id}, {"_id": 0, "id": 1, "email": 1, "name": 1})
        html = objective_assigned_html(
            recipient_name=dri.get("name", "") if dri else "",
            objective_title=objective.get("title", "Objective"),
            role_label="DRI",
            assigned_by=actor_name,
            objective_link=link,
            description=objective.get("description", ""),
            goals=goals if objective.get("parent_objective_id") else None,
        )
        await _send_to_user(
            dri,
            actor.get("id", ""),
            f"New objective assigned: {objective.get('title', 'Objective')}",
            html,
        )

    for contributor_id in objective.get("contributor_ids") or []:
        contributor = await db.users.find_one(
            {"id": contributor_id},
            {"_id": 0, "id": 1, "email": 1, "name": 1},
        )
        html = objective_assigned_html(
            recipient_name=contributor.get("name", "") if contributor else "",
            objective_title=objective.get("title", "Objective"),
            role_label="Contributor",
            assigned_by=actor_name,
            objective_link=link,
            description=objective.get("description", ""),
            goals=goals,
        )
        await _send_to_user(
            contributor,
            actor.get("id", ""),
            f"New objective assigned: {objective.get('title', 'Objective')}",
            html,
        )


async def notify_objective_updated(
    db,
    objective: dict,
    updates: dict,
    actor: dict,
    frontend_url: str,
    previous: dict,
) -> None:
    if not updates:
        return

    actor_name = actor.get("name") or "Someone"
    link = objective_link(frontend_url, objective["id"])
    title = objective.get("title", "Objective")
    changes = describe_objective_changes(updates)

    recipients: dict[str, dict] = {}
    notify_ids = set()

    if "dri_id" in updates and updates["dri_id"]:
        notify_ids.add(updates["dri_id"])

    old_contribs = set(previous.get("contributor_ids") or [])
    new_contribs = set(objective.get("contributor_ids") or [])
    notify_ids.update(new_contribs - old_contribs)

    detail_changed = any(k in updates for k in OBJECTIVE_DETAIL_FIELDS)
    if detail_changed or "contributor_ids" in updates:
        notify_ids.update(objective_member_ids(objective))

    for user_id in notify_ids:
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1, "name": 1})
        if user:
            recipients[user_id] = user

    for user in recipients.values():
        html = objective_updated_html(
            recipient_name=user.get("name", ""),
            objective_title=title,
            updated_by=actor_name,
            objective_link=link,
            changes=changes,
        )
        await _send_to_user(
            user,
            actor.get("id", ""),
            f"Objective updated: {title}",
            html,
        )


async def notify_goals_assigned(
    db,
    objective: dict,
    member_user_id: str,
    goals: list,
    actor: dict,
    frontend_url: str,
) -> None:
    texts = goal_texts(goals)
    if not texts:
        return

    member = await db.users.find_one(
        {"id": member_user_id},
        {"_id": 0, "id": 1, "email": 1, "name": 1},
    )
    actor_name = actor.get("name") or "Your DRI"
    link = objective_link(frontend_url, objective["id"])
    html = goals_assigned_html(
        recipient_name=member.get("name", "") if member else "",
        objective_title=objective.get("title", "Objective"),
        assigned_by=actor_name,
        objective_link=link,
        goals=texts,
    )
    await _send_to_user(
        member,
        actor.get("id", ""),
        f"Goals assigned: {objective.get('title', 'Objective')}",
        html,
    )


def objective_member_ids(obj: dict) -> List[str]:
    ids = []
    if obj.get("dri_id"):
        ids.append(obj["dri_id"])
    ids.extend(obj.get("contributor_ids") or [])
    return ids
