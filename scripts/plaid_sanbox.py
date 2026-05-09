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

get_request = TransactionsGetRequest(
    access_token=access_token,
    start_date=date(2026, 1, 1),
    end_date=date(2026, 5, 1),  # or date.today()
)
sync_request = TransactionsSyncRequest(access_token=access_token)
sync_response = client.transactions_sync(sync_request)
get_response = client.transactions_get(get_request).to_dict()

print("\nTransactions:")
# print(json.dumps(sync_response['added'], indent=2, default=str))
print(json.dumps(get_response["transactions"], indent=2, default=str))


