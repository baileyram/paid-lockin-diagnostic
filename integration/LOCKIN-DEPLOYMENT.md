# Lock-In delivery repair: prepared, not deployed

The live Stripe account had zero webhook endpoints when checked on 8 October 2026. Creating a Resend template alone does not cause payment confirmations to send.

`lockin-payment-handler.mjs` is a Supabase Edge Function preparation. Four local tests pass: tampered/expired signatures; unpaid/unrelated/test-mode/wrong-price rejection; duplicate-event handling; provider failure returning a retryable response. Real database concurrency, actual provider delivery and production deployment are still untested.

## Required rollout

1. Restore access to diagnostic Supabase project `akewzvkddnkrlznopfgo`.
2. Apply `lockin-confirmations.sql`. Tables are private and RPCs are service-role-only.
3. Deploy handler as `lockin-payment-confirmation`. Stripe requests must reach signature verification rather than Supabase JWT middleware; keep signature verification mandatory. Do not replace the existing diagnostic processor with this handler.
4. Register Stripe webhook events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Store the signing secret in Supabase Edge Function secrets. Reuse the existing server-side `RESEND_API_KEY`; never commit credentials. The Supabase URL and service-role key must be available to this handler only.
5. Backfill existing verified paid sessions server-side. For members already manually confirmed, record their existing confirmation message IDs before replaying events, to avoid duplicate emails. Keep personal backfill data out of this public repository.
6. Replay the real paid event, verify a single database record and a Resend message ID. Verify provider delivery separately from API acceptance. Retry a failed send and replay a duplicate event. Reconcile unknown sends older than 23 hours manually because provider idempotency expires after 24 hours.
7. Build the daily sales segment from eligible contacts. Before EVERY send, exclude global/topic opt-outs, bounced/suppressed addresses and any paid session for this cohort. Payment exclusion must be immediate, not merely a once-a-day contact export. Remove buyers from the promotional segment, not from service confirmations or paid-member updates. Do not auto-resubscribe previously opted-out contacts.
8. Cross-project contact preference sync and payment-to-Resend segment sync are not yet implemented. Do not launch the daily sequence until these are tested, including a purchase immediately before a scheduled send.
9. Schedule at `10:00 UTC`, which is noon SAST. The first four drafts are 9–12 October. The admissions closing date and any late-entry copy need to be established before extending the sequence beyond launch day. No invented last-chance deadline.

## Daily sequence preparation

`lockin-daily-sales.mjs` includes four branded HTML drafts covering decisive, relational, evidence-seeking, sceptical, budget-conscious and expressive readers through varied arguments, without assigning unverified personality labels to contacts. Each includes a hook, self-identification, a practical reframing and a clear once-off payment CTA. US$5/week is explicitly an equivalent, not an instalment plan. US$5,000 is framed as a possibility, not a promised or typical return.

Beige background uses inline colours, HTML bgcolor, gradient backgrounds, light colour-scheme metadata and dark-mode CSS. Some clients force recolouring; beige cannot be guaranteed on every phone. Test Gmail iOS/Android, Apple Mail and Outlook before claiming coverage. Native Resend unsubscribe placeholders must resolve in actual Broadcast sends.

Confirmation template published: `a7bde0fe-fc32-4897-8c1b-ab06b0679e8a`.
Sender: `Bailey at The Paid Squad <lock@paid-squad.com>`.
Reply-to: the existing connected Gmail mailbox until a domain inbox is verified.
