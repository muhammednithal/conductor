from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr

from app.auth.service import create_token, hash_password, verify_password
from app.database import get_conn

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    token: str


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(req: RegisterRequest) -> TokenResponse:
    async with get_conn() as conn:
        existing = await conn.fetchrow("SELECT id FROM users WHERE email = $1", req.email)
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
        row = await conn.fetchrow(
            "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
            req.email,
            hash_password(req.password),
        )
    return TokenResponse(token=create_token(str(row["id"])))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest) -> TokenResponse:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id, password_hash FROM users WHERE email = $1", req.email
        )
    if not row or not verify_password(req.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return TokenResponse(token=create_token(str(row["id"])))


@router.post("/refresh", response_model=TokenResponse)
async def refresh(creds: TokenResponse) -> TokenResponse:
    from app.auth.service import decode_token
    from jose import JWTError

    try:
        user_id = decode_token(creds.token)
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    return TokenResponse(token=create_token(user_id))