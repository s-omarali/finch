from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException

from backend.db import get_supabase
from backend.src.routers.deps import get_user_id
from backend.src.utils.crypto import decrypt_token, encrypt_token

router = APIRouter(prefix="/api/v1", tags=["plaid"])
from dotenv import load_dotenv
from pathlib import Path
from datetime import date
import json

import plaid
from time import sleep
from plaid.api import plaid_api
from plaid.model.sandbox_public_token_create_request import SandboxPublicTokenCreateRequest
from plaid.model.sandbox_public_token_create_request_options import SandboxPublicTokenCreateRequestOptions
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from plaid.model.transactions_get_request import TransactionsGetRequest
from plaid.model.transactions_refresh_request import TransactionsRefreshRequest
from plaid.model.products import Products
from plaid.model.sandbox_public_token_create_request_options import SandboxPublicTokenCreateRequestOptions
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest

load_dotenv(dotenv_path=Path(__file__).resolve().parents[2]/ "env")
plaid_client_key = os.getenv("PLAID_CLIENT")

# One client ID, but a separate secret per environment — PLAID_ENV holds the
# production secret, PLAID_SANDBOX_ENV the sandbox one. PLAID_ENVIRONMENT
# picks which pair (host + secret) is actually used.
_PLAID_ENVIRONMENTS = {
    "sandbox": (plaid.Environment.Sandbox, "PLAID_SANDBOX_ENV"),
    "production": (plaid.Environment.Production, "PLAID_ENV"),
}

def _plaid_host_and_secret() -> tuple[Any, str]:
    # Explicit opt-in only — defaults to sandbox even if production
    # credentials are present, so a stray/missing env var can't silently
    # point local/dev runs at real bank connections.
    name = os.getenv("PLAID_ENVIRONMENT", "sandbox").strip().lower()
    entry = _PLAID_ENVIRONMENTS.get(name)
    if entry is None:
        raise RuntimeError(
            f"Invalid PLAID_ENVIRONMENT={name!r}. Must be one of: {', '.join(_PLAID_ENVIRONMENTS)}"
        )
    host, secret_var = entry
    secret = os.getenv(secret_var, "").strip()
    if not secret:
        raise RuntimeError(f"Missing {secret_var} env var for PLAID_ENVIRONMENT={name!r}")
    return host, secret

def plaid_client() -> Any:
    try:
        host, secret = _plaid_host_and_secret()
        configuration = plaid.Configuration(
            host=host,
            api_key={
                'clientId': plaid_client_key,
                'secret': secret,
            }
        )

        api_client = plaid.ApiClient(configuration)
        client = plaid_api.PlaidApi(api_client)
        print("Successful connection")
    
    except plaid.ApiException as e:
        print(e)
    return client

def classify_transaction(merchant: str, amount: float, detailed_category: str) -> tuple[str, str]:
    text = f"{merchant} {detailed_category}".lower()
    if amount < 0:
        return "Income", "Likely payout or incoming transfer"
    if any(token in text for token in ["gas", "fuel", "shell", "chevron", "exxon"]):
        return "Vehicle", "Fuel spend may be deductible with business mileage"
    if any(token in text for token in ["adobe", "canva", "figma", "software", "subscription"]):
        return "Software", "Business software tools are often deductible"
    if any(token in text for token in ["airline", "hotel", "travel", "uber", "lyft", "delta"]):
        return "Travel", "Business travel may be deductible"
    if any(token in text for token in ["restaurant", "meal", "coffee"]):
        return "Meals", "Meals may be partially deductible"
    if any(token in text for token in ["office", "supplies", "best buy", "staples"]):
        return "Supplies", "Business supplies may be deductible"
    return " ", "Needs manual review"


def upsert_transactions(user_id: str, added: list[dict[str, Any]]) -> int:
    sb = get_supabase()
    inserted = 0
    for tx in added:
        plaid_tx_id = str(tx.get("transaction_id"))
        amount = float(tx.get("amount", 0.0))
        merchant = str(tx.get("merchant_name") or tx.get("name") or "Unknown")
        date = str(tx.get("date") or datetime.now(UTC).date())
        detailed_category = str(
            tx.get("personal_finance_category", {}).get("detailed")
            or (tx.get("category", [""])[0] if tx.get("category") else "")
        )
        category, reason = classify_transaction(merchant, amount, detailed_category)
        tx_type = "income" if amount < 0 else "expense"

        sb.table("transactions").upsert({
            "id": plaid_tx_id,
            "user_id": user_id,
            "date": date,
            "merchant": merchant,
            "amount": abs(amount),
            "type": tx_type,
            "category": category,
            "confidence_score": 0.9 if category != "Uncategorized" else 0.65,
            "source": "bank",
            "notes": reason,
        }).execute()
        inserted += 1
    return inserted

@router.get("/plaid-test-dashboard")
def get_plaid_test_user() -> dict[str, Any]:
    if os.getenv("PLAID_ENVIRONMENT", "sandbox").strip().lower() != "sandbox":
        raise HTTPException(
            status_code=400,
            detail="/plaid-test-dashboard uses Plaid's sandbox-only token creation API and is unavailable outside PLAID_ENVIRONMENT=sandbox.",
        )
    client = plaid_client()
    # create public token    
    pt_request = SandboxPublicTokenCreateRequest(
        institution_id='ins_109508',
        initial_products=[Products('transactions')],
        options=SandboxPublicTokenCreateRequestOptions(
        override_username='custom_user1',),
    )

    pt_response = client.sandbox_public_token_create(pt_request)
    public_token = pt_response['public_token']

    # exchange for access token
    exchange_request = ItemPublicTokenExchangeRequest(
        public_token=public_token
    )

    exchange_response = client.item_public_token_exchange(exchange_request)
    access_token = exchange_response['access_token']
    client.transactions_refresh(TransactionsRefreshRequest(access_token=access_token))
    print(f"Access Token: {access_token}")

    sleep(3) # wait

    get_request = TransactionsGetRequest(
        access_token=access_token,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 5, 1),  # or date.today()
    )
    sync_request = TransactionsSyncRequest(access_token=access_token)
    sync_response = client.transactions_sync(sync_request)
    get_response = client.transactions_get(get_request).to_dict()

    added_transactions = sync_response.get('added', [])
    dashboard_data = {
        "income": [txn for txn in added_transactions if txn.get('amount') < 0],
        "expenses": [txn for txn in added_transactions if txn.get('amount') >= 0]
    }

    # return dashboard_data
    transactions: list[dict[str, Any]] = []
    next_cursor: str | None = None
    has_more = True
    while has_more:
        if next_cursor is not None:
            sync_request = TransactionsSyncRequest(access_token=access_token, cursor=next_cursor)

        sync_response = client.transactions_sync(sync_request).to_dict()

        for tx in sync_response.get("added", []):
            amount = float(tx.get("amount", 0.0))
            merchant = str(tx.get("merchant_name") or tx.get("name") or "Unknown")
            detailed_category = str(
                tx.get("personal_finance_category", {}).get("detailed")
                or (tx.get("category", [""])[0] if tx.get("category") else "")
            )
            category, reason = classify_transaction(merchant, amount, detailed_category)

            transactions.append({
                "id": str(tx.get("transaction_id")),
                "date": str(tx.get("date")),
                "merchant": merchant,
                "amount": abs(amount),
                "type": "income" if amount < 0 else "expense",
                "category": category,
                "confidenceScore": 0.9 if category != "Uncategorized" else 0.65,
                "source": "bank",
                "notes": reason,
            })

        next_cursor = sync_response.get("next_cursor")
        has_more = bool(sync_response.get("has_more", False))
    total_income = round(sum(t["amount"] for t in transactions if t["type"] == "income"), 2)
    
    return {
        "metrics": {
            "totalIncome": total_income,
            "estimatedTaxLiability": round(total_income * 0.24, 2),
            "totalDeductionsFound": 0,
        },
        "transactions": transactions,
        "deductions": [],
        "optimizationSignals": [],
    }
    
PLACEHOLDER_INTEGRATIONS: list[dict[str, Any]] = [
    {"integration_id": "bank", "name": "Bank (Plaid)", "description": "Connect checking and credit accounts for auto transaction sync", "coming_soon": False},
    {"integration_id": "twitch", "name": "Twitch", "description": "Auto-import subscription, bits & ad revenue", "coming_soon": True},
    {"integration_id": "youtube", "name": "YouTube", "description": "Pull AdSense revenue, memberships & sponsorship payouts", "coming_soon": True},
    {"integration_id": "stripe", "name": "Stripe", "description": "Import card payments, subscriptions & platform payouts", "coming_soon": True},
    {"integration_id": "paypal", "name": "PayPal", "description": "Sync client payments, invoices & freelance transfers", "coming_soon": True},
    {"integration_id": "patreon", "name": "Patreon", "description": "Import tier membership income and platform fees", "coming_soon": True},
]


@router.get("/integrations")
def list_integrations(authorization: str | None = Header(default=None)) -> list[dict[str, Any]]:
    """Real per-user connection state, backed by public.integrations."""
    user_id = get_user_id(authorization)
    sb = get_supabase()

    existing = sb.table("integrations").select("*").eq("user_id", user_id).execute().data or []
    existing_by_id = {row["integration_id"]: row for row in existing}

    missing = [
        {"user_id": user_id, "integration_id": p["integration_id"], "name": p["name"], "connected": False}
        for p in PLACEHOLDER_INTEGRATIONS
        if p["integration_id"] not in existing_by_id
    ]
    if missing:
        sb.table("integrations").upsert(missing, on_conflict="user_id,integration_id").execute()
        existing = sb.table("integrations").select("*").eq("user_id", user_id).execute().data or []
        existing_by_id = {row["integration_id"]: row for row in existing}

    result: list[dict[str, Any]] = []
    for p in PLACEHOLDER_INTEGRATIONS:
        row = existing_by_id.get(p["integration_id"], {})
        result.append({
            "id": p["integration_id"],
            "name": p["name"],
            "description": p["description"],
            "connected": bool(row.get("connected", False)),
            "lastSyncAt": row.get("last_sync_at"),
            "comingSoon": p["coming_soon"],
        })
    return result


@router.get("/integrations/defaults")
def integration_defaults(authorization: str | None = Header(default=None)) -> list[dict[str, Any]]:
    """Deprecated alias for /integrations, kept during frontend rollout."""
    return list_integrations(authorization)


@router.post("/plaid/link-token")
def plaid_link_token(
    payload: dict[str, Any] | None = None,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    payload = payload or {}
    try:
        from plaid.model.country_code import CountryCode
        from plaid.model.link_token_create_request import LinkTokenCreateRequest
        from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
        from plaid.model.products import Products
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="plaid-python is not installed. Run 'uv sync' from repository root.",
        ) from exc

    user_id = get_user_id(authorization)
    client = plaid_client()
    request = LinkTokenCreateRequest(
        products=[Products("transactions")],
        client_name="GigATax",
        country_codes=[CountryCode("US")],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id=str(payload.get("client_user_id", user_id))),
    )
    response = client.link_token_create(request).to_dict()
    return {"link_token": response.get("link_token"), "expiration": response.get("expiration")}


@router.post("/plaid/exchange")
def plaid_exchange(
    payload: dict[str, Any],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    try:
        from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="plaid-python is not installed. Run 'uv sync' from repository root.",
        ) from exc

    user_id = get_user_id(authorization)
    client = plaid_client()
    public_token = str(payload.get("public_token", ""))
    if not public_token:
        raise HTTPException(status_code=400, detail="public_token is required")

    try:
        response = client.item_public_token_exchange(
            ItemPublicTokenExchangeRequest(public_token=public_token)
        ).to_dict()
    except plaid.ApiException as exc:
        raise HTTPException(status_code=502, detail=f"Plaid exchange failed: {exc.body}") from exc

    item_id = str(response.get("item_id"))
    access_token = str(response.get("access_token"))

    sb = get_supabase()
    sb.table("plaid_items").upsert({
        "user_id": user_id,
        "item_id": item_id,
        "access_token_encrypted": encrypt_token(access_token),
    }, on_conflict="item_id").execute()

    sb.table("integrations").upsert({
        "user_id": user_id,
        "integration_id": "bank",
        "name": "Bank (Plaid)",
        "connected": True,
        "last_sync_at": datetime.now(UTC).isoformat(),
    }, on_conflict="user_id,integration_id").execute()

    return {"item_id": item_id, "request_id": response.get("request_id")}


@router.post("/plaid/sync-all")
def plaid_sync_all(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    try:
        from plaid.model.transactions_sync_request import TransactionsSyncRequest
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="plaid-python is not installed. Run 'uv sync' from repository root.",
        ) from exc

    user_id = get_user_id(authorization)
    sb = get_supabase()

    items = (
        sb.table("plaid_items")
        .select("id, item_id, access_token_encrypted, sync_cursor")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )

    client = plaid_client()
    synced_item_ids: list[str] = []
    total_added = 0

    for row in items:
        item_id = str(row.get("item_id", ""))
        try:
            access_token = decrypt_token(str(row.get("access_token_encrypted", "")))
        except RuntimeError:
            continue

        cursor: str | None = row.get("sync_cursor")
        has_more = True
        while has_more:
            try:
                sync_response = client.transactions_sync(
                    TransactionsSyncRequest(access_token=access_token, cursor=cursor)
                ).to_dict()
            except plaid.ApiException as exc:
                raise HTTPException(
                    status_code=502, detail=f"Plaid sync failed for item {item_id}: {exc.body}"
                ) from exc
            added = sync_response.get("added", [])
            total_added += upsert_transactions(user_id, added)
            cursor = sync_response.get("next_cursor")
            has_more = bool(sync_response.get("has_more", False))

        sb.table("plaid_items").update({"sync_cursor": cursor}).eq("id", row["id"]).execute()
        if item_id:
            synced_item_ids.append(item_id)

    if items:
        sb.table("integrations").upsert({
            "user_id": user_id,
            "integration_id": "bank",
            "name": "Bank (Plaid)",
            "connected": True,
            "last_sync_at": datetime.now(UTC).isoformat(),
        }, on_conflict="user_id,integration_id").execute()

    return {"synced_item_ids": synced_item_ids, "total_added": total_added}


@router.post("/plaid/disconnect")
def plaid_disconnect(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    try:
        from plaid.model.item_remove_request import ItemRemoveRequest
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="plaid-python is not installed. Run 'uv sync' from repository root.",
        ) from exc

    user_id = get_user_id(authorization)
    sb = get_supabase()

    items = (
        sb.table("plaid_items")
        .select("id, item_id, access_token_encrypted")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    if not items:
        raise HTTPException(status_code=404, detail="No connected bank accounts found")

    client = plaid_client()
    removed_item_ids: list[str] = []
    errors: list[str] = []

    for row in items:
        item_id = str(row.get("item_id", ""))
        try:
            access_token = decrypt_token(str(row.get("access_token_encrypted", "")))
            client.item_remove(ItemRemoveRequest(access_token=access_token))
        except (RuntimeError, plaid.ApiException) as exc:
            detail = exc.body if isinstance(exc, plaid.ApiException) else str(exc)
            errors.append(f"{item_id}: {detail}")
            continue

        sb.table("plaid_items").delete().eq("id", row["id"]).execute()
        removed_item_ids.append(item_id)

    if removed_item_ids:
        sb.table("integrations").update({
            "connected": False,
            "last_sync_at": None,
        }).eq("user_id", user_id).eq("integration_id", "bank").execute()
    elif errors:
        raise HTTPException(status_code=502, detail=f"Plaid item removal failed: {'; '.join(errors)}")

    return {"removed_item_ids": removed_item_ids, "errors": errors}
