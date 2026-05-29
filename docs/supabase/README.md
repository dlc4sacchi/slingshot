# Supabase Backend Setup

Official Slingshot builds use a hosted Supabase project for remote search engine updates, announcements, community requests, voting, and telemetry ingest.

The browser extension contains a public Supabase URL and anon key. That is expected for a browser client. Do not place service-role keys, database passwords, Stripe secrets, Resend keys, or private API tokens in extension code.

## Files

- `requests_setup.sql` creates announcements, request submission, and voting RPCs.
- `search_engines_research.sql` adds/normalizes search engine categories and seeds research engines.
- `telemetry_setup.sql` creates daily telemetry tables and dashboard views.

## Security Requirements

Before using these scripts in a public project, confirm:

- Row Level Security is enabled on public tables.
- Public read policies only expose intended read-only data.
- Inserts and mutations happen through validated RPCs or Edge Functions.
- `submit_request` enforces type, URL, length, creator, and one-hour rate-limit checks server-side.
- `toggle_vote` validates voter IDs and only mutates pending requests.
- Telemetry ingest is handled by a server-side function that validates payload size and schema.

## Self Hosting

Forks that want their own backend should:

1. Create a Supabase project.
2. Apply the SQL files in this directory.
3. Deploy a telemetry ingest Edge Function compatible with `telemetry/heartbeat.js`.
4. Replace `SUPABASE_CONFIG.URL` and `SUPABASE_CONFIG.ANON_KEY` in `storage.js`.
5. Verify RLS and RPC behavior from an anon client before shipping.

The official hosted backend is only intended for official Slingshot builds.
