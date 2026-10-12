import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, cache, getKey, isLocalMode, setKey, type Invoice, type Service } from './api'

const money = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' ₫'
const dateStr = (iso: string) => new Date(iso).toLocaleString('vi-VN')
type Tab = 'new' | 'invoices' | 'services' | 'settings'

// VietQR (miễn phí, không cần API key): Techcombank, BIN 970407
const BANK_BIN = '970407'
const qrUrl = (acc: string, name: string, amount: number, memo: string) =>
  `https://img.vietqr.io/image/${BANK_BIN}-${encodeURIComponent(acc)}-compact2.png` +
  `?amount=${Math.round(amount)}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(name)}`

export default function App() {
  const [tab, setTab] = useState<Tab>('new')
  // Có sẵn cache trên máy thì hiện ngay, không chờ server.
  const [services, setServices] = useState<Service[]>(() => cache.services() || [])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(() => !cache.services())

  const reload = useCallback(async () => {
    try {
      setServices(await api.listServices())
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    // Tải dịch vụ xong thì tải sẵn danh sách hóa đơn ở nền để mở tab Hóa đơn là có ngay.
    reload().then(() => {
      api.listInvoices().catch(() => {})
    })
  }, [reload])

  return (
    <div className="app">
      <header className="no-print">
        <h1>Hóa đơn dịch vụ</h1>
        {isLocalMode && <span className="badge">Chế độ thử (chưa nối Google)</span>}
      </header>

      {error && (
        <div className="error no-print">
          {error} <button onClick={reload}>Thử lại</button>
        </div>
      )}

      <main>
        {tab === 'new' && <NewInvoice services={services} loading={loading} />}
        {tab === 'invoices' && <InvoiceList />}
        {tab === 'services' && <Services services={services} onChanged={reload} />}
        {tab === 'settings' && <Settings />}
      </main>

      <nav className="no-print">
        {(
          [['new', 'Tạo hóa đơn'], ['invoices', 'Hóa đơn'], ['services', 'Dịch vụ'], ['settings', 'Cài đặt']] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function NewInvoice({ services, loading }: { services: Service[]; loading: boolean }) {
  const [qty, setQty] = useState<Record<string, number>>({})
  const [customer, setCustomer] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [discount, setDiscount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Invoice | null>(null)

  const subtotal = useMemo(
    () => services.reduce((sum, s) => sum + s.price * (qty[s.id] || 0), 0),
    [services, qty],
  )
  const disc = Math.min(Math.max(discount || 0, 0), subtotal)
  const total = subtotal - disc
  const picked = services.filter((s) => (qty[s.id] || 0) > 0)

  const setQ = (id: string, v: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(9999, v)) }))

  async function submit() {
    if (!picked.length) return setErr('Hãy chọn ít nhất một dịch vụ')
    setBusy(true)
    setErr('')
    try {
      const inv = await api.createInvoice({
        customer, phone, note, discount: disc,
        items: picked.map((s) => ({ serviceId: s.id, qty: qty[s.id] })),
      })
      setDone(inv)
      setQty({}); setCustomer(''); setPhone(''); setNote(''); setDiscount(0)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) return <InvoiceView invoice={done} onClose={() => setDone(null)} closeLabel="Tạo hóa đơn mới" />

  return (
    <section>
      <h2>Chọn dịch vụ</h2>
      {loading && <p className="muted">Đang tải...</p>}
      {!loading && !services.length && <p className="muted">Chưa có dịch vụ. Vào tab “Dịch vụ” để thêm.</p>}
      <ul className="list">
        {services.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{s.name}</strong>
              <div className="muted">{money(s.price)}</div>
            </div>
            <div className="stepper">
              <button onClick={() => setQ(s.id, (qty[s.id] || 0) - 1)} aria-label="Giảm">−</button>
              <input
                inputMode="numeric"
                value={qty[s.id] || 0}
                onChange={(e) => setQ(s.id, parseInt(e.target.value.replace(/\D/g, '') || '0', 10))}
              />
              <button onClick={() => setQ(s.id, (qty[s.id] || 0) + 1)} aria-label="Tăng">+</button>
            </div>
          </li>
        ))}
      </ul>

      <h2>Khách hàng</h2>
      <div className="form">
        <input placeholder="Tên khách hàng" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        <input placeholder="Số điện thoại" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
        <input
          placeholder="Giảm giá (₫)"
          inputMode="numeric"
          value={discount || ''}
          onChange={(e) => setDiscount(parseInt(e.target.value.replace(/\D/g, '') || '0', 10))}
        />
      </div>

      <div className="totals">
        <div><span>Tạm tính</span><span>{money(subtotal)}</span></div>
        {disc > 0 && <div><span>Giảm giá</span><span>− {money(disc)}</span></div>}
        <div className="grand"><span>Tổng cộng</span><span>{money(total)}</span></div>
      </div>
      {err && <p className="error">{err}</p>}
      <button className="primary" disabled={busy || !picked.length} onClick={submit}>
        {busy ? 'Đang lưu...' : 'Xuất hóa đơn'}
      </button>
    </section>
  )
}

function InvoiceView({ invoice, onClose, closeLabel }: { invoice: Invoice; onClose: () => void; closeLabel: string }) {
  const shop = localStorage.getItem('shopName') || 'Tên cửa hàng'
  const info = localStorage.getItem('shopInfo') || ''
  const bankAcc = (localStorage.getItem('bankAcc') || '').replace(/\s/g, '')
  const bankName = localStorage.getItem('bankName') || ''
  const memo = 'HD' + invoice.number.replace(/\D/g, '')
  return (
    <section>
      <div className="invoice">
        <h2 className="center">{shop}</h2>
        {info && <p className="center muted pre">{info}</p>}
        <h3 className="center">HÓA ĐƠN {invoice.number}</h3>
        <p className="muted">Ngày: {dateStr(invoice.createdAt)}</p>
        {invoice.customer && <p>Khách hàng: <strong>{invoice.customer}</strong></p>}
        {invoice.phone && <p>SĐT: {invoice.phone}</p>}
        <table>
          <thead>
            <tr><th>Dịch vụ</th><th className="r">SL</th><th className="r">Đơn giá</th><th className="r">Thành tiền</th></tr>
          </thead>
          <tbody>
            {(invoice.items || []).map((it, i) => (
              <tr key={i}>
                <td>{it.name}</td><td className="r">{it.qty}</td>
                <td className="r">{money(it.price)}</td><td className="r">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="totals">
          <div><span>Tạm tính</span><span>{money(invoice.subtotal)}</span></div>
          {invoice.discount > 0 && <div><span>Giảm giá</span><span>− {money(invoice.discount)}</span></div>}
          <div className="grand"><span>Tổng cộng</span><span>{money(invoice.total)}</span></div>
        </div>
        {bankAcc && invoice.total > 0 && (
          <div className="qr center">
            <img src={qrUrl(bankAcc, bankName, invoice.total, memo)} alt="Mã QR chuyển khoản" />
            <p className="muted">
              Techcombank · {bankAcc}{bankName && ` · ${bankName}`}
              <br />
              Quét QR để chuyển đúng {money(invoice.total)}, nội dung: {memo}
            </p>
          </div>
        )}
        {invoice.note && <p className="muted">Ghi chú: {invoice.note}</p>}
        <p className="center muted">Cảm ơn quý khách!</p>
      </div>
      <div className="actions no-print">
        <button className="primary" onClick={() => window.print()}>In / Lưu PDF</button>
        <button onClick={onClose}>{closeLabel}</button>
      </div>
    </section>
  )
}

function InvoiceList() {
  const [list, setList] = useState<Invoice[]>(() => cache.invoices() || [])
  const [open, setOpen] = useState<Invoice | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(() => !cache.invoices())

  useEffect(() => {
    api.listInvoices().then(setList).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }, [])

  async function view(id: string) {
    try {
      setOpen(await api.getInvoice(id))
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  if (open) return <InvoiceView invoice={open} onClose={() => setOpen(null)} closeLabel="Quay lại danh sách" />
  return (
    <section>
      <h2>Hóa đơn gần đây</h2>
      {err && <p className="error">{err}</p>}
      {loading && <p className="muted">Đang tải...</p>}
      {!loading && !list.length && <p className="muted">Chưa có hóa đơn.</p>}
      <ul className="list">
        {list.map((i) => (
          <li key={i.id} onClick={() => view(i.id)} className="click">
            <div>
              <strong>{i.number}</strong> {i.customer && `· ${i.customer}`}
              <div className="muted">{dateStr(i.createdAt)}</div>
            </div>
            <strong>{money(i.total)}</strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Services({ services, onChanged }: { services: Service[]; onChanged: () => void }) {
  const [editId, setEditId] = useState<string | undefined>()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => { setEditId(undefined); setName(''); setPrice('') }

  async function submit() {
    const p = parseInt(price.replace(/\D/g, '') || '', 10)
    if (!name.trim()) return setErr('Nhập tên dịch vụ')
    if (!Number.isFinite(p)) return setErr('Nhập giá hợp lệ')
    setBusy(true)
    setErr('')
    try {
      await api.saveService({ id: editId, name: name.trim(), price: p })
      reset()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(s: Service) {
    if (!confirm(`Ẩn dịch vụ “${s.name}”? Hóa đơn cũ vẫn giữ nguyên.`)) return
    try {
      await api.deleteService(s.id)
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <section>
      <h2>{editId ? 'Sửa dịch vụ' : 'Thêm dịch vụ'}</h2>
      <div className="form">
        <input placeholder="Tên dịch vụ" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Giá (₫)" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button className="primary" disabled={busy} onClick={submit}>{editId ? 'Lưu' : 'Thêm'}</button>
          {editId && <button onClick={reset}>Hủy</button>}
        </div>
      </div>
      <h2>Danh sách dịch vụ</h2>
      <ul className="list">
        {services.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{s.name}</strong>
              <div className="muted">{money(s.price)}</div>
            </div>
            <div className="actions">
              <button onClick={() => { setEditId(s.id); setName(s.name); setPrice(String(s.price)) }}>Sửa</button>
              <button onClick={() => remove(s)}>Ẩn</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Settings() {
  const [key, setK] = useState(getKey())
  const [shop, setShop] = useState(localStorage.getItem('shopName') || '')
  const [info, setInfo] = useState(localStorage.getItem('shopInfo') || '')
  const [bankAcc, setBankAcc] = useState(localStorage.getItem('bankAcc') || '')
  const [bankName, setBankName] = useState(localStorage.getItem('bankName') || '')
  const [saved, setSaved] = useState(false)

  function save() {
    localStorage.setItem('bankAcc', bankAcc.replace(/\s/g, ''))
    localStorage.setItem('bankName', bankName.trim().toUpperCase())
    setKey(key.trim())
    localStorage.setItem('shopName', shop)
    localStorage.setItem('shopInfo', info)
    setSaved(true)
    setTimeout(() => location.reload(), 600)
  }

  return (
    <section>
      <h2>Cài đặt</h2>
      <div className="form">
        <label>Tên cửa hàng (hiện trên hóa đơn)</label>
        <input value={shop} onChange={(e) => setShop(e.target.value)} />
        <label>Địa chỉ / SĐT / STK (hiện trên hóa đơn)</label>
        <textarea rows={3} value={info} onChange={(e) => setInfo(e.target.value)} />
        <label>Số tài khoản Techcombank (để tạo QR thanh toán)</label>
        <input inputMode="numeric" value={bankAcc} onChange={(e) => setBankAcc(e.target.value)} />
        <label>Tên chủ tài khoản (không dấu, viết hoa)</label>
        <input value={bankName} onChange={(e) => setBankName(e.target.value)} />
        {!isLocalMode && (
          <>
            <label>Mã truy cập (lấy từ Apps Script)</label>
            <input type="password" value={key} onChange={(e) => setK(e.target.value)} />
          </>
        )}
        <button className="primary" onClick={save}>{saved ? 'Đã lưu ✓' : 'Lưu cài đặt'}</button>
      </div>
    </section>
  )
}
