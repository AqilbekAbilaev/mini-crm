import { createContext, useContext, useEffect, useState } from 'react'
import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from './supabase'
import { MyTasks, ObjectCard, ObjectList, TaskCard } from './pages'

type Ctx = { me: Profile; profiles: Profile[] }
const AppCtx = createContext<Ctx>(null!)
export const useApp = () => useContext(AppCtx)

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>()
  const [ctx, setCtx] = useState<Ctx | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return setCtx(null)
    supabase.from('profiles').select('*').order('full_name').then(({ data }) => {
      const me = data?.find(p => p.id === uid)
      if (me) setCtx({ me, profiles: data! })
    })
  }, [uid])

  if (session === undefined) return null
  if (!session) return <Login />
  if (!ctx) return <main className="container" aria-busy="true" />

  const manager = ctx.me.role === 'manager'
  return (
    <AppCtx.Provider value={ctx}>
      <HashRouter>
        <nav className="container" style={{ marginBottom: '2rem', borderBottom: '1px solid var(--pico-muted-border-color)' }}>
          <ul>
            <li><Link to="/objects">Объекты</Link></li>
            {!manager && <li><Link to="/my">Мои задачи</Link></li>}
          </ul>
          <ul>
            <li><small>{ctx.me.full_name} · {manager ? 'постановщик' : 'исполнитель'}</small></li>
            <li><button className="secondary outline" onClick={() => supabase.auth.signOut()}>Выйти</button></li>
          </ul>
        </nav>
        <main className="container">
          <Routes>
            <Route path="/objects" element={<ObjectList />} />
            <Route path="/objects/:id" element={<ObjectCard />} />
            <Route path="/tasks/:id" element={<TaskCard />} />
            <Route path="/my" element={<MyTasks />} />
            <Route path="*" element={<Navigate to={manager ? '/objects' : '/my'} />} />
          </Routes>
        </main>
      </HashRouter>
    </AppCtx.Provider>
  )
}

function Login() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <main className="container" style={{ maxWidth: 420, marginTop: '10vh' }}>
      <h2>Вход</h2>
      <form onSubmit={async e => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        setBusy(true)
        const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email')), password: String(f.get('password')) })
        setBusy(false)
        setError(error ? 'Неверный email или пароль' : '')
      }}>
        <input name="email" type="email" placeholder="Email" required autoComplete="email" />
        <input name="password" type="password" placeholder="Пароль" required autoComplete="current-password" />
        {error && <p><small style={{ color: 'var(--pico-del-color)' }}>{error}</small></p>}
        <button aria-busy={busy} disabled={busy}>Войти</button>
      </form>
    </main>
  )
}
