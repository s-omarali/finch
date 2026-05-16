from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header

from backend.db import get_supabase
from backend.src.routers.deps import get_auth_user

router = APIRouter(prefix="/api/v1", tags=["dashboard"])

@router.get("/dashboard")
def get_dashboard(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    auth_user = get_auth_user(authorization)
    user_id = auth_user.id
    sb = get_supabase()

    user_row = sb.table("users").select("gigs, estimated_marginal_tax_rate").eq("id", user_id).limit(1).execute().data or []
    if not user_row:
        sb.table("users").upsert(
            {
                "id": user_id,
                "email": auth_user.email,
                "full_name": auth_user.user_metadata.get("full_name", ""),
                "gigs": ["Content Creator"],
                "state": "CA",
                "estimated_marginal_tax_rate": 0.24,
                "onboarding_completed": False,
            }
        ).execute()
        user_row = sb.table("users").select("gigs, estimated_marginal_tax_rate").eq("id", user_id).limit(1).execute().data or []

    user = user_row[0] if user_row else {}
    gigs = user.get("gigs") or ["Content Creator"]
    tax_rate = float(user.get("estimated_marginal_tax_rate", 0.24))

    transactions_db = sb.table("transactions").select("*").eq("user_id", user_id).order("date", desc=True).execute().data or []
    deductions_db = sb.table("deductions").select("*").eq("user_id", user_id).execute().data or []
    signals_db = sb.table("optimization_signals").select("*").eq("user_id", user_id).execute().data or []

    transactions = [
        {
            "id": t["id"],
            "date": t["date"],
            "merchant": t["merchant"],
            "amount": t["amount"],
            "type": t["type"],
            "category": t["category"],
            "confidenceScore": t.get("confidence_score", 1),
            "source": t["source"],
            "notes": t.get("notes"),
        }
        for t in transactions_db
    ]

    deductions = [
        {
            "id": d["id"],
            "title": d["title"],
            "category": d["category"],
            "status": d["status"],
            "potentialSavings": d.get("potential_savings", 0),
            "detail": d.get("detail", ""),
        }
        for d in deductions_db
    ]

    signals = [
        {
            "id": s["id"],
            "type": s["type"],
            "gasSpend": s.get("gas_spend", 0),
            "detectedPeriodLabel": s.get("detected_period_label", ""),
        }
        for s in signals_db
    ]

    total_income = round(sum(float(t["amount"]) for t in transactions if t.get("type") == "income"), 2)
    total_deductions = round(sum(float(d.get("potentialSavings", 0)) for d in deductions), 2)
    tax_liability = max(round(total_income * tax_rate - total_deductions, 2), 0)

    return {
        "metrics": {
            "totalIncome": total_income,
            "estimatedTaxLiability": tax_liability,
            "totalDeductionsFound": total_deductions,
        },
        "transactions": transactions,
        "deductions": deductions,
        "optimizationSignals": signals,
    }
