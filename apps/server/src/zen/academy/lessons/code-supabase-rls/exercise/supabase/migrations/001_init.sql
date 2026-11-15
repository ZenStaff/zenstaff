create table public.profiles (
  id uuid primary key references auth.users(id),
  email text not null,
  display_name text,
  role text not null default 'member',
  tenant_id uuid not null
);
alter table public.profiles enable row level security;

create policy "profiles readable" on public.profiles
  for select using (true);

create policy "profiles self update" on public.profiles
  for update using (auth.uid() = id);

create table public.invoices (
  id bigserial primary key,
  tenant_id uuid not null,
  customer_name text not null,
  customer_cnp text,
  amount_cents integer not null,
  status text not null default 'draft',
  created_by uuid references auth.users(id)
);
alter table public.invoices enable row level security;

create policy "tenant reads invoices" on public.invoices
  for select to authenticated
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "insert invoices" on public.invoices
  for insert to authenticated with check (true);

create table public.payment_tokens (
  id bigserial primary key,
  tenant_id uuid not null,
  provider text not null,
  token text not null
);

create or replace function public.mark_invoice_paid(invoice_id bigint)
returns void
language plpgsql
security definer
as $$
begin
  update public.invoices set status = 'paid' where id = invoice_id;
end;
$$;

create view public.invoice_totals as
  select tenant_id, customer_name, sum(amount_cents) as total_cents
  from public.invoices
  group by tenant_id, customer_name;

insert into storage.buckets (id, name, public)
values ('invoice-pdfs', 'invoice-pdfs', true);
