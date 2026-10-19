-- PARA Cockpit: komplett im Supabase SQL Editor ausführen ("Run").
-- Kann jederzeit erneut ausgeführt werden (z. B. nach einem Update), vorhandene Daten bleiben erhalten.

-- 1) Tabelle für alle Einträge (jede Zeile gehört genau einem Konto)
create table if not exists public.items (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists items_user_synced on public.items (user_id, synced_at);
create index if not exists items_user_synced_id on public.items (user_id, synced_at, id);

-- Server-Zeitstempel für den Abgleich zwischen Geräten.
-- Schutz vor Überschreiben: eine Fassung, die älter ist als die gespeicherte (updated_at), wird nicht übernommen.
-- Das gilt auch für Löschmarken: eine alte Offline-Bearbeitung holt einen gelöschten Eintrag nicht zurück.
-- Die App erkennt die Ablehnung und legt ihre Fassung als Konfliktkopie an.
-- clock_timestamp() statt now(): jede Zeile bekommt einen eigenen Zeitstempel, auch innerhalb eines Uploads.
create or replace function public.items_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.items_touch();

-- Zugriff: jedes Konto sieht und ändert nur seine eigenen Zeilen
alter table public.items enable row level security;
drop policy if exists "items_own" on public.items;
create policy "items_own" on public.items for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.items to authenticated;

-- 2) Privater Speicher für Dateien (max. 50 MB pro Datei)
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "files_select_own" on storage.objects;
drop policy if exists "files_insert_own" on storage.objects;
drop policy if exists "files_delete_own" on storage.objects;
create policy "files_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "files_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "files_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
