export interface ApiErrorBody {
  code: string;
  message: string;
  referenceId?: string;
  currentVersion?: number;
}

export class ClientApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
  get code() {
    return this.body.code;
  }
}

/** JSON fetch with the contract's error envelope. Network failures surface as code NETWORK (outcome unknown). */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ClientApiError(0, { code: "NETWORK", message: "Connection problem. Retrying is safe." });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ClientApiError(res.status, data.error ?? { code: "SERVICE_UNAVAILABLE", message: "Request failed" });
  }
  return data as T;
}

export const newActionId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Send an action with one stable actionId; on a network failure retry with the same ID, which the
 * server treats as the same request (it cannot be applied twice).
 */
export async function sendIdempotent<T>(path: string, body: Record<string, unknown>, retries = 2): Promise<T> {
  const payload = { actionId: newActionId(), ...body };
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<T>(path, { method: "POST", body: payload });
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "NETWORK" && attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}
