"""Unit tests for auth and protected endpoints."""
from fastapi.testclient import TestClient


def test_login_invalid_credentials(mock_db_pool):
    """Missing user should return 401."""
    mock_db_pool.fetchrow.return_value = None  # user not found

    from app.main import app
    with TestClient(app) as c:
        resp = c.post("/auth/login", json={"email": "x@x.com", "password": "bad"})
    assert resp.status_code == 401


def test_protected_endpoint_requires_token(mock_db_pool):
    """No bearer header → 403 (HTTPBearer rejects missing creds)."""
    from app.main import app
    with TestClient(app) as c:
        resp = c.get("/workflows")
    assert resp.status_code == 403


def test_protected_endpoint_rejects_bad_token(mock_db_pool):
    """Bad JWT → 401."""
    from app.main import app
    with TestClient(app) as c:
        resp = c.get("/workflows", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


def test_health_endpoint():
    """Health check should work without auth."""
    from app.main import app
    with TestClient(app) as c:
        resp = c.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}