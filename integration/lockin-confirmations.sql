-- Run only in diagnostic project akewzvkddnkrlznopfgo.
begin;
create table if not exists public.lockin_payments (
  session_id text primary key,
  email text not null check(email = lower(trim(email))),
  member_name text not null default '',
  payment_intent text,
  event_id text not null,
  cohort text not null default '2026-10-12_2026-12-20',
  paid_at timestamptz not null default now(),
  confirmation_first_attempt timestamptz,
  confirmation_lease_until timestamptz,
  confirmation_message_id text,
  confirmation_sent_at timestamptz
);
alter table public.lockin_payments enable row level security;
revoke all on public.lockin_payments from anon, authenticated;
create index if not exists lockin_payments_email_idx on public.lockin_payments(email,cohort);

create or replace function public.claim_lockin_confirmation(p_session text,p_email text,p_name text,p_intent text,p_event text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.lockin_payments;
begin
  insert into public.lockin_payments(session_id,email,member_name,payment_intent,event_id)
  values(p_session,lower(trim(p_email)),p_name,p_intent,p_event) on conflict(session_id) do nothing;
  select * into r from public.lockin_payments where session_id=p_session for update;
  if r.email <> lower(trim(p_email)) then raise exception 'Identity mismatch'; end if;
  if r.confirmation_message_id is not null then return jsonb_build_object('state','sent'); end if;
  -- Resend idempotency lasts 24 hours. Unknown deliveries older than 23 hours
  -- require provider-log reconciliation rather than risking duplicate emails.
  if r.confirmation_first_attempt < now()-interval '23 hours' then return jsonb_build_object('state','needs_review'); end if;
  if r.confirmation_lease_until > now() then return jsonb_build_object('state','busy'); end if;
  update public.lockin_payments set confirmation_first_attempt=coalesce(confirmation_first_attempt,now()),confirmation_lease_until=now()+interval '1 minute' where session_id=p_session;
  return jsonb_build_object('state','claimed');
end $$;

create or replace function public.complete_lockin_confirmation(p_session text,p_message text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.lockin_payments set confirmation_message_id=p_message,confirmation_sent_at=now(),confirmation_lease_until=null where session_id=p_session and confirmation_message_id is null;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.claim_lockin_confirmation(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_lockin_confirmation(text,text) from public,anon,authenticated;
grant execute on function public.claim_lockin_confirmation(text,text,text,text,text) to service_role;
grant execute on function public.complete_lockin_confirmation(text,text) to service_role;
commit;
