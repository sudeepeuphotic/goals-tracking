# Shared test fixtures + credentials loaded from env (never commit real secrets).
import os
import requests

# Test credentials MUST be provided via environment to run the tests.
# In dev, the seeded admin/user credentials live in /app/backend/.env and
# /app/memory/test_credentials.md (both gitignored). Set these before
# invoking pytest:
#   TEST_ADMIN_EMAIL, TEST_ADMIN_PW, TEST_USER_PW,
#   TEST_MANAGER_EMAIL, TEST_DRI_EMAIL, TEST_ALICE_EMAIL, TEST_BOB_EMAIL
_DEFAULT_EMAILS = {
    "admin": "admin@nosh.io", "manager": "manager@nosh.io",
    "dri": "dri@nosh.io", "alice": "alice@nosh.io", "bob": "bob@nosh.io",
}

TEST_ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL") or os.environ.get("ADMIN_EMAIL") or _DEFAULT_EMAILS["admin"]
TEST_ADMIN_PW = os.environ.get("TEST_ADMIN_PW") or os.environ.get("ADMIN_PASSWORD") or ""
TEST_USER_PW = os.environ.get("TEST_USER_PW") or ""

TEST_MANAGER_EMAIL = os.environ.get("TEST_MANAGER_EMAIL", _DEFAULT_EMAILS["manager"])
TEST_DRI_EMAIL = os.environ.get("TEST_DRI_EMAIL", _DEFAULT_EMAILS["dri"])
TEST_ALICE_EMAIL = os.environ.get("TEST_ALICE_EMAIL", _DEFAULT_EMAILS["alice"])
TEST_BOB_EMAIL = os.environ.get("TEST_BOB_EMAIL", _DEFAULT_EMAILS["bob"])


def _require_creds():
    assert TEST_ADMIN_PW and TEST_USER_PW, (
        "Missing TEST_ADMIN_PW / TEST_USER_PW env vars. "
        "See /app/memory/test_credentials.md (gitignored)."
    )


def base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
    if not url:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    url = line.split("=", 1)[1].strip().rstrip("/")
    assert url, "REACT_APP_BACKEND_URL must be set"
    return url


def api_root():
    return f"{base_url()}/api"


def login_session(email: str, pw: str):
    _require_creds()
    s = requests.Session()
    r = s.post(f"{api_root()}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return s
