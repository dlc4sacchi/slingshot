# Slingshot Pro Plan — Implementation Guide

> **Status: NOT YET IMPLEMENTED** — This is a planning document. The current codebase uses a placeholder validation (`license.length > 6`). None of the infrastructure below (Stripe, Supabase Edge Functions, Resend, device heartbeats) has been built yet.

This document outlines the full architecture and flow for implementing paid Pro licenses in the Slingshot extension.

---

## Overview

A user pays once via Stripe, receives a license key by email, enters it in the extension settings, and unlocks Pro features. Each license supports up to **3 active browser profiles**.

---

## 1. License Key Design

- Keys are generated server-side by a Supabase Edge Function at the moment of successful payment
- Format can be a UUID or a readable string (e.g. `SS-XXXX-XXXX-XXXX`)
- Keys are stored in a `licenses` table in Supabase
- Each key has a `max_seats` value of 3

### Supabase Tables Needed

**`licenses`**
| Column | Type | Description |
|---|---|---|
| `key` | string (PK) | The license key |
| `email` | string | Email used at purchase |
| `max_seats` | integer | Always 3 |
| `created_at` | timestamp | When it was purchased |
| `last_reset_at` | timestamp | When the user last triggered a profile reset |

**`activations`**
| Column | Type | Description |
|---|---|---|
| `id` | uuid (PK) | Row identifier |
| `license_key` | string (FK) | References `licenses.key` |
| `device_uuid` | string | UUID generated on extension install |
| `last_heartbeat` | timestamp | Last time this profile checked in |
| `activated_at` | timestamp | When this profile first activated |

---

## 2. Device / Profile Identity

- On first install, the extension generates a random UUID and stores it in `chrome.storage.local`
- This UUID represents one browser profile — not one device
- It survives Chrome account changes but resets on full uninstall/reinstall, which is acceptable
- Do **not** use Chrome's profile ID or any Google account identifier — they are too unstable

---

## 3. Seat Management

### Activation Rules
1. User enters license key in extension settings
2. Extension sends the key + its device UUID to a Supabase Edge Function
3. The function checks:
   - Does this UUID already have an active seat for this key? → Approve (same profile re-activating)
   - Is this a new UUID? → Count active seats (heartbeat within last 30 days)
     - Under 3 → Add new activation row, approve
     - At 3 → Reject with "max profiles reached" message

### Heartbeat
- The extension silently pings Supabase once per day to update `last_heartbeat`
- Any activation row with a `last_heartbeat` older than **30 days** is considered expired and does not count toward the seat limit
- This means a profile the user stopped using naturally frees its slot within 30 days — no manual action needed

---

## 4. Active Profile Reset (Settings Button)

A button in the extension's settings page labeled **"Reset Active Profiles"**.

### What it does
- Calls a Supabase Edge Function
- Deletes all rows in `activations` for that license key
- All 3 slots are immediately freed
- The current profile re-activates automatically after the wipe

### The Cooldown Guard
- The reset is allowed **once every 30 days** per license
- The function checks `last_reset_at` in the `licenses` table before allowing the reset
- If within the 30-day window, the request is rejected with a message showing when the next reset is available
- Without this cooldown, key sharing becomes trivial — someone could reset on demand every time a 4th person wants access

### Why This Is Enough for Legit Users
A real user who needs a reset (new laptop, reinstalled browser, switching machines) will almost never need more than one reset per month. The 30-day window is a minor inconvenience for them and a real barrier for key sharers.

---

## 5. Payment Flow (Stripe + Supabase)

### Step 1 — User Clicks Upgrade
- The extension popup or settings page has an "Upgrade to Pro" button
- Clicking it opens a **Stripe Checkout** page in a new tab
- This is a Stripe-hosted page — you configure it in the Stripe dashboard, no custom UI needed
- It handles the card form, 3D Secure, receipts, everything

### Step 2 — Payment Succeeds
- Stripe fires a **webhook** to your Supabase Edge Function
- This is a server-to-server call from Stripe directly — it cannot be faked by the user
- The event type to listen for is `checkout.session.completed`

### Step 3 — License is Generated
- The Edge Function receives the webhook
- It generates a new license key
- It writes a row to the `licenses` table with the key and the buyer's email
- It then sends the license key to the buyer via **email**

### Step 4 — Email Delivery
- Use **Resend** (resend.com) to send the email — it has a free tier, simple API, and works natively with Supabase Edge Functions
- The email contains:
  - The license key (prominently displayed)
  - Instructions on where to enter it in the extension
  - A note about the 3 profile slots and the reset button
- Resend also supports custom HTML emails so it can look professional

### Step 5 — User Enters the Key
- User copies the key from their email
- Opens extension settings → enters key in the license field → clicks Activate
- Extension calls Supabase to validate and claim a seat
- Pro features unlock immediately

---

## 6. Infrastructure Summary

| Piece | Tool | Purpose |
|---|---|---|
| Payment page | Stripe Checkout (hosted) | Collect payment securely |
| Webhook receiver | Supabase Edge Function | Listen for successful payments |
| License storage | Supabase (`licenses` table) | Store keys and reset timestamps |
| Activation storage | Supabase (`activations` table) | Track active profiles + heartbeats |
| Email delivery | Resend | Send license key to buyer |
| Activation logic | Supabase Edge Function | Validate key, enforce seat limit |
| Heartbeat | Extension (daily) | Keep seat alive, auto-expire inactive ones |

---

## 7. What Happens in Each Scenario

| Scenario | Outcome |
|---|---|
| Same person, 3 different browsers | All 3 activate fine, all 3 count as 1 seat each |
| User reinstalls Chrome | New UUID generated, claims a new seat. Old one expires in 30 days |
| User gets a new laptop | Same as above |
| Someone shares key with 3 friends | All 3 slots fill up, 4th person is blocked |
| Key sharer tries to reset to let someone else in | Blocked by 30-day cooldown |
| Seat expires naturally (30 days no heartbeat) | Slot frees up automatically, no action needed |
| User loses their license key email | They can email you — you look it up in Supabase by their purchase email |

---

## 8. Build Order (Recommended Sequence)

1. Set up Supabase tables (`licenses`, `activations`)
2. Create Stripe product and Checkout page
3. Write the webhook Edge Function (payment → generate key → send email)
4. Set up Resend account and email template
5. Write the activation Edge Function (validate key, seat check)
6. Add license key input + activation logic to extension settings page
7. Add daily heartbeat to `background.js`
8. Add "Reset Active Profiles" button to settings page
9. Write the reset Edge Function (wipe activations, enforce cooldown)
10. Test the full end-to-end flow before publishing
