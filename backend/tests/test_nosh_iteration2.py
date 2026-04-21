"""
Nosh Focus Cycles - Iteration 2 backend tests.
Covers: brute-force lockout, forgot/reset password, users privacy scoping,
AI status + evaluate-individual + evaluate-objective + evaluations list,
role gating on AI endpoints.
"""
import os
import re
import uuid
import json
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

# Direct mongo client for seeding/cleanup - read from backend .env
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
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def admin():
    mongo.login_attempts.delete_many({})  # clear stale locks before tests
    return _login(os.environ["TEST_ADMIN_EMAIL"] if "TEST_ADMIN_EMAIL" in os.environ else os.environ.get("ADMIN_EMAIL", ""),
                  os.environ["TEST_ADMIN_PW"] if "TEST_ADMIN_PW" in os.environ else os.environ.get("ADMIN_PASSWORD", ""))


@pytest.fixture(scope="session")
def manager():
    return _login(os.environ.get("TEST_MANAGER_EMAIL", "manager@nosh.io"),
                  os.environ.get("TEST_USER_PW", ""))


@pytest.fixture(scope="session")
def alice():
    return _login(os.environ.get("TEST_ALICE_EMAIL", "alice@nosh.io"),
                  os.environ.get("TEST_USER_PW", ""))


@pytest.fixture(scope="session")
def users_by_email(admin):
    r = admin.get(f"{API}/users", timeout=20)
    return {u["email"]: u for u in r.json()}


@pytest.fixture(scope="session")
def first_objective(admin):
    r = admin.get(f"{API}/objectives", timeout=20)
    assert r.status_code == 200
    objs = r.json()
    assert len(objs) >= 1
    return objs[0]


# ========== BRUTE FORCE LOCKOUT ==========
class TestBruteForce:
    def test_lockout_after_5_failures_and_clear_on_success(self):
        # Use a unique test email to avoid locking real users
        test_email = f"bruteforce_{uuid.uuid4().hex[:8]}@nosh.io"
        # We need a real user so we can test "clear on success" too.
        # Use alice's email BUT first clear attempts; then after 5 fails try 6th is 429.
        # To avoid polluting alice, use a brand-new account.
        # Register a throwaway user via admin
        admin_s = _login(os.environ.get("TEST_ADMIN_EMAIL") or os.environ.get("ADMIN_EMAIL", ""), os.environ.get("TEST_ADMIN_PW") or os.environ.get("ADMIN_PASSWORD", ""))
        password = "Bf-" + uuid.uuid4().hex[:12]
        resp = admin_s.post(f"{API}/users", json={
            "email": test_email, "password": password, "name": "BF Test", "role": "contributor"
        }, timeout=20)
        assert resp.status_code == 200, resp.text

        try:
            s = requests.Session()
            # Make 5 failed attempts
            for i in range(5):
                r = s.post(f"{API}/auth/login",
                           json={"email": test_email, "password": "wrong"}, timeout=20)
                assert r.status_code == 401, f"attempt {i+1}: {r.status_code} {r.text}"

            # 6th attempt should be 429 even with WRONG password
            r = s.post(f"{API}/auth/login",
                       json={"email": test_email, "password": "wrong"}, timeout=20)
            assert r.status_code == 429, f"expected 429, got {r.status_code}: {r.text}"
            assert "minutes" in r.text.lower() or "attempt" in r.text.lower()

            # Even CORRECT password is blocked while locked
            r = s.post(f"{API}/auth/login",
                       json={"email": test_email, "password": password}, timeout=20)
            assert r.status_code == 429, f"lockout bypass: {r.status_code}"

            # Clear the lockout via mongo (simulating 15min passing)
            # and verify successful login clears failures
            mongo.login_attempts.delete_many({"identifier": {"$regex": re.escape(test_email)}})

            r = s.post(f"{API}/auth/login",
                       json={"email": test_email, "password": password}, timeout=20)
            assert r.status_code == 200, f"login should succeed after clear: {r.text}"

            # Now make 3 fails, then succeed, then another 3 fails -> still no lockout (since cleared)
            for _ in range(3):
                s.post(f"{API}/auth/login",
                       json={"email": test_email, "password": "wrong"}, timeout=20)
            r = s.post(f"{API}/auth/login",
                       json={"email": test_email, "password": password}, timeout=20)
            assert r.status_code == 200, "success after <5 fails should clear counter"
            for _ in range(3):
                r2 = s.post(f"{API}/auth/login",
                            json={"email": test_email, "password": "wrong"}, timeout=20)
                assert r2.status_code == 401
        finally:
            # cleanup
            mongo.users.delete_many({"email": test_email})
            mongo.login_attempts.delete_many({"identifier": {"$regex": re.escape(test_email)}})


# ========== FORGOT / RESET PASSWORD ==========
class TestPasswordReset:
    def test_forgot_password_existing_user_creates_token(self):
        r = requests.post(f"{API}/auth/forgot-password",
                          json={"email": "alice@nosh.io"}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        # verify token persisted in mongo
        user = mongo.users.find_one({"email": "alice@nosh.io"})
        tok_doc = mongo.password_reset_tokens.find_one(
            {"user_id": user["id"], "used": False}, sort=[("created_at", -1)])
        assert tok_doc is not None
        assert tok_doc["token"]

    def test_forgot_password_nonexistent_email_no_leak(self):
        r = requests.post(f"{API}/auth/forgot-password",
                          json={"email": "nobody_xyz_404@nosh.io"}, timeout=20)
        # must be 200 to avoid leaking existence
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # no token created for ghost email
        assert mongo.password_reset_tokens.find_one({"user_id": "nobody_xyz_404"}) is None

    def test_reset_password_valid_token_then_reuse_rejected(self):
        # create a throwaway user
        admin_s = _login(os.environ.get("TEST_ADMIN_EMAIL") or os.environ.get("ADMIN_EMAIL", ""), os.environ.get("TEST_ADMIN_PW") or os.environ.get("ADMIN_PASSWORD", ""))
        email = f"reset_{uuid.uuid4().hex[:8]}@nosh.io"
        old_pw = "Old-" + uuid.uuid4().hex[:12]
        new_pw = "New-" + uuid.uuid4().hex[:12]
        r = admin_s.post(f"{API}/users", json={
            "email": email, "password": old_pw, "name": "Reset Test", "role": "contributor"
        }, timeout=20)
        assert r.status_code == 200

        try:
            # request reset
            r = requests.post(f"{API}/auth/forgot-password", json={"email": email}, timeout=20)
            assert r.status_code == 200

            # fetch token from db
            user = mongo.users.find_one({"email": email})
            tok = mongo.password_reset_tokens.find_one(
                {"user_id": user["id"], "used": False}, sort=[("created_at", -1)])
            assert tok, "token not created"

            # reset with valid token
            r = requests.post(f"{API}/auth/reset-password",
                              json={"token": tok["token"], "new_password": new_pw}, timeout=20)
            assert r.status_code == 200, r.text

            # login with new password works
            r = requests.post(f"{API}/auth/login",
                              json={"email": email, "password": new_pw}, timeout=20)
            assert r.status_code == 200, "new password should work"

            # old password rejected
            r = requests.post(f"{API}/auth/login",
                              json={"email": email, "password": old_pw}, timeout=20)
            assert r.status_code == 401

            # reused token rejected
            r = requests.post(f"{API}/auth/reset-password",
                              json={"token": tok["token"], "new_password": "Ra-" + uuid.uuid4().hex[:10]}, timeout=20)
            assert r.status_code == 400, f"reused token should be 400, got {r.status_code}"
        finally:
            mongo.users.delete_many({"email": email})
            if 'user' in dir():
                mongo.password_reset_tokens.delete_many({"user_id": user["id"]})

    def test_reset_password_invalid_token(self):
        r = requests.post(f"{API}/auth/reset-password",
                          json={"token": "totally-bogus-token", "new_password": "Bg-" + uuid.uuid4().hex[:10]},
                          timeout=20)
        assert r.status_code == 400

    def test_reset_password_expired_token(self):
        # insert a manually expired token for an existing user
        from datetime import datetime, timezone, timedelta
        user = mongo.users.find_one({"email": "bob@nosh.io"})
        expired_tok = f"expired_{uuid.uuid4().hex}"
        mongo.password_reset_tokens.insert_one({
            "id": str(uuid.uuid4()),
            "token": expired_tok,
            "user_id": user["id"],
            "expires_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
            "used": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            r = requests.post(f"{API}/auth/reset-password",
                              json={"token": expired_tok, "new_password": "Ex-" + uuid.uuid4().hex[:10]},
                              timeout=20)
            assert r.status_code == 400
            assert "expired" in r.text.lower()
        finally:
            mongo.password_reset_tokens.delete_many({"token": expired_tok})


# ========== USERS PRIVACY SCOPING ==========
class TestUsersPrivacy:
    def test_admin_sees_full_fields(self, admin):
        r = admin.get(f"{API}/users", timeout=20)
        assert r.status_code == 200
        users = r.json()
        assert len(users) > 0
        u = users[0]
        assert "email" in u
        assert "created_at" in u
        assert "id" in u and "name" in u and "role" in u
        assert "password_hash" not in u
        assert "_id" not in u

    def test_manager_sees_full_fields(self, manager):
        r = manager.get(f"{API}/users", timeout=20)
        assert r.status_code == 200
        users = r.json()
        u = users[0]
        assert "email" in u
        assert "created_at" in u

    def test_contributor_sees_only_id_name_role(self, alice):
        r = alice.get(f"{API}/users", timeout=20)
        assert r.status_code == 200
        users = r.json()
        assert len(users) > 0
        for u in users:
            assert set(u.keys()) == {"id", "name", "role"}, f"leak: {u.keys()}"
            assert "email" not in u
            assert "created_at" not in u
            assert "password_hash" not in u


# ========== AI ENDPOINTS ==========
class TestAI:
    def test_ai_status_enabled(self, admin):
        r = admin.get(f"{API}/ai/status", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data.get("enabled") is True
        assert data.get("model") == "gemini-3-flash-preview"

    def test_ai_evaluate_objective_as_manager(self, manager, first_objective):
        r = manager.post(
            f"{API}/ai/evaluate-objective",
            params={"objective_id": first_objective["id"]},
            timeout=120,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:500]}"
        data = r.json()
        assert data.get("kind") == "objective"
        assert data.get("objective_id") == first_objective["id"]
        out = data.get("output") or {}
        assert "objective_outcome_summary" in out
        assert "leadership_signals" in out
        ls = out["leadership_signals"]
        for k in ["clarity", "alignment", "decision_making", "unblocking", "quality_bar"]:
            assert k in ls
        assert "tentative_dri_score" in out
        assert 1 <= out["tentative_dri_score"] <= 5

    def test_ai_evaluate_individual_as_manager(self, manager, first_objective, users_by_email):
        alice_id = users_by_email["alice@nosh.io"]["id"]
        r = manager.post(
            f"{API}/ai/evaluate-individual",
            params={"user_id": alice_id, "objective_id": first_objective["id"]},
            timeout=120,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:500]}"
        data = r.json()
        assert data.get("kind") == "individual"
        out = data.get("output") or {}
        for k in ["executive_summary", "strength_signals", "risk_signals",
                  "tentative_score", "manager_attention_points"]:
            assert k in out, f"missing {k} in AI output"
        assert isinstance(out["strength_signals"], list)
        assert isinstance(out["risk_signals"], list)
        assert 1 <= out["tentative_score"] <= 5

    def test_ai_evaluate_forbidden_for_contributor(self, alice, first_objective, users_by_email):
        alice_id = users_by_email["alice@nosh.io"]["id"]
        r = alice.post(
            f"{API}/ai/evaluate-individual",
            params={"user_id": alice_id, "objective_id": first_objective["id"]},
            timeout=20,
        )
        assert r.status_code == 403
        r2 = alice.post(
            f"{API}/ai/evaluate-objective",
            params={"objective_id": first_objective["id"]},
            timeout=20,
        )
        assert r2.status_code == 403

    def test_ai_evaluations_list(self, manager):
        r = manager.get(f"{API}/ai/evaluations", timeout=20)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        # after prior tests we should have at least 2 records (1 objective + 1 individual)
        assert len(items) >= 1
        kinds = {i.get("kind") for i in items}
        assert "objective" in kinds or "individual" in kinds
        for i in items:
            assert "output" in i and "model" in i and "created_at" in i

    def test_ai_evaluations_forbidden_for_contributor(self, alice):
        r = alice.get(f"{API}/ai/evaluations", timeout=20)
        assert r.status_code == 403
