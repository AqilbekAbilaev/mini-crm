import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

export type Status = 'new' | 'in_progress' | 'review' | 'accepted' | 'rework'
export type Profile = { id: string; full_name: string; role: 'manager' | 'executor' }
export type Obj = { id: string; name: string; address: string }
export type Task = {
  id: string; title: string; description: string; object_id: string; assignee_id: string
  status: Status; author_id: string; created_at: string
}

export const STATUS: Record<Status, string> = {
  new: 'Новая', in_progress: 'В работе', review: 'На проверке', accepted: 'Принята', rework: 'На доработке',
}
// button labels for transitions, by target status
export const ACTION: Record<Status, string> = {
  new: '', in_progress: 'Взять в работу', review: 'Отправить на проверку', accepted: 'Принять', rework: 'Вернуть на доработку',
}
