# Мини-CRM «Объекты и задачи»

React + TypeScript (Vite) + Supabase. Все правила доступа — в базе: `supabase/migrations/20261105000000_init.sql`.

## Запуск

1. Создать проект в Supabase.
2. **SQL Editor** → выполнить по порядку файлы из `supabase/migrations/`
   (или `supabase db push`, если используете Supabase CLI).
3. **Authentication → Sign In / Providers → Email**: выключить *Allow new users to sign up*.
4. `cp .env.example .env` и заполнить URL, anon key и service_role key (Project Settings → API).
5. `npm install`
6. `npm run seed` — создаёт 3 пользователей, 3 объекта, 5 задач во всех статусах
   и прогоняет проверки безопасности через публичный API (должно вывести `security checks passed`).
7. `npm run dev`

Деплой (Vercel/Netlify): собрать `npm run build`, в переменных окружения указать только
`VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. service_role нужен только для `npm run seed` локально.

## Тестовые пользователи (пароль `Test1234!`)

| Email | Роль |
|---|---|
| manager@crm.test | постановщик |
| worker1@crm.test | исполнитель |
| worker2@crm.test | исполнитель |

Новых пользователей создавать в Supabase Dashboard → Authentication → Add user.
Роль берётся из `app_metadata.role` (по умолчанию — исполнитель). Сделать постановщиком (SQL Editor):
`update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"manager"}' where email = '...';`

## Как устроена защита

- RLS на всех таблицах; права `anon` отозваны полностью, `authenticated` получает только нужное.
- Колонки `status`, `author_id`, `created_at` в `tasks` недоступны для записи через API (column-level grants).
  Статус меняется только функцией `change_task_status()`, которая проверяет переход, роль и комментарий,
  и сама пишет историю.
- Список разрешённых переходов — одна функция `allowed_transitions()`; по ней же интерфейс рисует кнопки.
- `task_history` — только чтение для всех пользователей; пишут в неё только функции в базе.
- Роль берётся из `app_metadata` (меняется только с service_role), профили пользователи изменять не могут.
