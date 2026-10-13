/**
 * Provider adapter contract (spec 06-payments-development). The game and ledger only consume
 * NormalizedPaymentEvent; provider payloads never leave the adapter. Nuvei/Paysafe adapters can be
 * added later behind this interface without touching game or ledger code.
 */
export type DepositMethod = "CARD" | "STABLECOIN";

export type DepositStatus = "CREATED" | "PENDING" | "CONFIRMED" | "CREDITED" | "EXPIRED" | "FAILED" | "REVIEW";
export type WithdrawalStatus =
  | "REQUESTED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "PROCESSING"
  | "PAID"
  | "REJECTED"
  | "CANCELLED"
  | "FAILED";

export interface NormalizedPaymentEvent {
  eventId: string; // unique per provider event; used for deduplication
  kind: "DEPOSIT" | "WITHDRAWAL";
  externalRef: string;
  status: DepositStatus | WithdrawalStatus;
  amountUnits: number;
  occurredAt: string;
}

export interface DepositIntentRequest {
  intentId: string;
  tokenUnits: number;
  method: DepositMethod;
  asset?: string;
  network?: string;
}

export interface PaymentAdapter {
  readonly id: string;
  createDepositIntent(req: DepositIntentRequest): Promise<{ externalRef: string; instructions: string }>;
  getDepositStatus(externalRef: string): Promise<DepositStatus | "UNKNOWN">;
  validateAndNormalizeEvent(rawBody: string, signature: string | null): NormalizedPaymentEvent;
  requestWithdrawal(req: { withdrawalId: string; amountUnits: number; destination: string }): Promise<{ externalRef: string }>;
  getWithdrawalStatus(externalRef: string): Promise<WithdrawalStatus | "UNKNOWN">;
}
