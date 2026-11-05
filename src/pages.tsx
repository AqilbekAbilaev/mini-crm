import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ACTION, STATUS, supabase, type Obj, type Status, type Task } from './supabase'
import { useApp } from './App'

type History = { id: number; from_status: Status | null; to_status: Status; comment: string | null; changed_by: string; changed_at: string }

// Load once + reload on demand. Errors from Supabase/RLS are shown, never swallowed.
function useLoad<T>(fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>, deps: unknown[]) {
  const [data, setData] = useState<T | null | undefined>(undefined)
  const [error, setError] = useState('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => { fn().then(r => { setData(r.data); setError(r.error?.message ?? '') }) }, deps)
  useEffect(reload, [reload])
  return { data, error, reload }
}

const fmt = (d: string) => new Date(d).toLocaleString('ru-RU')
const form = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string> }
const Err = ({ msg }: { msg: string }) => msg ? <p style={{ color: 'var(--pico-del-color)' }}>{msg}</p> : null
const Badge = ({ s }: { s: Status }) => <mark>{STATUS[s]}</mark>

export function ObjectList() {
  const { me } = useApp()
  const { data, error, reload } = useLoad(() => supabase.from('objects').select('*').order('name'), [])
  const [err, setErr] = useState('')
  return (
    <>
      <h2>Объекты</h2>
      <Err msg={error || err} />
      <table>
        <thead><tr><th>Название</th><th>Адрес</th></tr></thead>
        <tbody>
          {data?.map((o: Obj) => <tr key={o.id}><td><Link to={`/objects/${o.id}`}>{o.name}</Link></td><td>{o.address}</td></tr>)}
          {data?.length === 0 && <tr><td colSpan={2}>Нет объектов</td></tr>}
        </tbody>
      </table>
      {me.role === 'manager' && (
        <details>
          <summary>Новый объект</summary>
          <form onSubmit={async e => {
            const el = e.currentTarget, v = form(e)
            const { error } = await supabase.from('objects').insert({ name: v.name, address: v.address })
            setErr(error?.message ?? '')
            if (!error) { el.reset(); reload() }
          }}>
            <input name="name" placeholder="Название" required />
            <input name="address" placeholder="Адрес" />
            <button>Создать</button>
          </form>
        </details>
      )}
    </>
  )
}

export function ObjectCard() {
  const { id } = useParams()
  const { me, profiles } = useApp()
  const nav = useNavigate()
  const obj = useLoad(() => supabase.from('objects').select('*').eq('id', id!).maybeSingle(), [id])
  const tasks = useLoad(() => supabase.from('tasks').select('*').eq('object_id', id!).order('created_at'), [id])
  const [err, setErr] = useState('')
  const manager = me.role === 'manager'
  const name = (uid: string) => profiles.find(p => p.id === uid)?.full_name ?? '—'
  const o = obj.data as Obj | null

  if (obj.error) return <Err msg={obj.error} />
  if (!obj.data) return obj.data === null && <p>Объект не найден или нет доступа</p>

  return (
    <>
      <p><Link to="/objects">← Объекты</Link></p>
      {manager ? (
        <form onSubmit={async e => {
          const v = form(e)
          const { error } = await supabase.from('objects').update({ name: v.name, address: v.address }).eq('id', id!)
          setErr(error?.message ?? '')
          if (!error) obj.reload()
        }}>
          <fieldset role="group"><input name="name" defaultValue={o!.name} required /><input name="address" defaultValue={o!.address} /><button>Сохранить</button></fieldset>
          <button type="button" className="secondary outline" onClick={async () => {
            if (!confirm('Удалить объект?')) return
            const { error } = await supabase.from('objects').delete().eq('id', id!)
            if (error) setErr(error.code === '23503' ? 'Нельзя удалить объект, у которого есть задачи' : error.message)
            else nav('/objects')
          }}>Удалить объект</button>
        </form>
      ) : <><h2>{o!.name}</h2><p>{o!.address}</p></>}
      <Err msg={err || tasks.error} />

      <h3>Задачи</h3>
      <TaskTable tasks={tasks.data as Task[] | null} name={name} />

      {manager && (
        <details>
          <summary>Новая задача</summary>
          <form onSubmit={async e => {
            const el = e.currentTarget, v = form(e)
            const { error } = await supabase.from('tasks').insert({ title: v.title, description: v.description, assignee_id: v.assignee_id, object_id: id })
            setErr(error?.message ?? '')
            if (!error) { el.reset(); tasks.reload() }
          }}>
            <TaskFields />
            <button>Создать</button>
          </form>
        </details>
      )}
    </>
  )
}

function TaskFields({ t }: { t?: Task }) {
  const { profiles } = useApp()
  return (
    <>
      <input name="title" placeholder="Название" defaultValue={t?.title} required />
      <textarea name="description" placeholder="Описание" defaultValue={t?.description} />
      <select name="assignee_id" defaultValue={t?.assignee_id ?? ''} required>
        <option value="" disabled>Исполнитель…</option>
        {profiles.filter(p => p.role === 'executor').map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>
    </>
  )
}

function TaskTable({ tasks, name, objName }: { tasks: Task[] | null; name: (id: string) => string; objName?: (id: string) => string }) {
  return (
    <table>
      <thead><tr><th>Задача</th>{objName && <th>Объект</th>}<th>Исполнитель</th><th>Статус</th></tr></thead>
      <tbody>
        {tasks?.map(t => (
          <tr key={t.id}>
            <td><Link to={`/tasks/${t.id}`}>{t.title}</Link></td>
            {objName && <td>{objName(t.object_id)}</td>}
            <td>{name(t.assignee_id)}</td>
            <td><Badge s={t.status} /></td>
          </tr>
        ))}
        {tasks?.length === 0 && <tr><td colSpan={4}>Нет задач</td></tr>}
      </tbody>
    </table>
  )
}

export function TaskCard() {
  const { id } = useParams()
  const { me, profiles } = useApp()
  const nav = useNavigate()
  const task = useLoad(() => supabase.from('tasks').select('*, objects(id, name)').eq('id', id!).maybeSingle(), [id])
  const hist = useLoad(() => supabase.from('task_history').select('*').eq('task_id', id!).order('changed_at'), [id])
  const allowed = useLoad(() => supabase.rpc('allowed_transitions', { p_task_id: id }), [id])
  const [err, setErr] = useState('')
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)
  const name = (uid: string) => profiles.find(p => p.id === uid)?.full_name ?? '—'
  const t = task.data as (Task & { objects: Obj }) | null
  const reloadAll = () => { task.reload(); hist.reload(); allowed.reload() }

  if (task.error) return <Err msg={task.error} />
  if (!t) return task.data === null && <p>Задача не найдена или нет доступа</p>

  const move = async (to: Status) => {
    if (to === 'rework' && !comment.trim()) return setErr('Для возврата на доработку нужен комментарий')
    const { error } = await supabase.rpc('change_task_status', { p_task_id: id, p_to: to, p_comment: comment })
    setErr(error?.message ?? '')
    if (!error) { setComment(''); reloadAll() }
  }

  return (
    <>
      <p><Link to={`/objects/${t.object_id}`}>← {t.objects.name}</Link></p>
      <article>
        {editing ? (
          <form onSubmit={async e => {
            const v = form(e)
            const { error } = await supabase.from('tasks').update({ title: v.title, description: v.description, assignee_id: v.assignee_id }).eq('id', id!)
            setErr(error?.message ?? '')
            if (!error) { setEditing(false); reloadAll() }
          }}>
            <TaskFields t={t} />
            <div role="group"><button>Сохранить</button><button type="button" className="secondary" onClick={() => setEditing(false)}>Отмена</button></div>
          </form>
        ) : (
          <>
            <header><h3 style={{ margin: 0 }}>{t.title} <Badge s={t.status} /></h3></header>
            <p style={{ whiteSpace: 'pre-wrap' }}>{t.description || <i>Без описания</i>}</p>
            <small>
              Объект: {t.objects.name} · Исполнитель: {name(t.assignee_id)} · Автор: {name(t.author_id)} · Создана: {fmt(t.created_at)}
            </small>
            {me.role === 'manager' && (
              <footer>
                <div role="group">
                  <button className="secondary outline" onClick={() => setEditing(true)}>Редактировать</button>
                  <button className="secondary outline" onClick={async () => {
                    if (!confirm('Удалить задачу вместе с историей?')) return
                    const { error } = await supabase.from('tasks').delete().eq('id', id!)
                    if (error) setErr(error.message); else nav(`/objects/${t.object_id}`)
                  }}>Удалить</button>
                </div>
              </footer>
            )}
          </>
        )}
      </article>

      <Err msg={err || hist.error || allowed.error} />
      {(allowed.data as Status[] | null)?.length ? (
        <article>
          <textarea value={comment} onChange={e => setComment(e.target.value)}
            placeholder={(allowed.data as Status[]).includes('rework') ? 'Комментарий (обязателен при возврате на доработку)' : 'Комментарий (необязательно)'} />
          <div role="group">
            {(allowed.data as Status[]).map(s => <button key={s} className={s === 'rework' ? 'secondary' : ''} onClick={() => move(s)}>{ACTION[s]}</button>)}
          </div>
        </article>
      ) : null}

      <h4>История</h4>
      <table>
        <thead><tr><th>Когда</th><th>Кто</th><th>Переход</th><th>Комментарий</th></tr></thead>
        <tbody>
          {(hist.data as History[] | null)?.map(h => (
            <tr key={h.id}>
              <td>{fmt(h.changed_at)}</td>
              <td>{name(h.changed_by)}</td>
              <td>{h.from_status ? STATUS[h.from_status] : '—'} → {STATUS[h.to_status]}</td>
              <td>{h.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function MyTasks() {
  const { me, profiles } = useApp()
  // RLS already limits executors to their own tasks; the filter just makes intent explicit
  const tasks = useLoad(() => supabase.from('tasks').select('*, objects(name)').eq('assignee_id', me.id).order('created_at'), [me.id])
  const name = (uid: string) => profiles.find(p => p.id === uid)?.full_name ?? '—'
  const list = tasks.data as (Task & { objects: { name: string } })[] | null
  return (
    <>
      <h2>Мои задачи</h2>
      <Err msg={tasks.error} />
      <TaskTable tasks={list} name={name} objName={oid => list?.find(t => t.object_id === oid)?.objects.name ?? ''} />
    </>
  )
}
