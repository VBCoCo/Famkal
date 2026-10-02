-- Additive project planning tables. Existing calendar/auth data stays intact.
create table public.project_releases (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id),
 version text not null check(length(version) between 1 and 40),
 status text not null default 'planned' check(status in ('planned','released')),
 notes text not null default '' check(length(notes)<=10000),
 commit_sha text check(commit_sha ~ '^[a-f0-9]{40}$'),
 released_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 change_source text not null default 'database' check(change_source in ('chat','database')),
 change_note text not null default '' check(length(change_note)<=2000),
 unique(family_id,version), unique(family_id,id),
 check ((status='released')=(released_at is not null))
);
create table public.project_items (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id),
 item_no integer not null check(item_no>0),
 title text not null check(length(trim(title)) between 1 and 200),
 description text not null default '' check(length(description)<=10000),
 category text not null default 'feature' check(category in ('bug','feature','security','test')),
 priority text not null default 'normal' check(priority in ('high','normal','low')),
 status text not null default 'collected' check(status in ('collected','planned','in_progress','implemented','verified','discarded')),
 planned_version text, completed_version text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 change_source text not null default 'database' check(change_source in ('chat','database')),
 change_note text not null default '' check(length(change_note)<=2000),
 unique(family_id,item_no), unique(family_id,id),
 foreign key(family_id,planned_version) references public.project_releases(family_id,version),
 foreign key(family_id,completed_version) references public.project_releases(family_id,version),
 check(completed_version is null or status in ('implemented','verified'))
);
create table public.project_item_history (
 id bigint generated always as identity primary key,
 family_id uuid not null references public.families(id),
 item_id uuid, release_id uuid,
 changed_at timestamptz not null default clock_timestamp(),
 operation text not null check(operation in ('INSERT','UPDATE')),
 source text not null check(source in ('chat','database')),
 actor text not null,
 change_note text not null,
 old_values jsonb, new_values jsonb not null,
 foreign key(family_id,item_id) references public.project_items(family_id,id),
 foreign key(family_id,release_id) references public.project_releases(family_id,id),
 check((item_id is not null)<>(release_id is not null))
);
create index project_history_item_time on public.project_item_history(family_id,item_id,changed_at desc,id desc);
create index project_history_release on public.project_item_history(family_id,release_id);
create index project_items_planned on public.project_items(family_id,planned_version);
create index project_items_completed on public.project_items(family_id,completed_version);

alter table public.project_items enable row level security;
alter table public.project_releases enable row level security;
alter table public.project_item_history enable row level security;
create policy project_items_read on public.project_items for select to authenticated using(family_id=(select private.my_family_id()));
create policy project_releases_read on public.project_releases for select to authenticated using(family_id=(select private.my_family_id()));
create policy project_history_read on public.project_item_history for select to authenticated using(family_id=(select private.my_family_id()));
revoke all on public.project_items,public.project_releases,public.project_item_history from public,anon,authenticated;
grant select on public.project_items,public.project_releases,public.project_item_history to authenticated;
revoke all on sequence public.project_item_history_id_seq from public,anon,authenticated;

create function private.project_before_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'Projektpunkte und Versionen bleiben erhalten; bitte Status verwerfen verwenden'; end if;
 if TG_OP='UPDATE' then
  if new.id<>old.id or new.family_id<>old.family_id or new.created_at<>old.created_at then raise exception 'Identität und Erstellungsdatum sind unveränderlich'; end if;
  if TG_TABLE_NAME='project_items' and (to_jsonb(new)->'item_no')<>(to_jsonb(old)->'item_no') then raise exception 'Punktnummer ist unveränderlich'; end if;
 end if;
 new.updated_at=clock_timestamp(); return new;
end $$;
create function private.project_audit_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.project_item_history(family_id,item_id,release_id,operation,source,actor,change_note,old_values,new_values)
 values(new.family_id,case when TG_TABLE_NAME='project_items' then new.id end,case when TG_TABLE_NAME='project_releases' then new.id end,
 TG_OP,new.change_source,session_user,new.change_note,case when TG_OP='UPDATE' then to_jsonb(old) end,to_jsonb(new));
 return new;
end $$;
create function private.project_history_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Die Projekt-Historie darf nicht geändert oder gelöscht werden'; end $$;
revoke all on function private.project_before_change(),private.project_audit_change(),private.project_history_immutable() from public,anon,authenticated;
create trigger project_items_before before insert or update or delete on public.project_items for each row execute function private.project_before_change();
create trigger project_items_audit after insert or update on public.project_items for each row execute function private.project_audit_change();
create trigger project_releases_before before insert or update or delete on public.project_releases for each row execute function private.project_before_change();
create trigger project_releases_audit after insert or update on public.project_releases for each row execute function private.project_audit_change();
create trigger project_history_protect before update or delete on public.project_item_history for each row execute function private.project_history_immutable();

-- Import our chat backlog for the existing family, resolving IDs from the database.
insert into public.project_releases(family_id,version,status,notes,commit_sha,released_at,change_source,change_note)
select id,'1.1.0','released','Berechtigungen und Familienzugriffe abgesichert; lokale Datumsberechnung, nachladende Wochenansicht, Serienänderungen, PWA-Icons und Cache sowie Passwort-Recovery korrigiert. Automatische Tests bestanden. Praktischer Browser-/iPhone-Test bleibt offen.',
'7791ce9da491d8feb025380a2be1d09fa3302025','2026-10-01T18:19:01Z','chat','Nachträglich aus dem Chat übernommen; dies ist kein ursprünglicher Audit-Eintrag.' from public.families;
insert into public.project_releases(family_id,version,notes,change_source,change_note)
select id,'1.2.0','Projektliste mit Versionen und automatischer Änderungshistorie. Anzeige im Profil; Pflege ausschließlich über den Chat.','chat','Versionsumfang vom Nutzer freigegeben.' from public.families;
insert into public.project_items(family_id,item_no,title,description,category,priority,status,planned_version,change_source,change_note)
select f.id,v.num,v.title,v.description,v.category,v.priority,v.status,case when v.num=6 then '1.2.0' end,'chat','Aus der gemeinsam besprochenen Punkteliste übernommen.'
from public.families f cross join (values
 (1,'Push und automatische Erinnerungen','Echte Push-Benachrichtigungen einschließlich VAPID, Versandfunktion, Zeitplanung und zuverlässiger Zustellung einrichten. Erinnerungszeiten sind bisher nur vorbereitet.','feature','normal','collected'),
 (2,'Schutz gegen kompromittierte Passwörter','Leaked Password Protection in Supabase prüfen und aktivieren, soweit der Tarif dies ermöglicht. Noch deaktiviert.','security','high','collected'),
 (3,'Auth-Einstellungen vollständig prüfen','Site URL und Redirect-Adressen, Passwortregeln und Anmeldelimits prüfen. Die bisherige Prüfung war nicht vollständig.','security','high','collected'),
 (4,'Praxistest auf dem iPhone','Anmeldung, Familienverwaltung, Termine, Serien und PWA praktisch testen. Der Cloud-Browser-Test blieb bei der Navigation hängen; kein erfolgreicher End-to-End-Test behauptet.','test','high','collected'),
 (5,'Wiederholungsregel bestehender Serien bearbeiten','Rhythmus und Laufzeit vorhandener Serien bearbeiten können, mit klarer Behandlung bereits geänderter Einzeltermine. Bisher schreibgeschützt.','feature','normal','collected'),
 (6,'Projektliste und Änderungshistorie','Offene und abgeschlossene Punkte, Prioritäten, Versionen und Historie in Supabase speichern. Reine Anzeige im Profil für Familienmitglieder. Aufnahme, Änderung und Erledigt-Meldung über den Chat; neue Wünsche lösen keine automatische Umsetzung aus.','feature','high','in_progress')
) as v(num,title,description,category,priority,status);
