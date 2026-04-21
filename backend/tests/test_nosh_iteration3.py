"""
Nosh Focus Cycles - Iteration 3 backend tests.
Covers:
 - AI endpoints after refactor to /app/backend/ai/__init__.py (status, evaluate-objective, gating)
 - Brute-force lockout (x-forwarded-for fix) - 5 fails -> 6th = 429
 - GET /api/feedback/my-dri-view (new) - shape, privacy (no user_id), empty for non-DRI
 - POST /api/auth/forgot-password fallback email logs [EMAIL_FALLBACK]
"""
import os
import re
import time
import uuid
import pytest
import requests
import subprocess
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
assert BASE_URL
API = f"{BASE_URL}/api"

MONGO_URL = None
DB_NAME = None
with open("/app/backend/.env") as f:
    for line in f:
        if line.startswith("MONGO_URL="):
            MONGO_URL = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("DB_NAME="):
            DB_NAME = line.split("=", 1)[1].strip().strip('"')
mongo = MongoClient(MONGO_URL)[DB_NAME]


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} -> {r.status_code}: {r.text}"
    return s


@pytest.fixture(scope="session")
def admin():
    mongo.login_attempts.delete_many({})
    return _login("admin@nosh.io", "admin123")


@pytest.fixture(scope="session")
def manager():
    return _login("manager@nosh.io", "password123")


@pytest.fixture(scope="session")
def dri():
    return _login("dri@nosh.io", "password123")


@pytest.fixture(scope="session")
def alice():
    return _login("alice@nosh.io", "password123")


# ===================== AI REFACTOR REGRESSION =====================
class TestAIRefactor:
    def test_ai_status_still_works(self, admin):
        r = admin.get(f"{API}/ai/status", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data.get("enabled") is True
        assert data.get("model") == "gemini-3-flash-preview"

    def test_ai_evaluate_objective_as_manager(self, manager, admin):
        objs = admin.get(f"{API}/objectives", timeout=20).json()
        assert len(objs) >= 1
        r = manager.post(
            f"{API}/ai/evaluate-objective",
            params={"objective_id": objs[0]["id"]},
            timeout=120,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        data = r.json()
        assert data.get("kind") == "objective"
        out = data.get("output") or {}
        assert "objective_outcome_summary" in out
        assert "leadership_signals" in out
        assert "tentative_dri_score" in out

    def test_ai_evaluate_forbidden_for_contributor(self, alice, admin):
        objs = admin.get(f"{API}/objectives", timeout=20).json()
        users = admin.get(f"{API}/users", timeout=20).json()
        alice_id = next(u["id"] for u in users if u["email"] == "alice@nosh.io")
        r = alice.post(
            f"{API}/ai/evaluate-individual",
            params={"user_id": alice_id, "objective_id": objs[0]["id"]},
            timeout=20,
        )
        assert r.status_code == 403
        r2 = alice.post(
            f"{API}/ai/evaluate-objective",
            params={"objective_id": objs[0]["id"]},
            timeout=20,
        )
        assert r2.status_code == 403


# ===================== BRUTE FORCE (XFF FIX) =====================
class TestBruteForceXFF:
    def test_six_fails_on_nonexistent_email_locks_out(self):
        ts = int(time.time())
        ghost = f"nobody_{ts}_{uuid.uuid4().hex[:6]}@nosh.io"
        mongo.login_attempts.delete_many({"identifier": {"$regex": re.escape(ghost)}})
        s = requests.Session()
        try:
            for i in range(5):
                r = s.post(f"{API}/auth/login",
                           json={"email": ghost, "password": "wrong"}, timeout=20)
                assert r.status_code == 401, f"attempt {i+1}: {r.status_code}"
            r6 = s.post(f"{API}/auth/login",
                        json={"email": ghost, "password": "wrong"}, timeout=20)
            assert r6.status_code == 429, (
                f"expected 429 on 6th attempt, got {r6.status_code}: {r6.text}")
        finally:
            mongo.login_attempts.delete_many({"identifier": {"$regex": re.escape(ghost)}})


# ===================== DRI SELF-VIEW FEEDBACK =====================
class TestDRISelfView:
    def test_dri_sees_aggregated_feedback(self, dri):
        r = dri.get(f"{API}/feedback/my-dri-view", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list), "response should be a list"
        assert len(data) >= 1, "dri@nosh.io should DRI at least one objective"
        # Find the objective that has feedback (count > 0)
        with_fb = [row for row in data if row.get("count", 0) > 0]
        assert with_fb, "expected at least one objective with feedback"
        row = with_fb[0]
        assert "objective" in row and "title" in row["objective"]
        assert "count" in row and row["count"] >= 1
        # dimensions shape - 6 dims
        dims = row.get("dimensions") or {}
        for d in ["clarity", "alignment", "unblocking",
                  "decision_making", "quality_bar", "trajectory_impact"]:
            assert d in dims, f"missing dimension {d}"
            assert "avg" in dims[d]
            assert "distribution" in dims[d]
        assert isinstance(row.get("what_worked"), list)
        assert isinstance(row.get("what_should_improve"), list)

    def test_dri_view_has_empty_state_for_no_feedback_objective(self, dri):
        r = dri.get(f"{API}/feedback/my-dri-view", timeout=20)
        data = r.json()
        # at least one objective present; any with count==0 should have empty lists
        zeros = [row for row in data if row.get("count", 0) == 0]
        for row in zeros:
            assert row["what_worked"] == []
            assert row["what_should_improve"] == []
            for d, v in row["dimensions"].items():
                assert v["avg"] == 0

    def test_dri_view_privacy_no_user_id(self, dri):
        # Raw JSON must not contain any "user_id" keys attributing quotes
        r = dri.get(f"{API}/feedback/my-dri-view", timeout=20)
        raw = r.text
        # quotes are plain strings; there must be no "user_id" key in the payload
        assert '"user_id"' not in raw, "user_id leaked in dri-view response"

    def test_alice_non_dri_returns_empty_list(self, alice):
        r = alice.get(f"{API}/feedback/my-dri-view", timeout=20)
        assert r.status_code == 200
        assert r.json() == []


# ===================== FORGOT PASSWORD EMAIL FALLBACK =====================
class TestForgotPasswordFallback:
    def test_forgot_password_returns_200_and_logs_fallback(self):
        # truncate backend log position marker
        r = requests.post(
            f"{API}/auth/forgot-password",
            json={"email": "admin@nosh.io"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # verify token was created in mongo
        user = mongo.users.find_one({"email": "admin@nosh.io"})
        tok = mongo.password_reset_tokens.find_one(
            {"user_id": user["id"], "used": False}, sort=[("created_at", -1)])
        assert tok, "reset token should be persisted"
        # Check backend supervisor log for [EMAIL_FALLBACK] line
        # Log location: /var/log/supervisor/backend.*.log
        time.sleep(1)  # allow log flush
        try:
            out = subprocess.check_output(
                "tail -n 400 /var/log/supervisor/backend.*.log 2>/dev/null | "
                "grep -c 'EMAIL_FALLBACK'",
                shell=True, text=True).strip()
            count = int(out) if out.isdigit() else 0
        except Exception:
            count = 0
        assert count >= 1, (
            "Expected [EMAIL_FALLBACK] log line since RESEND_API_KEY is empty. "
            f"grep count = {count}")
        # cleanup token
        mongo.password_reset_tokens.delete_one({"id": tok["id"]})
