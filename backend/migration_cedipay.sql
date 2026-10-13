-- CediPay migration: drop the Bankak-only columns, add Ghana/Nigeria
-- recipient fields, and add the staff (admin) accounts table.
-- Run this once in the Supabase SQL editor.

alter table transactions drop column if exists bankak_account_number;
alter table transactions drop column if exists bankak_account_name;
alter table transactions drop column if exists bankak_trans_id;
alter table transactions drop column if exists amount_sdg;

alter table transactions add column if not exists recipient_country text check (recipient_country in ('GH','NG'));
alter table transactions add column if not exists recipient_name text;
alter table transactions add column if not exists payout_method text check (payout_method in ('mobile_money','bank_transfer'));
alter table transactions add column if not exists mobile_network text;
alter table transactions add column if not exists mobile_money_number text;
alter table transactions add column if not exists bank_name text;
alter table transactions add column if not exists bank_account_number text;
alter table transactions add column if not exists local_currency text;
alter table transactions add column if not exists amount_local numeric;
alter table transactions add column if not exists payout_reference text;
alter table transactions add column if not exists last_updated_by text;
alter table transactions add column if not exists last_updated_at timestamptz;

-- One row per staff member who's allowed into the admin screen. The
-- backend only ever reads/writes this with the service_role key, so no
-- public policies are needed — nothing on the open internet can query it.
create table if not exists admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz default now()
);

alter table admin_profiles enable row level security;
