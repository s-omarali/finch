import plaid
from time import sleep
from plaid.api import plaid_api
from plaid.model.sandbox_public_token_create_request import SandboxPublicTokenCreateRequest
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.transactions_sync_request import TransactionsSyncRequest
from plaid.model.transactions_get_request import TransactionsGetRequest
from plaid.model.transactions_refresh_request import TransactionsRefreshRequest
from plaid.model.products import Products
from dotenv import load_dotenv
import os
import json
from pathlib import Path
from datetime import date
from plaid.model.sandbox_public_token_create_request_options import SandboxPublicTokenCreateRequestOptions
from typing import Any


load_dotenv(dotenv_path=Path(__file__).parent.parent / 'backend' / '.env')
plaid_secret = os.getenv("PLAID_ENV")
plaid_client = os.getenv("PLAID_CLIENT")



# start_date = 

# Available environments are
# 'Production'
# 'Sandbox'
try:

    configuration = plaid.Configuration(
        host=plaid.Environment.Sandbox,
        api_key={
            'clientId': plaid_client,
            'secret': plaid_secret,
        }
    )

    api_client = plaid.ApiClient(configuration)
    client = plaid_api.PlaidApi(api_client)
    print("Successful connection")
    
except plaid.ApiException as e:
    print(e)


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
print("\nTransactions:")
# print(json.dumps(sync_response['added'], indent=2, default=str))
print(json.dumps(dashboard_data, indent=2, default=str))

def _classify_transaction(merchant: str, amount: float, detailed_category: str) -> tuple[str, str]:
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
    return "Uncategorized", "Needs manual review"
def test_response(transactions: list[dict[str, Any]] = []):
    
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
                category, reason = _classify_transaction(merchant, amount, detailed_category)

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

test_response()