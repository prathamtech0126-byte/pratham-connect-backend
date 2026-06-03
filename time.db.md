# CRM time handling (IST)

**Business timezone:** `Asia/Kolkata` (IST, UTC+05:30, no daylight saving).

This document is the single reference for date/time across **database → backend API → frontend UI**. Follow it for all lead/follow-up work and apply the same pattern when adding new features.

---

## 1. The contract (one sentence)

**Store IST wall clock in naive PostgreSQL columns; serialize API JSON with `+05:30`; parse and display on the frontend only through the CRM timestamp helpers.**

If every layer follows this, the same moment shows the same time in the lead list, detail header, follow-up tab, reports, and notifications.

---

## 2. Why this exists

PostgreSQL `timestamp without time zone` does not store a timezone. The Node `pg` driver maps those values to JavaScript `Date` using **UTC components as wall clock**.

The CRM treats those columns as **IST wall time** (what the user picked on screen), not as UTC.

| Wrong assumption | Symptom |
|------------------|---------|
| Treat DB value as UTC and show in browser local time | Times shift by **5h 30m** (e.g. 12:49 PM vs 6:23 PM) |
| Save `toISOString()` into React state for display | Header/list show UTC-based time; tab may differ |
| Return raw `Date` from API without `+05:30` | JSON becomes `...Z`; parsers disagree |

---

## 3. Layer-by-layer

### 3.1 Database

| Item | Rule |
|------|------|
| Column type | `timestamp without time zone` for business times users see (e.g. `next_followup_at`, `followup_at`) |
| Meaning | **IST wall clock** — `2026-06-01 12:49:00` means “1 Jun 2026, 12:49 PM IST” |
| Do not | Assume the value is UTC or “server local time” |

**Lead-related columns (examples):**

- `leads.next_followup_at`
- `lead_activities.followup_at`
- `leads.created_at`, `updated_at` (serialized on lead API responses)

### 3.2 Backend (Node)

**Module:** `src/utils/pgTimestamp.ts`

| Function | When to use |
|----------|-------------|
| `pgNaiveIst(date)` | **Before INSERT/UPDATE** on any naive IST column |
| `getPgNaiveIndianNow()` | “Now” in IST for naive columns |
| `serializePgNaiveTimestampAsIst(value)` | One field → API string `2026-06-01T12:49:00+05:30` |
| `serializeLeadTimestampsForApi(row)` | Lead rows (`nextFollowupAt`, `createdAt`, …) |
| `serializeLeadActivityTimestampsForApi(row)` | Activity rows (`followupAt`, `createdAt`, `updatedAt`) |

**Write path (example — schedule follow-up):**

```ts
import { pgNaiveIst } from "../../utils/pgTimestamp";

const followupDate = new Date(req.body.followupAt); // ISO from client is OK

await updateLeadById(leadId, {
  nextFollowupAt: pgNaiveIst(followupDate),
});

await createLeadActivity({
  followupAt: pgNaiveIst(followupDate), // same wall time as lead column
  // ...
});
```

**Read path (example — GET lead / activities):**

```ts
import {
  serializeLeadTimestampsForApi,
  serializeLeadActivityTimestampsForApi,
} from "../../utils/pgTimestamp";

const lead = serializeLeadTimestampsForApi(await getLeadById(id));
const activities = rows.map(serializeLeadActivityTimestampsForApi);

res.json({ lead, activities });
```

**Request body:** Clients may send `followupAt` as ISO (`toISOString()` or with offset). Always run through `new Date(input)` then `pgNaiveIst()` before saving.

**Never** return a raw Drizzle/`Date` field from a naive column in JSON without serializing — Express will emit `...Z` and break the frontend contract.

### 3.3 API JSON format

**Canonical shape:**

```json
"nextFollowupAt": "2026-06-01T12:49:00+05:30"
```

- Always include offset `+05:30` for CRM business timestamps.
- Same value must appear on `lead.nextFollowupAt` and pending `activity.followupAt` for the same follow-up.

### 3.4 Frontend (React)

**Module:** `client/src/lib/format-crm-timestamp.ts`  
**Timezone constant:** `client/src/lib/ist-date-range.ts` → `CRM_LEAD_DATE_TZ = "Asia/Kolkata"`

| Function | When to use |
|----------|-------------|
| `formatCrmTimestamp(value, "datetime" \| "date" \| "time")` | Labels, cards, tables |
| `formatCrmFollowupShort(value)` | Compact badge e.g. `Follow Up · 1 Jun, 12:49 pm` |
| `parseCrmTimestamp(value)` | Comparisons, sorting, “is today” filters |
| `toCrmApiTimestamp(date)` | Rare client-only need for `+05:30` string (prefer API response) |

**Display — do:**

```tsx
import { formatCrmTimestamp, formatCrmFollowupShort } from "@/lib/format-crm-timestamp";

formatCrmTimestamp(lead.nextFollowupAt, "datetime");
formatCrmFollowupShort(lead.nextFollowupAt);
formatCrmTimestamp(activity.followupAt, "datetime");
```

**Display — do not:**

```tsx
// ❌ Bypasses IST rules; causes 5h30 drift on some values
format(new Date(lead.nextFollowupAt), "dd MMM yyyy, hh:mm a");
```

**State after API calls — do:**

```ts
const { lead: updatedLead } = await markLeadFollowupApi(id, {
  followupAt: scheduled.toISOString(), // OK in request body only
});
setLead({ ...updatedLead }); // use updatedLead.nextFollowupAt from API (+05:30)
```

**State — do not:**

```ts
// ❌ Overwrites correct API value with UTC string
setLead({ nextFollowupAt: scheduled.toISOString() });
```

**Date range filters (lists/reports):** use `ist-date-range.ts` / `lead-date-range.ts` so “today” means IST calendar day, not UTC midnight on the server.

---

## 4. End-to-end flow (follow-up)

```
User picks 1 Jun 2026, 12:49 PM (picker Date)
        │
        ▼
Frontend POST { followupAt: "<ISO instant>" }     ← body only
        │
        ▼
Backend pgNaiveIst() → DB stores 2026-06-01 12:49:00 (naive)
        │
        ▼
Backend GET serialize*ForApi() → "2026-06-01T12:49:00+05:30"
        │
        ▼
Frontend formatCrmTimestamp() → "1 Jun 2026, 12:49 pm" everywhere
```

---

## 5. Production server

| Setting | Recommendation |
|---------|----------------|
| `TZ` | `Asia/Kolkata` on the Node process (PM2, Docker, systemd) |
| `FB_TOKEN_REFRESH_TIMEZONE` | Already `Asia/Kolkata` for cron |
| PostgreSQL host TZ | Can stay UTC; app must use helpers above |
| Deploy | No special frontend build; helpers are in source |

Optional env (notifications):

- `FOLLOWUP_OVERDUE_HOURS` — default `3` (overdue alert after 3h past scheduled time)
- `FOLLOWUP_OVERDUE_SCAN_SEC` — scanner interval

---

## 6. Checklist for new features

### Backend

- [ ] Naive column writes use `pgNaiveIst()` (or `getPgNaiveIndianNow()`).
- [ ] API responses use `serializePgNaiveTimestampAsIst` or `serialize*ForApi` on the row.
- [ ] Compare/filter “today” in IST (`Asia/Kolkata`), not `new Date()` server local only.

### Frontend

- [ ] All user-visible CRM times use `formatCrmTimestamp` / `parseCrmTimestamp`.
- [ ] After mutations, UI state uses **API-returned** timestamp fields.
- [ ] List badges and detail header use the **same** field/parser (e.g. `nextFollowupAt`).

### Both

- [ ] Same event updates **lead** and **activity** with the same `pgNaiveIst` instant.
- [ ] Manual QA: list tag, detail header, and follow-up tab show **identical** time.

---

## 7. Common mistakes

| Mistake | Fix |
|---------|-----|
| `deliveredAt: null` on notification dedupe upsert resetting every scan | Do not clear `deliveredAt` on conflict if already delivered |
| Only serializing `nextFollowupAt` but not `followupAt` | Always `serializeLeadActivityTimestampsForApi` on activities |
| Optimistic `mergeLeadRow(..., { nextFollowupAt: toISOString() })` | Use `result.lead.nextFollowupAt` from API |
| Legacy rows stored before `pgNaiveIst` | API `+05:30` + `parseCrmTimestamp` handles display; run DB audit if times still mismatch |

---

## 8. File map

| Layer | Path |
|-------|------|
| Backend core | `src/utils/pgTimestamp.ts` |
| Lead model | `src/Leads/models/lead.model.ts` (`serializeLeadTimestampsForApi` on list/get) |
| Lead controllers | `src/Leads/controllers/lead.controller.ts` (`pgNaiveIst` on write) |
| Frontend format | `client/src/lib/format-crm-timestamp.ts` |
| Frontend IST filters | `client/src/lib/ist-date-range.ts` |
| Follow-up picker | `client/src/lib/followup-datetime.ts` |
| Lead badges | `client/src/lib/lead-status-tags.ts` |

---

## 9. Activity log (`activity_log.created_at`)

| Step | Rule |
|------|------|
| **Write** | `createActivityLog` sets `createdAt: getPgNaiveIndianNow()` (not DB `defaultNow()` alone) |
| **Read API** | `serializeActivityLogTimestampAsIst(createdAt)` in `activityLog.model.ts` |
| **Legacy rows** | Before `2026-06-01` IST (or `ACTIVITY_LOG_LEGACY_UTC_CUTOFF` env): naive column stored **UTC wall clock** → serializer treats wall parts as UTC and outputs correct IST |
| **UI** | `formatCrmTimestamp` in `Activity.tsx` and `ActivityLog.tsx` |

API cache key uses `activity-logs:v2:` so old cached `...Z` responses are dropped after deploy.

---

## 10. Extending to other modules

Payments, clients, and reports may still use raw `Date` / `toISOString()` / `format(new Date(...))`. When touching those modules:

1. Identify naive vs `timestamptz` columns in schema.
2. Reuse `pgTimestamp.ts` for the same “business IST” columns.
3. Reuse `format-crm-timestamp.ts` on the UI.

Long-term alternative (larger migration): store UTC in `timestamptz`, convert only at display. Until then, **naive IST + helpers** is the supported approach for this CRM.

---

## 11. Quick reference

```
WRITE:     pgNaiveIst(new Date(input))  |  activity log: getPgNaiveIndianNow()
READ API:  serializePgNaiveTimestampAsIst / serializeLead*ForApi / serializeActivityLogTimestampAsIst
SHOW UI:   formatCrmTimestamp / formatCrmFollowupShort
COMPARE:   parseCrmTimestamp
NEVER:     toISOString() in React state for nextFollowupAt / followupAt display
```

Questions or new timestamp fields: update this file and `pgTimestamp.ts` / `format-crm-timestamp.ts` together.

---

## 12. Notifications (inbox, bulk assign, retention)

| Topic | Rule |
|-------|------|
| **Inbox window** | List API and unread count only include rows with `createdAt` within the last **7 days** (`NOTIFICATION_RETENTION_DAYS`, default `7`). |
| **Cleanup** | Daily scheduler deletes **all** notifications (read or unread) older than that window via `deleteNotificationsOlderThan`. |
| **Bulk assign** | `bulkAssign` / `bulkStrategyAssign` call `onLeadAssignmentChange(..., { deferDelivery: true })` per lead, then `flushLeadAssignmentBatch(userId)` once per assignee → one socket `notification:new` and one sound. |
| **Single assign** | Immediate delivery (`deferDelivery: false`). |
| **Socket** | `notification:new` replaces an existing row by `id` in the client cache; `notification:updated` merges without sound. Reconnect triggers query invalidation. |
| **Alerts tab** | High-priority / overdue follow-up types appear under Alerts even after read (`filterByCategory` + `category: "alerts"` for overdue/reminder types). |
| **Follow-up reminders** | Two scheduled reminders per follow-up: **5 min before** (`lead_followup:…:before`, env `FOLLOWUP_REMINDER_MINUTES_BEFORE`) and **at scheduled time** (`…:due`). Rescheduling cancels both via `cancelLeadFollowupReminders`. Notification copy uses `formatPgNaiveTimestampForDisplay` / `pgNaiveIst` (IST), not raw `toLocaleString` or `toISOString()`. |
| **Missed follow-up** | **First** alert **5 min** after scheduled time (`FOLLOWUP_MISSED_MINUTES`, default `5`). **Second** alert **3 hours** after scheduled time if still not completed (`FOLLOWUP_OVERDUE_HOURS`, default `3`) — only after the first was sent. Both are scheduled when the follow-up is set; scanner is backup. Reschedule cancels pending missed alerts. |
| **Bell badge** | Top bar shows numeric unread count (API `unread-count` + any `extraBadgeCount`). |

**Modules:** `src/notification/integrations/leadNotifications.ts`, `src/notification/models/notification.model.ts`, `client/src/notification/context/notification-context.tsx`.
