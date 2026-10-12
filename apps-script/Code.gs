/**
 * Backend hóa đơn dịch vụ - Google Apps Script (gắn với Google Sheet).
 * Cách dùng: xem README.md. Chạy hàm setup() MỘT LẦN để tạo sheet + mã truy cập.
 *
 * Bản tối ưu tốc độ:
 *  - Cache danh sách dịch vụ / danh sách hóa đơn / chi tiết hóa đơn (CacheService).
 *  - Số hóa đơn dùng bộ đếm, không đếm lại cả sheet.
 *  - Chỉ đọc 100 dòng cuối khi liệt kê hóa đơn; tìm hóa đơn bằng TextFinder.
 *  - Chỉ khóa (lock) khi ghi, các thao tác đọc không phải chờ.
 */

const SHEETS = {
  Services: ['id', 'name', 'price', 'active'],
  Invoices: ['id', 'number', 'customer', 'phone', 'note', 'subtotal', 'discount', 'total', 'createdAt'],
  InvoiceItems: ['invoiceId', 'serviceId', 'name', 'price', 'qty', 'amount'],
};

// Thời gian nhớ cache (giây). Nếu bạn sửa tay giá trong Sheet, tối đa chờ ngần này
// hoặc chạy hàm clearCache() để áp dụng ngay.
const CACHE_TTL = 600;

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  const sv = ss.getSheetByName('Services');
  if (sv.getLastRow() === 1) {
    sv.getRange(2, 1, 3, 4).setValues([
      [Utilities.getUuid(), 'Dịch vụ mẫu A', 100000, true],
      [Utilities.getUuid(), 'Dịch vụ mẫu B', 250000, true],
      [Utilities.getUuid(), 'Dịch vụ mẫu C', 50000, true],
    ]);
  }
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ACCESS_KEY')) {
    props.setProperty('ACCESS_KEY', Utilities.getUuid().slice(0, 8));
  }
  Logger.log('MÃ TRUY CẬP (nhập vào web ở tab Cài đặt): ' + props.getProperty('ACCESS_KEY'));
}

// Chạy tay khi bạn sửa dữ liệu trực tiếp trong Sheet và muốn web thấy ngay.
function clearCache() {
  cacheDel_('services', 'invoices');
}

function doGet() {
  return json_({ ok: true, data: 'Hóa đơn API đang chạy' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Dữ liệu gửi lên không hợp lệ' });
  }
  const key = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
  if (!key || req.key !== key) return json_({ ok: false, error: 'Sai mã truy cập' });

  // Chỉ khóa khi ghi dữ liệu; đọc thì chạy ngay, không chờ nhau.
  const isWrite = req.action === 'saveService' || req.action === 'deleteService' || req.action === 'createInvoice';
  const lock = isWrite ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(20000);
  try {
    let data;
    switch (req.action) {
      case 'listServices': data = listServices_(); break;
      case 'saveService': data = saveService_(req); cacheDel_('services'); break;
      case 'deleteService': data = deleteService_(req); cacheDel_('services'); break;
      case 'createInvoice': data = createInvoice_(req); break;
      case 'listInvoices': data = listInvoices_(); break;
      case 'getInvoice': data = getInvoice_(req.id); break;
      default: throw new Error('Hành động không hợp lệ');
    }
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Cache ---------- */
function cacheGet_(k) {
  try {
    const v = CacheService.getScriptCache().get(k);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}
function cachePut_(k, val) {
  try {
    CacheService.getScriptCache().put(k, JSON.stringify(val), CACHE_TTL);
  } catch (e) {}
}
function cacheDel_() {
  try {
    CacheService.getScriptCache().removeAll(Array.prototype.slice.call(arguments));
  } catch (e) {}
}

/* ---------- Sheet helpers ---------- */
function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Chưa có sheet ' + name + ' - hãy chạy setup()');
  return sh;
}

function toObj_(head, row) {
  const o = {};
  head.forEach(function (h, i) { o[h] = row[i]; });
  return o;
}

// Đọc toàn bộ sheet nhỏ (chỉ dùng cho Services).
function rows_(name) {
  const v = sheet_(name).getDataRange().getValues();
  const head = v.shift();
  return v.map(function (r) { return toObj_(head, r); });
}

// Tìm các dòng có cột A = id mà không đọc cả sheet.
function findRows_(name, id) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const found = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchCase(true).matchEntireCell(true).findAll();
  if (!found.length) return [];
  const nums = found.map(function (r) { return r.getRow(); });
  const lo = Math.min.apply(null, nums);
  const hi = Math.max.apply(null, nums);
  const head = SHEETS[name];
  return sh.getRange(lo, 1, hi - lo + 1, head.length).getValues()
    .filter(function (r) { return r[0] === id; })
    .map(function (r) { return toObj_(head, r); });
}

/* ---------- Dịch vụ ---------- */
function listServices_() {
  const cached = cacheGet_('services');
  if (cached) return cached;
  const list = rows_('Services')
    .filter(function (s) { return s.active === true || s.active === 'TRUE'; })
    .map(function (s) { return { id: s.id, name: s.name, price: Number(s.price), active: true }; });
  cachePut_('services', list);
  return list;
}

function saveService_(req) {
  const name = String(req.name || '').trim();
  const price = Number(req.price);
  if (!name) throw new Error('Thiếu tên dịch vụ');
  if (!isFinite(price) || price < 0) throw new Error('Giá không hợp lệ');
  const sh = sheet_('Services');
  if (req.id) {
    const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === req.id) {
        sh.getRange(i + 2, 2, 1, 3).setValues([[name, price, true]]);
        return { id: req.id, name: name, price: price, active: true };
      }
    }
    throw new Error('Không tìm thấy dịch vụ');
  }
  const id = Utilities.getUuid();
  sh.appendRow([id, name, price, true]);
  return { id: id, name: name, price: price, active: true };
}

// Chỉ ẩn dịch vụ (active=false) để hóa đơn cũ vẫn giữ nguyên dữ liệu.
function deleteService_(req) {
  const sh = sheet_('Services');
  const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === req.id) {
      sh.getRange(i + 2, 4).setValue(false);
      return true;
    }
  }
  throw new Error('Không tìm thấy dịch vụ');
}

/* ---------- Hóa đơn ---------- */
// Bộ đếm số hóa đơn theo tháng (lần đầu đếm từ sheet, sau đó chỉ cộng 1).
function nextSeq_(prefix) {
  const props = PropertiesService.getScriptProperties();
  const k = 'SEQ_' + prefix;
  let n = Number(props.getProperty(k));
  if (!n) {
    n = 0;
    const sh = sheet_('Invoices');
    const last = sh.getLastRow();
    if (last > 1) {
      sh.getRange(2, 2, last - 1, 1).getValues().forEach(function (r) {
        if (String(r[0]).indexOf(prefix) === 0) n++;
      });
    }
  }
  n++;
  props.setProperty(k, String(n));
  return n;
}

function createInvoice_(req) {
  const items = req.items || [];
  if (!items.length) throw new Error('Chưa chọn dịch vụ nào');
  // Giá luôn lấy từ Sheet (qua cache ngắn hạn), không tin giá từ trình duyệt.
  const catalog = {};
  listServices_().forEach(function (s) { catalog[s.id] = s; });

  let subtotal = 0;
  const lines = items.map(function (it) {
    const s = catalog[it.serviceId];
    const qty = Math.floor(Number(it.qty));
    if (!s) throw new Error('Dịch vụ không tồn tại hoặc đã bị ẩn');
    if (!(qty > 0) || qty > 9999) throw new Error('Số lượng không hợp lệ');
    const amount = s.price * qty;
    subtotal += amount;
    return { serviceId: s.id, name: s.name, price: s.price, qty: qty, amount: amount };
  });
  const discount = Math.min(Math.max(Number(req.discount) || 0, 0), subtotal);
  const total = subtotal - discount;

  const now = new Date();
  const prefix = Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'yyyyMM');
  const number = prefix + '-' + ('0000' + nextSeq_(prefix)).slice(-4);
  const id = Utilities.getUuid();
  const createdAt = now.toISOString();
  const customer = String(req.customer || '').trim();
  const phone = String(req.phone || '').trim();
  const note = String(req.note || '').trim();

  sheet_('Invoices').appendRow([id, number, customer, "'" + phone, note, subtotal, discount, total, createdAt]);
  const isheet = sheet_('InvoiceItems');
  isheet.getRange(isheet.getLastRow() + 1, 1, lines.length, 6).setValues(
    lines.map(function (l) { return [id, l.serviceId, l.name, l.price, l.qty, l.amount]; })
  );

  const out = { id: id, number: number, customer: customer, phone: phone, note: note,
    subtotal: subtotal, discount: discount, total: total, createdAt: createdAt, items: lines };
  cacheDel_('invoices');
  cachePut_('inv_' + id, out); // hóa đơn không đổi nên cache chi tiết luôn
  return out;
}

function normInvoice_(r) {
  return { id: r.id, number: r.number, customer: r.customer, phone: String(r.phone || '').replace(/^'/, ''), note: r.note,
    subtotal: Number(r.subtotal), discount: Number(r.discount), total: Number(r.total),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt };
}

// Chỉ đọc tối đa 100 dòng cuối của sheet Invoices.
function listInvoices_() {
  const cached = cacheGet_('invoices');
  if (cached) return cached;
  const sh = sheet_('Invoices');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = Math.min(100, last - 1);
  const head = SHEETS.Invoices;
  const list = sh.getRange(last - n + 1, 1, n, head.length).getValues()
    .map(function (r) { return normInvoice_(toObj_(head, r)); })
    .reverse();
  cachePut_('invoices', list);
  return list;
}

function getInvoice_(id) {
  const cached = cacheGet_('inv_' + id);
  if (cached) return cached;
  const inv = findRows_('Invoices', id)[0];
  if (!inv) throw new Error('Không tìm thấy hóa đơn');
  const items = findRows_('InvoiceItems', id).map(function (r) {
    return { serviceId: r.serviceId, name: r.name, price: Number(r.price), qty: Number(r.qty), amount: Number(r.amount) };
  });
  const o = normInvoice_(inv);
  o.items = items;
  cachePut_('inv_' + id, o);
  return o;
}
