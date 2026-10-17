-- Adds a lightweight support-message inbox: a customer sends a message from
-- the app, any signed-in staff member can see it and reply/resolve it from
-- the admin dashboard. Run this once in the Supabase SQL editor, same as
-- migration_cedipay.sql.
--
-- This does NOT send an email or text message anywhere yet — it just stores
-- the message so staff see it inside the app. Forwarding it to a real email
-- or phone number needs a provider (e.g. Resend for email, Twilio for SMS)
-- wired in separately once you've picked one and have a destination
-- address/number.

create table if not exists support_messages (
  id bigint generated always as identity primary key,
  sender_email text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  staff_reply text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

alter table support_messages enable row level security;
