// Seeds test users + data and self-checks the security rules via the public API.
// Run: node --env-file=.env scripts/seed.mjs   (service_role key is used ONLY here, locally)
import { createClient } from '@supabase/supabase-js'
import assert from 'node:assert/strict'

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service } = process.env
const PASSWORD = 'Test1234!'
const USERS = [
  { email: 'manager@crm.test', full_name: 'Иван Петров (постановщик)', role: 'manager' },
  { email: 'worker1@crm.test', full_name: 'Алексей Смирнов', role: 'executor' },
  { email: 'worker2@crm.test', full_name: 'Мария Кузнецова', role: 'executor' },
]

const admin = createClient(url, service, { auth: { persistSession: false } })
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data }

// users (idempotent)
const existing = ok(await admin.auth.admin.listUsers()).users
for (const u of USERS) {
  if (existing.some(e => e.email === u.email)) continue
  ok(await admin.auth.admin.createUser({
    email: u.email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: u.full_name }, app_metadata: { role: u.role },
  }))
}

const login = async email => {
  const c = createClient(url, anon, { auth: { persistSession: false } })
  const { user } = ok(await c.auth.signInWithPassword({ email, password: PASSWORD }))
  return { c, id: user.id }
}
const [mgr, w1, w2] = await Promise.all(USERS.map(u => login(u.email)))

// data (only if empty)
if (ok(await mgr.c.from('objects').select('id')).length === 0) {
  const objs = ok(await mgr.c.from('objects').insert([
    { name: 'ЖК «Северный»', address: 'ул. Ленина, 12' },
    { name: 'Склад на Промышленной', address: 'Промышленная ул., 4' },
    { name: 'Коттедж Озёрный', address: 'пос. Озёрный, уч. 7' },
  ]).select())
  const task = async (title, o, w) => ok(await mgr.c.from('tasks')
    .insert({ title, description: `Описание: ${title.toLowerCase()}`, object_id: objs[o].id, assignee_id: w.id }).select().single())
  const move = async (who, t, to, comment) => ok(await who.c.rpc('change_task_status', { p_task_id: t.id, p_to: to, p_comment: comment }))

  await task('Залить фундамент секции А', 0, w1)                       // new
  const t2 = await task('Монтаж опалубки', 0, w1)
  await move(w1, t2, 'in_progress')                                    // in_progress
  const t3 = await task('Установить окна 3 этаж', 0, w2)
  await move(w2, t3, 'in_progress'); await move(w2, t3, 'review')      // review
  const t4 = await task('Утеплить кровлю', 1, w2)
  await move(w2, t4, 'in_progress'); await move(w2, t4, 'review')
  await move(mgr, t4, 'rework', 'Швы не проклеены, переделать')        // rework
  const t5 = await task('Подвести электричество', 2, w1)
  await move(w1, t5, 'in_progress'); await move(w1, t5, 'review'); await move(mgr, t5, 'accepted') // accepted
  console.log('seeded')
}

// ---------- security self-check (all through the anon key, like a hostile client) ----------
const w2Tasks = ok(await w2.c.from('tasks').select('*'))
const allTasks = ok(await mgr.c.from('tasks').select('*'))
const w1Task = allTasks.find(t => t.assignee_id === w1.id && t.status === 'new')
const w2Review = allTasks.find(t => t.assignee_id === w2.id && t.status === 'review')
assert(w2Tasks.every(t => t.assignee_id === w2.id), 'executor sees only own tasks')
assert(w2Tasks.length < allTasks.length)

const w2Objects = ok(await w2.c.from('objects').select('id'))
assert(w2Objects.every(o => w2Tasks.some(t => t.object_id === o.id)), 'executor sees only objects with own tasks')

// read / write someone else's task
assert.equal(ok(await w2.c.from('tasks').select().eq('id', w1Task.id)).length, 0)
assert.equal(ok(await w2.c.from('tasks').update({ title: 'hacked' }).eq('id', w1Task.id).select()).length, 0)
assert((await w2.c.rpc('change_task_status', { p_task_id: w1Task.id, p_to: 'in_progress' })).error, 'cannot move foreign task')
// own task: direct status update blocked, illegal transitions blocked, self-accept blocked
assert((await w2.c.from('tasks').update({ status: 'accepted' }).eq('id', w2Review.id)).error, 'status column not writable')
assert((await w2.c.rpc('change_task_status', { p_task_id: w2Review.id, p_to: 'accepted' })).error, 'executor cannot accept')
assert((await mgr.c.rpc('change_task_status', { p_task_id: w1Task.id, p_to: 'accepted' })).error, 'new -> accepted forbidden')
assert((await mgr.c.rpc('change_task_status', { p_task_id: w2Review.id, p_to: 'rework', p_comment: '  ' })).error, 'rework needs comment')
assert((await mgr.c.from('tasks').update({ status: 'accepted' }).eq('id', w2Review.id)).error, 'even manager cannot bypass workflow')
// history is read-only for everyone
const h = ok(await mgr.c.from('task_history').select('*').limit(1))[0]
for (const c of [mgr.c, w2.c]) {
  assert((await c.from('task_history').insert({ task_id: h.task_id, to_status: 'accepted', changed_by: mgr.id })).error, 'history insert blocked')
  assert((await c.from('task_history').update({ comment: 'x' }).eq('id', h.id)).error, 'history update blocked')
  assert((await c.from('task_history').delete().eq('id', h.id)).error, 'history delete blocked')
}
// executor cannot create tasks/objects or promote themselves
assert((await w2.c.from('objects').insert({ name: 'x' })).error)
assert((await w2.c.from('tasks').insert({ title: 'x', object_id: w1Task.object_id, assignee_id: w2.id })).error)
assert((await w2.c.from('profiles').update({ role: 'manager' }).eq('id', w2.id)).error, 'no self-promotion')
// sign-up must be disabled in Auth settings
assert((await createClient(url, anon).auth.signUp({ email: `x${Date.now()}@crm.test`, password: PASSWORD })).error, 'open sign-up is disabled')

console.log('security checks passed')
