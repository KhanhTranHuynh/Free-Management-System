export type Service = { id: string; name: string; price: number; active: boolean }
export type InvoiceItem = { serviceId: string; name: string; price: number; qty: number; amount: number }
export type Invoice = {
  id: string
  number: string
  customer: string
  phone: string
  note: string
  subtotal: number
  discount: number
  total: number
  createdAt: string
  items?: InvoiceItem[]
}
export type NewInvoice = {
  customer: string
  phone: string
  note: string
  discount: number
  items: { serviceId: string; qty: number }[]
}

const API = (import.meta.env.VITE_API_URL as string | undefined) || ''
export const isLocalMode = !API

export const getKey = () => localStorage.getItem('accessKey') || ''
export const setKey = (k: string) => localStorage.setItem('accessKey', k)

async function remote<T>(action: string, data: object = {}): Promise<T> {
  // text/plain để tránh preflight CORS với Apps Script
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, key: getKey(), ...data }),
  })
  const j = await res.json()
  if (!j.ok) throw new Error(j.error || 'Có lỗi xảy ra')
  return j.data as T
}

/* ---------- Chế độ thử trên máy (không cần Google) ---------- */
const load = <T,>(k: string, def: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v ? (JSON.parse(v) as T) : def
  } catch {
    return def
  }
}
const save = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
const uid = () => crypto.randomUUID()

const local = {
  listServices: async (): Promise<Service[]> =>
    load<Service[]>('l_services', [
      { id: uid(), name: 'Dịch vụ mẫu A', price: 100000, active: true },
      { id: uid(), name: 'Dịch vụ mẫu B', price: 250000, active: true },
    ]).filter((s) => s.active),
  saveService: async (p: { id?: string; name: string; price: number }): Promise<Service> => {
    const all = load<Service[]>('l_services', await local.listServices())
    if (p.id) {
      const s = all.find((x) => x.id === p.id)
      if (!s) throw new Error('Không tìm thấy dịch vụ')
      s.name = p.name
      s.price = p.price
      save('l_services', all)
      return s
    }
    const s = { id: uid(), name: p.name, price: p.price, active: true }
    all.push(s)
    save('l_services', all)
    return s
  },
  deleteService: async (p: { id: string }) => {
    const all = load<Service[]>('l_services', [])
    const s = all.find((x) => x.id === p.id)
    if (s) s.active = false
    save('l_services', all)
    return true
  },
  createInvoice: async (p: NewInvoice): Promise<Invoice> => {
    const cat = await local.listServices()
    let subtotal = 0
    const items: InvoiceItem[] = p.items.map((it) => {
      const s = cat.find((c) => c.id === it.serviceId)
      if (!s) throw new Error('Dịch vụ không tồn tại')
      const amount = s.price * it.qty
      subtotal += amount
      return { serviceId: s.id, name: s.name, price: s.price, qty: it.qty, amount }
    })
    const discount = Math.min(Math.max(p.discount || 0, 0), subtotal)
    const all = load<Invoice[]>('l_invoices', [])
    const d = new Date()
    const prefix = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
    const n = all.filter((i) => i.number.startsWith(prefix)).length + 1
    const inv: Invoice = {
      id: uid(), number: `${prefix}-${String(n).padStart(4, '0')}`,
      customer: p.customer, phone: p.phone, note: p.note,
      subtotal, discount, total: subtotal - discount, createdAt: d.toISOString(), items,
    }
    all.push(inv)
    save('l_invoices', all)
    return inv
  },
  listInvoices: async (): Promise<Invoice[]> => load<Invoice[]>('l_invoices', []).slice().reverse(),
  getInvoice: async (p: { id: string }): Promise<Invoice> => {
    const i = load<Invoice[]>('l_invoices', []).find((x) => x.id === p.id)
    if (!i) throw new Error('Không tìm thấy hóa đơn')
    return i
  },
}

function call<T>(action: keyof typeof local, data: object = {}): Promise<T> {
  if (isLocalMode) return (local[action] as (d: object) => Promise<T>)(data)
  return remote<T>(action, data)
}

export const api = {
  listServices: () => call<Service[]>('listServices'),
  saveService: (p: { id?: string; name: string; price: number }) => call<Service>('saveService', p),
  deleteService: (id: string) => call<boolean>('deleteService', { id }),
  createInvoice: (p: NewInvoice) => call<Invoice>('createInvoice', p),
  listInvoices: () => call<Invoice[]>('listInvoices'),
  getInvoice: (id: string) => call<Invoice>('getInvoice', { id }),
}
