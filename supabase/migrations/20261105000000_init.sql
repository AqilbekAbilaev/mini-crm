-- Mini-CRM "Объекты и задачи": schema, RLS, status workflow.
-- All access rules live here; the frontend only uses the anon key.

create type public.user_role as enum ('manager', 'executor');
create type public.task_status as enum ('new', 'in_progress', 'review', 'accepted', 'rework');

-- ---------- tables ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'executor'
);

create table public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  address text not null default '',
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  -- restrict: an object with tasks cannot be deleted (no silent loss of tasks/history)
  object_id uuid not null references public.objects (id) on delete restrict,
  assignee_id uuid not null references public.profiles (id),
  status public.task_status not null default 'new',
  author_id uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.tasks (object_id);
create index on public.tasks (assignee_id);

create table public.task_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  from_status public.task_status,          -- null = task creation
  to_status public.task_status not null,
  comment text,
  changed_by uuid not null references public.profiles (id),
  changed_at timestamptz not null default now()
);
create index on public.task_history (task_id);

-- ---------- helpers ----------

create function public.is_manager() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager');
$$;

-- New auth user -> profile. Role comes from app_metadata (only settable with service_role),
-- never from user_metadata (which the user controls). Default: executor.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'executor')
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Assignee must be an executor.
create function public.check_task_assignee() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = new.assignee_id and role = 'executor') then
    raise exception 'Исполнитель должен иметь роль executor';
  end if;
  return new;
end $$;
create trigger tasks_check_assignee before insert or update of assignee_id on public.tasks
  for each row execute function public.check_task_assignee();

-- Creation is the first history entry: — -> new.
create function public.log_task_created() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.task_history (task_id, from_status, to_status, changed_by)
  values (new.id, null, new.status, new.author_id);
  return new;
end $$;
create trigger tasks_log_created after insert on public.tasks
  for each row execute function public.log_task_created();

-- ---------- status workflow (single source of truth) ----------

-- Statuses the current user may move this task to. UI uses it to render buttons,
-- change_task_status uses it to validate. Returns empty if task is not visible.
create function public.allowed_transitions(p_task_id uuid) returns public.task_status[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  t public.tasks;
  mgr boolean := public.is_manager();
begin
  select * into t from public.tasks where id = p_task_id;
  if not found or not (mgr or t.assignee_id = auth.uid()) then
    return '{}';
  end if;
  return array(
    select s from (values
      ('new'::public.task_status, 'in_progress'::public.task_status, t.assignee_id = auth.uid()),
      ('in_progress', 'review',      t.assignee_id = auth.uid()),
      ('review',      'accepted',    mgr),
      ('review',      'rework',      mgr),
      ('rework',      'in_progress', t.assignee_id = auth.uid())
    ) as r(f, s, ok)
    where r.f = t.status and r.ok
  );
end $$;

create function public.change_task_status(p_task_id uuid, p_to public.task_status, p_comment text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.task_status;
  cmt text := nullif(trim(p_comment), '');
begin
  -- lock the row so two concurrent transitions can't both pass the check
  select status into cur from public.tasks where id = p_task_id for update;
  if not (p_to = any (public.allowed_transitions(p_task_id))) then
    raise exception 'Переход % -> % запрещён', coalesce(cur::text, '?'), p_to;
  end if;
  if p_to = 'rework' and cmt is null then
    raise exception 'Для возврата на доработку нужен комментарий';
  end if;
  update public.tasks set status = p_to where id = p_task_id;
  insert into public.task_history (task_id, from_status, to_status, comment, changed_by)
  values (p_task_id, cur, p_to, cmt, auth.uid());
end $$;

-- ---------- privileges ----------
-- Supabase grants everything to anon/authenticated by default. Start from zero.

revoke all on public.profiles, public.objects, public.tasks, public.task_history from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.profiles to authenticated;                 -- no writes: role can't be self-promoted
grant select, insert, update, delete on public.objects to authenticated;
grant select, delete on public.tasks to authenticated;
-- status / author / created_at are NOT writable directly: status only via change_task_status()
grant insert (title, description, object_id, assignee_id) on public.tasks to authenticated;
grant update (title, description, object_id, assignee_id) on public.tasks to authenticated;
grant select on public.task_history to authenticated;             -- no writes: history is append-only via functions

grant execute on function public.is_manager() to authenticated;
grant execute on function public.allowed_transitions(uuid) to authenticated;
grant execute on function public.change_task_status(uuid, public.task_status, text) to authenticated;

-- ---------- RLS ----------

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_history enable row level security;

-- names are needed for assignee picker and history; profiles hold no sensitive data
create policy profiles_read on public.profiles for select to authenticated using (true);

create policy objects_read on public.objects for select to authenticated using (
  public.is_manager()
  or exists (select 1 from public.tasks t where t.object_id = objects.id and t.assignee_id = auth.uid())
);
create policy objects_insert on public.objects for insert to authenticated with check (public.is_manager());
create policy objects_update on public.objects for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy objects_delete on public.objects for delete to authenticated using (public.is_manager());

create policy tasks_read on public.tasks for select to authenticated using (
  public.is_manager() or assignee_id = auth.uid()
);
create policy tasks_insert on public.tasks for insert to authenticated with check (
  public.is_manager() and author_id = auth.uid()
);
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy tasks_delete on public.tasks for delete to authenticated using (public.is_manager());

-- visible iff the task is visible (tasks RLS applies inside the subquery)
create policy history_read on public.task_history for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_history.task_id)
);
