"""Unit tests for objective/goal email notifications."""
import pytest
from unittest.mock import AsyncMock, patch

from notifications import (
    describe_objective_changes,
    goal_texts,
    notify_goals_assigned,
    notify_objective_created,
    notify_objective_updated,
    objective_link,
)


def test_objective_link():
    assert objective_link("http://localhost:3000", "abc") == "http://localhost:3000/objectives/abc"
    assert objective_link("http://localhost:3000/", "abc") == "http://localhost:3000/objectives/abc"


def test_goal_texts_from_dicts():
    goals = [{"text": "Ship v1", "completed": False}, {"text": "  ", "id": "x"}]
    assert goal_texts(goals) == ["Ship v1"]


def test_describe_objective_changes():
    changes = describe_objective_changes({"title": "New", "dri_id": "u1"})
    assert "Title" in changes
    assert "DRI" in changes


@pytest.mark.asyncio
async def test_notify_objective_created_emails_dri_and_contributor():
    db = AsyncMock()
    db.users.find_one = AsyncMock(side_effect=[
        {"id": "dri-1", "email": "dri@test.com", "name": "DRI User"},
        {"id": "c-1", "email": "contrib@test.com", "name": "Contributor"},
    ])
    objective = {
        "id": "obj-1",
        "title": "Grow retention",
        "description": "Q1 focus",
        "dri_id": "dri-1",
        "contributor_ids": ["c-1"],
        "parent_objective_id": "parent-1",
    }
    actor = {"id": "mgr-1", "name": "Manager"}

    with patch("notifications.send_email", new_callable=AsyncMock) as send:
        send.return_value = {"sent": False, "fallback": "console"}
        await notify_objective_created(db, objective, actor, "http://localhost:3000", ["Goal A"])

    assert send.await_count == 2
    recipients = {call.args[0] for call in send.await_args_list}
    assert recipients == {"dri@test.com", "contrib@test.com"}


@pytest.mark.asyncio
async def test_notify_objective_created_skips_actor():
    db = AsyncMock()
    db.users.find_one = AsyncMock(return_value={"id": "dri-1", "email": "dri@test.com", "name": "DRI"})
    objective = {
        "id": "obj-1",
        "title": "Self assign",
        "description": "",
        "dri_id": "dri-1",
        "contributor_ids": [],
    }
    actor = {"id": "dri-1", "name": "DRI"}

    with patch("notifications.send_email", new_callable=AsyncMock) as send:
        await notify_objective_created(db, objective, actor, "http://localhost:3000", None)

    send.assert_not_awaited()


@pytest.mark.asyncio
async def test_notify_goals_assigned():
    db = AsyncMock()
    db.users.find_one = AsyncMock(return_value={"id": "c-1", "email": "c@test.com", "name": "Contributor"})
    objective = {"id": "obj-1", "title": "Team goal"}
    goals = [{"text": "Goal 1"}, {"text": "Goal 2"}]
    actor = {"id": "dri-1", "name": "DRI"}

    with patch("notifications.send_email", new_callable=AsyncMock) as send:
        send.return_value = {"sent": True, "id": "email-1"}
        await notify_goals_assigned(db, objective, "c-1", goals, actor, "http://localhost:3000")

    send.assert_awaited_once()
    assert send.await_args.args[0] == "c@test.com"
    assert "Goals assigned" in send.await_args.args[1]


@pytest.mark.asyncio
async def test_notify_objective_updated_new_contributor():
    db = AsyncMock()
    db.users.find_one = AsyncMock(return_value={"id": "c-2", "email": "new@test.com", "name": "New"})
    objective = {
        "id": "obj-1",
        "title": "Updated title",
        "dri_id": "dri-1",
        "contributor_ids": ["c-1", "c-2"],
    }
    previous = {"contributor_ids": ["c-1"]}
    updates = {"contributor_ids": ["c-1", "c-2"], "title": "Updated title"}
    actor = {"id": "mgr-1", "name": "Manager"}

    with patch("notifications.send_email", new_callable=AsyncMock) as send:
        send.return_value = {"sent": False, "fallback": "console"}
        await notify_objective_updated(db, objective, updates, actor, "http://localhost:3000", previous)

    assert send.await_count >= 1
    assert any(call.args[0] == "new@test.com" for call in send.await_args_list)
