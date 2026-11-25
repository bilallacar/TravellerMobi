-- ============================================================================
-- TravellerMobi — Paket 2 & Paket 4 Migration (v3.0)
-- ============================================================================
-- KULLANIM: Supabase Dashboard -> SQL Editor -> New Query -> Yapıştır & RUN
-- 1. KVKK uyumlu kalıcı hesap ve veri silme RPC'si (delete_my_account)
-- 2. Masraflarda işlem anı kur sabitleme sütunları (fx_rate, fx_base_currency, fx_recorded_at)
-- ============================================================================

-- 1. Masraflarda işlem anı döviz kuru sütunları
alter table public.expenses add column if not exists fx_rate numeric;
alter table public.expenses add column if not exists fx_base_currency text;
alter table public.expenses add column if not exists fx_recorded_at timestamp with time zone;

-- 2. KVKK: Kullanıcının kendi hesabını ve tüm kişisel verilerini kalıcı silmesi için RPC
create or replace function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Aktif oturum bulunamadı.';
  end if;

  -- Kullanıcıya ait tüm uygulama verilerini sil
  delete from public.reservations where user_id = v_uid;
  delete from public.places where user_id = v_uid;
  delete from public.memories where user_id = v_uid;
  delete from public.expenses where user_id = v_uid;
  delete from public.shared_routes where user_id = v_uid;
  delete from public.trips where user_id = v_uid;

  -- Analitik kayıtlarındaki kullanıcı kimlik bağını kaldır (KVKK anonimleştirme)
  update public.site_visitors
  set user_id = null,
      user_email = null
  where user_id = v_uid;

  update public.site_events
  set user_id = null
  where user_id = v_uid;

  -- Profili ve Supabase Auth kullanıcısını kalıcı sil
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;

  return true;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
