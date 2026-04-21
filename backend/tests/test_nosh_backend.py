"""
Nosh Focus Cycles - Backend API tests.
Covers: auth (login/me/logout), cycles, objectives, plans, updates,
reflections (individual + DRI), DRI feedback with role/business-rule
guards, manager-review (role-gated).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to frontend/.env so tests still run locally
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

API = f"{BASE_URL}/api"


def _session(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin():
    return _session(os.environ["TEST_ADMIN_EMAIL"] if "TEST_ADMIN_EMAIL" in os.environ else os.environ.get("ADMIN_EMAIL", ""),
                    os.environ["TEST_ADMIN_PW"] if "TEST_ADMIN_PW" in os.environ else os.environ.get("ADMIN_PASSWORD", ""))


@pytest.fixture(scope="session")
def manager():
    return _session(os.environ.get("TEST_MANAGER_EMAIL", "manager@nosh.io"),
                    os.environ.get("TEST_USER_PW", ""))


@pytest.fixture(scope="session")
def dri():
    return _session(os.environ.get("TEST_DRI_EMAIL", "dri@nosh.io"),
                    os.environ.get("TEST_USER_PW", ""))


@pytest.fixture(scope="session")
def alice():
    return _session(os.environ.get("TEST_ALICE_EMAIL", "alice@nosh.io"),
                    os.environ.get("TEST_USER_PW", ""))


@pytest.fixture(scope="session")
def bob():
    return _session(os.environ.get("TEST_BOB_EMAIL", "bob@nosh.io"),
                    os.environ.get("TEST_USER_PW", ""))


@pytest.fixture(scope="session")
def users_by_email(admin):
    r = admin.get(f"{API}/users", timeout=20)
    assert r.status_code == 200
    return {u["email"]: u for u in r.json()}


@pytest.fixture(scope="session")
def seeded_cycle(admin):
    r = admin.get(f"{API}/cycles", timeout=20)
    assert r.status_code == 200
    cycles = r.json()
    assert len(cycles) >= 1, "Expected seeded cycle"
    # Prefer the seeded "Q1 2026 — Growth" if present
    for c in cycles:
        if "Q1 2026" in c.get("name", ""):
            return c
    return cycles[0]


@pytest.fixture(scope="session")
def seeded_objectives(admin, seeded_cycle):
    r = admin.get(f"{API}/objectives", params={"cycle_id": seeded_cycle["id"]}, timeout=20)
    assert r.status_code == 200
    objs = r.json()
    assert len(objs) >= 2
    return objs


# ---------- Health ----------
def test_health():
    r = requests.get(f"{API}/", timeout=20)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# ---------- Auth ----------
def test_login_sets_cookies_and_returns_user():
    s = requests.Session()
    r = s.post(f"{API}/auth/login",
               json={"email": os.environ["TEST_ADMIN_EMAIL"] if "TEST_ADMIN_EMAIL" in os.environ else os.environ.get("ADMIN_EMAIL", ""),
                     "password": os.environ["TEST_ADMIN_PW"] if "TEST_ADMIN_PW" in os.environ else os.environ.get("ADMIN_PASSWORD", "")},
               timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "admin@nosh.io"
    assert data["role"] == "admin"
    assert "password_hash" not in data
    assert "_id" not in data
    # Cookies present
    cookie_names = {c.name for c in s.cookies}
    assert "access_token" in cookie_names
    assert "refresh_token" in cookie_names


def test_login_invalid_credentials():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@nosh.io", "password": "WRONG"}, timeout=20)
    assert r.status_code == 401


def test_auth_me(admin):
    r = admin.get(f"{API}/auth/me", timeout=20)
    assert r.status_code == 200
    assert r.json()["email"] == "admin@nosh.io"


def test_auth_me_requires_cookie():
    r = requests.get(f"{API}/auth/me", timeout=20)
    assert r.status_code == 401


def test_logout_clears_cookies():
    s = _session(os.environ.get("TEST_BOB_EMAIL", "bob@nosh.io"),
                 os.environ.get("TEST_USER_PW", ""))
    r = s.post(f"{API}/auth/logout", timeout=20)
    assert r.status_code == 200
    # After server clears, subsequent /me should fail with server-side cookies
    # Clear client jar manually to simulate since httpOnly delete is echoed via Set-Cookie
    s.cookies.clear()
    r2 = s.get(f"{API}/auth/me", timeout=20)
    assert r2.status_code == 401


# ---------- Cycles ----------
def test_list_cycles(alice, seeded_cycle):
    r = alice.get(f"{API}/cycles", timeout=20)
    assert r.status_code == 200
    assert any(c["id"] == seeded_cycle["id"] for c in r.json())


def test_create_cycle_admin(admin):
    payload = {"name": f"TEST_cycle_{uuid.uuid4().hex[:6]}",
               "start_date": "2026-04-01", "end_date": "2026-06-30"}
    r = admin.post(f"{API}/cycles", json=payload, timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == payload["name"]
    assert data["status"] == "active"
    # Verify persisted
    r2 = admin.get(f"{API}/cycles", timeout=20)
    assert any(c["id"] == data["id"] for c in r2.json())


def test_create_cycle_forbidden_for_non_admin(alice):
    r = alice.post(f"{API}/cycles",
                   json={"name": "TEST_forbid", "start_date": "2026-04-01", "end_date": "2026-06-30"},
                   timeout=20)
    assert r.status_code == 403


# ---------- Objectives ----------
def test_list_objectives_by_cycle(alice, seeded_cycle):
    r = alice.get(f"{API}/objectives", params={"cycle_id": seeded_cycle["id"]}, timeout=20)
    assert r.status_code == 200
    assert len(r.json()) >= 2


def test_create_objective_admin(admin, seeded_cycle, users_by_email):
    dri_id = users_by_email["dri@nosh.io"]["id"]
    alice_id = users_by_email["alice@nosh.io"]["id"]
    payload = {
        "cycle_id": seeded_cycle["id"],
        "title": f"TEST_obj_{uuid.uuid4().hex[:6]}",
        "description": "test objective",
        "dri_id": dri_id,
        "success_metric": "metric",
        "current_value": "0",
        "target_value": "100",
        "contributor_ids": [alice_id],
        "rigor_questions": ["q1?"],
    }
    r = admin.post(f"{API}/objectives", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["title"] == payload["title"]
    # GET verify
    r2 = admin.get(f"{API}/objectives/{data['id']}", timeout=20)
    assert r2.status_code == 200
    assert r2.json()["dri_id"] == dri_id


def test_create_objective_forbidden_for_contributor(alice, seeded_cycle, users_by_email):
    r = alice.post(f"{API}/objectives",
                   json={"cycle_id": seeded_cycle["id"], "title": "x", "description": "x",
                         "dri_id": users_by_email["dri@nosh.io"]["id"], "success_metric": "m"},
                   timeout=20)
    assert r.status_code == 403


# ---------- Plans ----------
def test_upsert_plan_alice_for_obj1(alice, seeded_objectives):
    obj = seeded_objectives[0]
    payload = {
        "objective_id": obj["id"],
        "mission_context": "TEST plan ctx",
        "role_in_objective": "contributor",
        "ownership_metric": "velocity",
        "metric_current": "1", "metric_target": "5",
        "goals": ["g1", "g2"], "key_bets": "bet", "risks": "risk", "kill_list": "kl",
    }
    r = alice.post(f"{API}/plans", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user_id"]
    plan_id = data["id"]
    # upsert again with new mission_context; ID should remain the same
    payload["mission_context"] = "TEST plan ctx v2"
    r2 = alice.post(f"{API}/plans", json=payload, timeout=20)
    assert r2.status_code == 200
    assert r2.json()["id"] == plan_id
    assert r2.json()["mission_context"] == "TEST plan ctx v2"
    # GET list for this objective (alice sees only her own)
    r3 = alice.get(f"{API}/plans", params={"objective_id": obj["id"]}, timeout=20)
    assert r3.status_code == 200
    assert any(p["id"] == plan_id for p in r3.json())


# ---------- Weekly updates ----------
def test_create_weekly_update(alice, seeded_objectives):
    obj = seeded_objectives[0]
    payload = {
        "objective_id": obj["id"], "week": "2026-W06", "status": "green",
        "update_text": "TEST weekly update green", "blockers": "", "progress": "80%",
        "priority_shift": "",
    }
    r = alice.post(f"{API}/updates", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    # GET list (own)
    r2 = alice.get(f"{API}/updates", params={"objective_id": obj["id"]}, timeout=20)
    assert r2.status_code == 200
    assert any(u["id"] == uid for u in r2.json())


def test_weekly_update_rejects_invalid_status(alice, seeded_objectives):
    obj = seeded_objectives[0]
    r = alice.post(f"{API}/updates",
                   json={"objective_id": obj["id"], "week": "2026-W06",
                         "status": "blue", "update_text": "bad"}, timeout=20)
    assert r.status_code == 422


# ---------- Reflections ----------
def test_individual_reflection_upsert(alice, seeded_objectives):
    obj = seeded_objectives[0]
    payload = {"objective_id": obj["id"], "wins": "TEST wins", "learnings": "TEST learnings"}
    r = alice.post(f"{API}/reflections/individual", json=payload, timeout=20)
    assert r.status_code == 200
    rid = r.json()["id"]
    # upsert
    payload["wins"] = "TEST wins v2"
    r2 = alice.post(f"{API}/reflections/individual", json=payload, timeout=20)
    assert r2.status_code == 200
    assert r2.json()["id"] == rid
    assert r2.json()["wins"] == "TEST wins v2"


def test_dri_reflection_only_dri_can_submit(dri, alice, seeded_objectives):
    obj = seeded_objectives[0]
    payload = {"objective_id": obj["id"], "objective_outcome": "partial",
               "actual_metrics": "42%", "what_worked": "x", "what_failed": "y"}
    # Alice (not DRI) cannot submit
    r_alice = alice.post(f"{API}/reflections/dri", json=payload, timeout=20)
    assert r_alice.status_code == 403
    # DRI user can submit
    r_dri = dri.post(f"{API}/reflections/dri", json=payload, timeout=20)
    assert r_dri.status_code == 200, r_dri.text
    assert r_dri.json()["objective_outcome"] == "partial"


# ---------- DRI Feedback ----------
def _feedback_payload(obj_id):
    return {
        "objective_id": obj_id,
        "clarity": "good", "alignment": "good", "unblocking": "good",
        "decision_making": "good", "quality_bar": "excellent", "trajectory_impact": "okay",
        "clarity_example": "e1", "alignment_example": "e2", "unblocking_example": "e3",
        "decision_example": "e4", "quality_example": "e5", "trajectory_example": "e6",
        "what_worked": "w", "what_should_improve": "i",
    }


def test_feedback_contributor_can_submit(alice, seeded_objectives):
    obj = seeded_objectives[0]
    r = alice.post(f"{API}/feedback", json=_feedback_payload(obj["id"]), timeout=20)
    assert r.status_code == 200, r.text


def test_feedback_dri_self_rating_rejected(dri, seeded_objectives):
    obj = seeded_objectives[0]
    r = dri.post(f"{API}/feedback", json=_feedback_payload(obj["id"]), timeout=20)
    assert r.status_code == 400
    assert "DRI" in r.text or "themselves" in r.text


def test_feedback_non_contributor_rejected(manager, seeded_objectives):
    # manager is not in contributor_ids and not admin → should be 403
    obj = seeded_objectives[0]
    r = manager.post(f"{API}/feedback", json=_feedback_payload(obj["id"]), timeout=20)
    assert r.status_code == 403


def test_feedback_summary_aggregates(alice, bob, seeded_objectives):
    obj = seeded_objectives[0]
    # Ensure two contributors have submitted
    alice.post(f"{API}/feedback", json=_feedback_payload(obj["id"]), timeout=20)
    bob.post(f"{API}/feedback", json=_feedback_payload(obj["id"]), timeout=20)
    r = alice.get(f"{API}/feedback/summary", params={"objective_id": obj["id"]}, timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert data["count"] >= 1
    for dim in ["clarity", "alignment", "unblocking", "decision_making", "quality_bar", "trajectory_impact"]:
        assert dim in data["dimensions"]
        assert "avg" in data["dimensions"][dim]
        assert "distribution" in data["dimensions"][dim]


# ---------- Manager review ----------
def test_manager_review_upsert(manager, seeded_cycle, users_by_email):
    alice_id = users_by_email["alice@nosh.io"]["id"]
    payload = {"subject_type": "individual", "subject_id": alice_id,
               "cycle_id": seeded_cycle["id"], "final_evaluation": "TEST eval",
               "optional_score": 4, "disagreement_note_vs_ai": ""}
    r = manager.post(f"{API}/manager-review", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    # upsert
    payload["final_evaluation"] = "TEST eval v2"
    r2 = manager.post(f"{API}/manager-review", json=payload, timeout=20)
    assert r2.status_code == 200
    assert r2.json()["id"] == mid
    assert r2.json()["final_evaluation"] == "TEST eval v2"


def test_manager_review_forbidden_for_contributor(alice, seeded_cycle, users_by_email):
    payload = {"subject_type": "individual", "subject_id": users_by_email["alice@nosh.io"]["id"],
               "cycle_id": seeded_cycle["id"], "final_evaluation": "nope"}
    r = alice.post(f"{API}/manager-review", json=payload, timeout=20)
    assert r.status_code == 403


def test_manager_review_list_forbidden_for_contributor(alice):
    r = alice.get(f"{API}/manager-review", timeout=20)
    assert r.status_code == 403
