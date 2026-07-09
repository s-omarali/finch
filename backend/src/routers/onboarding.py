from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header

from backend.db import get_supabase
from backend.src.routers.deps import get_user_id
from backend.src.schemas.requests import OnboardingPayload

router = APIRouter(prefix="/api/v1", tags=["onboarding"])


@router.post("/onboarding")
def save_onboarding(
    payload: OnboardingPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = get_user_id(authorization)
    sb = get_supabase()

    auth_user = sb.auth.admin.get_user_by_id(user_id).user
    sb.table("users").upsert({
        "id": user_id,
        "email": auth_user.email,
        "full_name": auth_user.user_metadata.get("full_name", ""),
        "gigs": payload.gigs,
        "state": "TX",
        "estimated_marginal_tax_rate": 0.24,
        "onboarding_completed": True,
        "subscriptions": payload.subscriptions
    }).execute()

    for integration in payload.integrations:
        sb.table("integrations").upsert({
            "user_id": user_id,
            "integration_id": integration.get("id"),
            "name": integration.get("name"),
            "connected": integration.get("connected", False),
        }, on_conflict="user_id,integration_id").execute()

    profile = sb.table("users").select("*").eq("id", user_id).single().execute().data
    integrations = sb.table("integrations").select("*").eq("user_id", user_id).execute().data or []

    return {"profile": profile, "integrations": integrations}
