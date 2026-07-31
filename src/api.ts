import type { CreateReservationInput, Dashboard, Reservation } from "../shared/domain";
import type { AuthSession } from "../shared/auth";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public correlationId?: string) {
    super(message);
  }
}

let csrfToken = "";
export function setCsrfToken(value: string) { csrfToken = value; }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...((options?.method ?? "GET") !== "GET" && csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...options?.headers
    }
  });
  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(response.status, body.error?.code ?? "REQUEST_FAILED", body.error?.message ?? "Request failed", body.error?.correlationId);
  }
  return body as T;
}

export const api = {
  me: () => request<AuthSession>("/api/auth/me"),
  login: (email: string, password: string) => request<AuthSession>("/api/auth/login", {
    method: "POST", body: JSON.stringify({ email, password })
  }),
  logout: () => request<{ signedOut: boolean }>("/api/auth/logout", { method: "POST", body: "{}" }),
  dashboard: () => request<Dashboard>("/api/dashboard"),
  createReservation: (input: CreateReservationInput) =>
    request<Reservation>("/api/reservations", { method: "POST", body: JSON.stringify(input) }),
  checkIn: (id: string, roomId: string, reason: string) =>
    request<Reservation>(`/api/reservations/${id}/check-in`, {
      method: "POST",
      body: JSON.stringify({ roomId, reason })
    }),
  postCharge: (id: string, amount: number, code: string, description: string) =>
    request<Reservation>(`/api/reservations/${id}/postings`, {
      method: "POST",
      body: JSON.stringify({
        amount,
        code,
        description,
        reason: "Guest-requested service",
        idempotencyKey: crypto.randomUUID()
      })
    }),
  pay: (id: string, amount: number, tokenLast4: string) =>
    request<Reservation>(`/api/reservations/${id}/payment`, {
      method: "POST",
      body: JSON.stringify({
        amount,
        tokenLast4,
        reason: "Guest approved settlement",
        idempotencyKey: crypto.randomUUID()
      })
    }),
  checkout: (id: string) =>
    request<Reservation>(`/api/reservations/${id}/checkout`, {
      method: "POST",
      body: JSON.stringify({ reason: "Guest departure completed" })
    }),
  roomStatus: (id: string, status: string, reason: string) =>
    request<Dashboard>(`/api/rooms/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason })
    }),
  nightAudit: (reason: string) =>
    request<{ businessDate: string }>("/api/night-audit", {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  bookService: (id: string, input: { reservationId: string | null; guestName: string; serviceDate: string; slot: string; participants: number; youngestAge: number; waiverAccepted: boolean }) =>
    request<{ id: string }>(`/api/services/${id}/book`, { method: "POST", body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }) }),
  updateHousekeepingTask: (id: string, status: string) =>
    request<Dashboard>(`/api/housekeeping/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status, reason: "Operational task progress updated" }) }),
  moveStock: (id: string, input: { type: "receipt" | "issue"; quantity: number; department: string; reference: string }) =>
    request<Dashboard>(`/api/inventory/${id}/movements`, { method: "POST", body: JSON.stringify({ ...input, reason: "Authorized warehouse movement", idempotencyKey: crypto.randomUUID() }) }),
  setRateRuleActive: (id: string, active: boolean) =>
    request<Dashboard>(`/api/rate-rules/${id}`, { method: "PATCH", body: JSON.stringify({ active, reason: "Revenue strategy review" }) }),
  updateGuestProfile: (id: string, tags: string[], preferences: string[]) =>
    request<Dashboard>(`/api/guests/${id}`, { method: "PATCH", body: JSON.stringify({ tags, preferences, reason: "Guest preference review" }) })
};
