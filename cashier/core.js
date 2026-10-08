"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MrRobotCashier = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CATEGORIES = ["موبايلات", "شواحن", "كبلات", "سماعات", "إكسسوارات", "صيانة", "غير ذلك"];
  const PAY_METHODS = [
    { id: "cash", label: "كاش" },
    { id: "transfer", label: "تحويل" },
    { id: "shamcash", label: "شام كاش" }
  ];
  const PAY_IDS = PAY_METHODS.map(function (p) { return p.id; });
  const MIN_AT = Date.UTC(2020, 0, 1);
  const MAX_PRICE = 1000000000;

  function normalizeDigits(value) {
    return String(value).replace(/[٠-٩۰-۹]/g, function (ch) {
      const code = ch.charCodeAt(0);
      if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
      if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
      return ch;
    });
  }

  function newId() {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function emptyData() {
    return {
      version: 1,
      pinHash: "",
      currency: "SYP",
      products: [],
      sales: [],
      movements: [],
      lastExportAt: null
    };
  }

  function validatePrice(raw) {
    if (typeof raw === "number") {
      if (!Number.isSafeInteger(raw) || raw < 0 || raw > MAX_PRICE) return null;
      return raw;
    }
    let s = normalizeDigits(String(raw)).trim().replace(/[\s٬]/g, "");
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");
    else s = s.replace(/,/g, "");
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n > MAX_PRICE) return null;
    return n;
  }

  function validateDiscount(raw) {
    if (raw == null || String(raw).trim() === "") return 0;
    return validatePrice(raw);
  }

  function validateQty(raw) {
    if (typeof raw === "number") {
      if (!Number.isSafeInteger(raw) || raw < 1 || raw > 999) return null;
      return raw;
    }
    const s = normalizeDigits(String(raw)).trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < 1 || n > 999) return null;
    return n;
  }

  function validateStock(raw) {
    if (raw == null || String(raw).trim() === "") return { ok: true, stock: null };
    const s = normalizeDigits(String(raw)).trim();
    if (!/^-?\d+$/.test(s)) return { ok: false };
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < -100000 || n > 1000000) return { ok: false };
    return { ok: true, stock: n };
  }

  function isPin(pin) {
    return /^\d{4}$/.test(normalizeDigits(String(pin).trim()));
  }

  function normalizedPin(pin) {
    const value = normalizeDigits(String(pin).trim());
    if (!/^\d{4}$/.test(value)) return null;
    return value;
  }

  async function hashPin(pin) {
    const normalized = normalizedPin(pin);
    if (!normalized) throw new Error("bad-pin");
    const data = new TextEncoder().encode("mrrobot-cashier-v1|" + normalized);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function formatMoney(n, currency) {
    const v = Math.round(Number(n) || 0);
    const s = v.toLocaleString("en-US");
    return currency === "USD" ? "$" + s : s + " ل.س";
  }

  function formatStamp(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    try {
      const date = d.toLocaleDateString("ar-SY-u-nu-latn", {
        day: "numeric",
        month: "long",
        year: "numeric"
      });
      const time = d.toLocaleTimeString("ar-SY-u-nu-latn", {
        hour: "numeric",
        minute: "2-digit"
      });
      if (date && time) return date + " " + time;
    } catch (err) {
      /* fall through */
    }
    const p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function itemCountLabel(n) {
    const count = Number(n) || 0;
    if (count <= 0) return "ما في قطع";
    if (count === 1) return "قطعة واحدة";
    if (count === 2) return "قطعتين";
    if (count >= 3 && count <= 10) return count + " قطع";
    return count + " قطعة";
  }

  function cartKey(line) {
    return line.productId ? "p:" + line.productId : "c:" + line.name + "|" + line.price;
  }

  function sanitizeCart(lines) {
    if (!Array.isArray(lines)) return [];
    const map = new Map();
    lines.forEach(function (line) {
      if (!line || typeof line.name !== "string") return;
      const name = line.name.trim().slice(0, 80);
      const price = validatePrice(line.price);
      const qty = validateQty(line.qty);
      if (!name || price == null || qty == null) return;
      const productId = typeof line.productId === "string" && line.productId
        ? line.productId.slice(0, 40)
        : null;
      const clean = { productId: productId, name: name, price: price, qty: qty };
      const key = cartKey(clean);
      const prev = map.get(key);
      if (!prev) map.set(key, clean);
      else map.set(key, Object.assign({}, prev, { qty: Math.min(999, prev.qty + qty) }));
    });
    return Array.from(map.values());
  }

  function addToCart(cart, item) {
    const qty = item && item.qty != null ? item.qty : 1;
    return sanitizeCart([].concat(cart || [], [Object.assign({}, item, { qty: qty })]));
  }

  function changeQty(cart, key, qty) {
    const next = [];
    sanitizeCart(cart).forEach(function (line) {
      if (cartKey(line) !== key) {
        next.push(line);
        return;
      }
      if (qty <= 0) return;
      const parsed = validateQty(qty);
      next.push(Object.assign({}, line, { qty: parsed == null ? line.qty : parsed }));
    });
    return next;
  }

  function saleTotals(sale) {
    const items = sale && Array.isArray(sale.items) ? sale.items : [];
    const sub = items.reduce(function (sum, item) {
      return sum + (Number(item.price) || 0) * (Number(item.qty) || 0);
    }, 0);
    const wanted = Math.max(0, Number(sale && sale.discount) || 0);
    const discount = Math.min(wanted, sub);
    return { sub: sub, discount: discount, total: sub - discount };
  }

  function checkout(input) {
    const cart = sanitizeCart(input && input.cart);
    if (!cart.length) return { error: "empty" };
    const discount = validateDiscount(input.discount);
    if (discount == null) return { error: "discount" };
    const sub = cart.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
    if (discount > sub) return { error: "discount" };
    const payMethod = PAY_IDS.indexOf(input.payMethod) === -1 ? null : input.payMethod;
    if (!payMethod) return { error: "pay" };
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 140) : "";
    const sale = {
      id: typeof input.id === "string" && input.id ? input.id.slice(0, 40) : newId(),
      at: Number.isFinite(input.now) ? input.now : Date.now(),
      items: cart.map(function (item) {
        return {
          productId: item.productId,
          name: item.name,
          price: item.price,
          qty: item.qty
        };
      }),
      discount: discount,
      total: sub - discount,
      payMethod: payMethod,
      note: note,
      voided: false
    };
    return {
      sale: sale,
      products: applyStock(input.products || [], sale.items, 1)
    };
  }

  function applyStock(products, items, direction) {
    const usage = new Map();
    (items || []).forEach(function (item) {
      if (!item.productId) return;
      usage.set(item.productId, (usage.get(item.productId) || 0) + item.qty);
    });
    return (products || []).map(function (product) {
      const used = usage.get(product.id);
      if (!used || product.stock == null) return product;
      return Object.assign({}, product, { stock: product.stock - direction * used });
    });
  }

  function voidSale(data, saleId) {
    const sale = (data.sales || []).find(function (item) { return item.id === saleId; });
    if (!sale || sale.voided) return { error: "missing", data: data };
    return {
      data: Object.assign({}, data, {
        sales: data.sales.map(function (item) {
          return item.id === saleId ? Object.assign({}, item, { voided: true }) : item;
        }),
        products: applyStock(data.products, sale.items, -1)
      })
    };
  }

  function sanitizeProduct(input) {
    if (!input || typeof input.name !== "string") return null;
    const name = input.name.trim().slice(0, 80);
    const price = validatePrice(input.price);
    if (!name || price == null) return null;
    const category = CATEGORIES.indexOf(input.category) === -1 ? "غير ذلك" : input.category;
    const stockResult = validateStock(input.stock);
    if (!stockResult.ok) return null;
    const id = typeof input.id === "string" && input.id.trim()
      ? input.id.trim().slice(0, 40)
      : newId();
    return {
      id: id,
      name: name,
      price: price,
      category: category,
      stock: stockResult.stock
    };
  }

  function upsertProduct(products, input) {
    const product = sanitizeProduct(input);
    if (!product) return { error: "invalid", products: products || [] };
    const list = (products || []).slice();
    const index = list.findIndex(function (item) { return item.id === product.id; });
    if (index === -1) list.push(product);
    else list[index] = product;
    return { product: product, products: list };
  }

  function deleteProduct(products, id) {
    return (products || []).filter(function (product) { return product.id !== id; });
  }

  function sanitizeSale(input) {
    if (!input || !Array.isArray(input.items) || !input.items.length) return null;
    const items = [];
    for (let i = 0; i < input.items.length; i += 1) {
      const item = input.items[i];
      if (!item || typeof item.name !== "string") return null;
      const name = item.name.trim().slice(0, 80);
      const price = validatePrice(item.price);
      const qty = validateQty(item.qty);
      if (!name || price == null || qty == null) return null;
      items.push({
        name: name,
        price: price,
        qty: qty,
        productId: typeof item.productId === "string" && item.productId
          ? item.productId.slice(0, 40)
          : null
      });
    }
    const discount = validateDiscount(input.discount == null ? 0 : input.discount);
    if (discount == null) return null;
    const totals = saleTotals({ items: items, discount: discount });
    const at = Number(input.at);
    if (!Number.isFinite(at) || at < MIN_AT || at > Date.now() + 2 * 86400000) return null;
    const payMethod = PAY_IDS.indexOf(input.payMethod) === -1 ? "cash" : input.payMethod;
    return {
      id: typeof input.id === "string" && input.id.trim() ? input.id.trim().slice(0, 40) : newId(),
      at: at,
      items: items,
      discount: Math.min(discount, totals.sub),
      total: totals.total,
      payMethod: payMethod,
      note: typeof input.note === "string" ? input.note.trim().slice(0, 140) : "",
      voided: Boolean(input.voided)
    };
  }

  function sanitizeMovement(input) {
    if (!input || typeof input !== "object") return null;
    const kind = input.kind === "open" || input.kind === "in" || input.kind === "out" ? input.kind : null;
    if (!kind) return null;
    const amount = validatePrice(input.amount);
    if (amount == null) return null;
    if (kind !== "open" && amount === 0) return null;
    const at = Number(input.at);
    if (!Number.isFinite(at) || at < MIN_AT || at > Date.now() + 2 * 86400000) return null;
    return {
      id: typeof input.id === "string" && input.id.trim() ? input.id.trim().slice(0, 40) : newId(),
      at: at,
      kind: kind,
      amount: amount,
      note: typeof input.note === "string" ? input.note.trim().slice(0, 140) : ""
    };
  }

  function uniquify(items) {
    const seen = new Set();
    return items.map(function (item) {
      let id = item.id;
      while (seen.has(id)) id = newId();
      seen.add(id);
      return id === item.id ? item : Object.assign({}, item, { id: id });
    });
  }

  function sanitizeBackup(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad-backup");
    if (data.version !== 1) throw new Error("bad-version");
    if (!Array.isArray(data.products) || !Array.isArray(data.sales)) throw new Error("bad-backup");
    const rawMovements = data.movements == null ? [] : data.movements;
    if (!Array.isArray(rawMovements)) throw new Error("bad-backup");
    const products = uniquify(data.products.map(sanitizeProduct).filter(Boolean));
    const sales = uniquify(data.sales.map(sanitizeSale).filter(Boolean));
    const movements = uniquify(rawMovements.map(sanitizeMovement).filter(Boolean));
    return {
      currency: data.currency === "USD" ? "USD" : "SYP",
      products: products,
      sales: sales,
      movements: movements,
      droppedProducts: data.products.length - products.length,
      droppedSales: data.sales.length - sales.length,
      droppedMovements: rawMovements.length - movements.length
    };
  }

  function sanitizeStored(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad-store");
    const backup = sanitizeBackup({
      version: 1,
      currency: parsed.currency,
      products: Array.isArray(parsed.products) ? parsed.products : [],
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      movements: Array.isArray(parsed.movements) ? parsed.movements : []
    });
    const pinHash = typeof parsed.pinHash === "string" && /^[a-f0-9]{64}$/.test(parsed.pinHash)
      ? parsed.pinHash
      : "";
    const lastExportAt = Number.isFinite(parsed.lastExportAt) ? parsed.lastExportAt : null;
    return {
      version: 1,
      pinHash: pinHash,
      currency: backup.currency,
      products: backup.products,
      sales: backup.sales,
      movements: backup.movements,
      lastExportAt: lastExportAt
    };
  }

  function startOfDay(ts) {
    const date = new Date(ts);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function addDays(ts, days) {
    const date = new Date(ts);
    date.setDate(date.getDate() + days);
    return date.getTime();
  }

  function inRange(sale, from, to) {
    return !sale.voided && sale.at >= from && sale.at < to;
  }

  function sumSales(sales, from, to) {
    return (sales || []).reduce(function (sum, sale) {
      if (!inRange(sale, from, to)) return sum;
      return sum + saleTotals(sale).total;
    }, 0);
  }

  function countSales(sales, from, to) {
    return (sales || []).filter(function (sale) { return inRange(sale, from, to); }).length;
  }

  function payBreakdown(sales, from, to) {
    const out = { cash: 0, transfer: 0, shamcash: 0 };
    (sales || []).forEach(function (sale) {
      if (!inRange(sale, from, to)) return;
      const key = Object.prototype.hasOwnProperty.call(out, sale.payMethod) ? sale.payMethod : "cash";
      out[key] += saleTotals(sale).total;
    });
    return out;
  }

  function drawerDay(sales, movements, from, to) {
    const pay = payBreakdown(sales, from, to);
    let opening = null;
    let moneyIn = 0;
    let moneyOut = 0;
    const manual = [];
    (movements || []).slice().sort(function (a, b) { return a.at - b.at; }).forEach(function (move) {
      if (!move || move.at < from || move.at >= to) return;
      if (move.kind === "open") opening = move.amount;
      else if (move.kind === "in") moneyIn += move.amount;
      else if (move.kind === "out") moneyOut += move.amount;
      else return;
      manual.push(move);
    });
    return {
      opening: opening,
      cashSales: pay.cash,
      moneyIn: moneyIn,
      moneyOut: moneyOut,
      expected: (opening == null ? 0 : opening) + pay.cash + moneyIn - moneyOut,
      transfer: pay.transfer,
      shamcash: pay.shamcash,
      manual: manual
    };
  }

  function setOpening(movements, amount, now, note) {
    const parsed = validatePrice(amount);
    if (parsed == null) return { error: "amount", movements: movements || [] };
    const at = Number.isFinite(now) ? now : Date.now();
    const from = startOfDay(at);
    const to = addDays(from, 1);
    const next = (movements || []).filter(function (move) {
      return !(move.kind === "open" && move.at >= from && move.at < to);
    });
    next.push({
      id: newId(),
      at: at,
      kind: "open",
      amount: parsed,
      note: typeof note === "string" ? note.trim().slice(0, 140) : ""
    });
    return { movements: next };
  }

  function addDrawerMove(movements, kind, amount, now, note) {
    if (kind !== "in" && kind !== "out") return { error: "kind", movements: movements || [] };
    const parsed = validatePrice(amount);
    if (parsed == null || parsed === 0) return { error: "amount", movements: movements || [] };
    const next = (movements || []).slice();
    next.push({
      id: newId(),
      at: Number.isFinite(now) ? now : Date.now(),
      kind: kind,
      amount: parsed,
      note: typeof note === "string" ? note.trim().slice(0, 140) : ""
    });
    return { movements: next };
  }

  function removeDrawerMove(movements, id) {
    return (movements || []).filter(function (move) { return move.id !== id; });
  }

  function groupByDay(sales) {
    const map = new Map();
    const sorted = (sales || []).slice().sort(function (a, b) { return b.at - a.at; });
    sorted.forEach(function (sale) {
      const day = startOfDay(sale.at);
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(sale);
    });
    return Array.from(map.entries()).map(function (entry) {
      return { day: entry[0], sales: entry[1] };
    });
  }

  function sortProducts(products) {
    const rank = {};
    CATEGORIES.forEach(function (category, index) { rank[category] = index; });
    return (products || []).slice().sort(function (a, b) {
      const diff = (rank[a.category] == null ? 99 : rank[a.category]) - (rank[b.category] == null ? 99 : rank[b.category]);
      if (diff) return diff;
      return a.name.localeCompare(b.name, "ar");
    });
  }

  function filterProducts(products, query) {
    const q = (query && query.q ? String(query.q) : "").trim().toLowerCase();
    const category = query && query.category;
    return sortProducts(products).filter(function (product) {
      if (category && category !== "الكل" && product.category !== category) return false;
      if (!q) return true;
      return product.name.toLowerCase().indexOf(q) !== -1 || product.category.toLowerCase().indexOf(q) !== -1;
    });
  }

  function receiptText(sale, currency) {
    const totals = saleTotals(sale);
    const pay = PAY_METHODS.find(function (item) { return item.id === sale.payMethod; });
    const lines = [
      "Mr. Robot | مستر روبوت",
      "دمشق - كورنيش التجارة",
      "فاتورة " + String(sale.id).slice(-4).toUpperCase(),
      formatStamp(sale.at),
      "----------------"
    ];
    sale.items.forEach(function (item) {
      lines.push(item.name + " × " + item.qty);
      lines.push(formatMoney(item.price * item.qty, currency));
    });
    lines.push("----------------");
    if (totals.discount) lines.push("حسم: " + formatMoney(totals.discount, currency));
    lines.push("المجموع: " + formatMoney(totals.total, currency));
    lines.push("الدفع: " + (pay ? pay.label : "كاش"));
    if (sale.note) lines.push(sale.note);
    if (sale.voided) lines.push("ملغية");
    lines.push("شكراً لزيارتكم");
    lines.push("0991008212");
    return lines.join("\n");
  }

  return {
    CATEGORIES: CATEGORIES,
    PAY_METHODS: PAY_METHODS,
    emptyData: emptyData,
    newId: newId,
    normalizeDigits: normalizeDigits,
    validatePrice: validatePrice,
    validateDiscount: validateDiscount,
    validateQty: validateQty,
    validateStock: validateStock,
    isPin: isPin,
    normalizedPin: normalizedPin,
    hashPin: hashPin,
    formatMoney: formatMoney,
    formatStamp: formatStamp,
    itemCountLabel: itemCountLabel,
    cartKey: cartKey,
    sanitizeCart: sanitizeCart,
    addToCart: addToCart,
    changeQty: changeQty,
    saleTotals: saleTotals,
    checkout: checkout,
    applyStock: applyStock,
    voidSale: voidSale,
    sanitizeProduct: sanitizeProduct,
    upsertProduct: upsertProduct,
    deleteProduct: deleteProduct,
    sanitizeBackup: sanitizeBackup,
    sanitizeStored: sanitizeStored,
    startOfDay: startOfDay,
    addDays: addDays,
    sumSales: sumSales,
    countSales: countSales,
    payBreakdown: payBreakdown,
    drawerDay: drawerDay,
    setOpening: setOpening,
    addDrawerMove: addDrawerMove,
    removeDrawerMove: removeDrawerMove,
    groupByDay: groupByDay,
    sortProducts: sortProducts,
    filterProducts: filterProducts,
    receiptText: receiptText
  };
});
