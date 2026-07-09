from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class OnboardingPayload(BaseModel):
    gigs: list[str]
    integrations: list[dict[str, Any]]
    subscriptions: list[str]


class ReceiptScanPayload(BaseModel):
    fileName: str
    amount: float | None = None
    merchant: str | None = None
    date: str | None = None
    suggestedCategory: str = "Uncategorized"


class MileagePayload(BaseModel):
    state: str
    mpg: float
    businessMiles: float
    gasSpend: float


class FilingPreparationPayload(BaseModel):
    legalName: str
    ssnLast4: str
    filingStatus: str
    dependents: int
    address1: str
    city: str
    state: str
    zipCode: str
    acceptDisclosure: bool


class FilingRunPayload(BaseModel):
    provider: str


class WaitlistJoinPayload(BaseModel):
    email: str


class AccessVerifyPayload(BaseModel):
    code: str
