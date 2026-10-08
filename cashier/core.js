"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MrRobotCashier = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CATEGORIES = ["موبايلات", "شواحن", "كبلات", "سماعات", "إكسسوارات", "صيانة", "غير ذلك"];
  const BOXES = [
    { id: "cashSyp", label: "كاش ليرة", currency: "SYP" },
    { id: "cashUsd", label: "كاش دولار", currency: "USD" },
    { id: "shamSyp", label: "شام كاش ليرة", currency: "SYP" },
    { id: "shamUsd", label: "شام كاش دولار", currency: "USD" },
    { id: "mega", label: "ميجا", currency: "SYP" }
  ];
  const BOX_IDS = BOXES.map(function (box) { return box.id; });
  const EXPENSE_SOURCES = ["cashSyp", "cashUsd", "shamSyp", "shamUsd"];
  const EXPENSE_KINDS = ["شخصي", "كهرباء", "ماء", "غير ذلك"];
  const MEGA_KINDS = ["شحن رصيد", "فاتورة", "شحن لعبة"];
  const MOVE_TYPES = ["sale", "sham_send", "sham_receive", "sham_bill", "mega_fund", "mega_service", "expense"];
  const COMMISSION_HINT = "١.٥٪ على المليون ليرة أو ١٠٠ دولار، و٣٪ على ١٠٠ ألف ليرة. فينا نعدّل الرقم.";
  const TENDER_KEYS = ["cashSyp", "cashUsd", "shamSyp", "shamUsd"];
  const MIN_AT = Date.UTC(2020, 0, 1);
  const MAX_PRICE = 1000000000;

  function boxById(id) {
    for (let i = 0; i < BOXES.length; i += 1) {
      if (BOXES[i].id === id) return BOXES[i];
    }
    return null;
  }

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

  function emptyDeltas() {
    return { cashSyp: 0, cashUsd: 0, shamSyp: 0, shamUsd: 0, mega: 0 };
  }

  function negate(n) {
    return n ? -n : 0;
  }

  function emptyOpenings() {
    return { cashSyp: null, cashUsd: null, shamSyp: null, shamUsd: null, mega: null };
  }

  function emptyBalances() {
    return emptyDeltas();
  }

  function emptyData() {
    return {
      version: 1,
      pinHash: "",
      currency: "SYP",
      usdRate: null,
      openings: emptyOpenings(),
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

  function readRate(raw) {
    if (raw == null || String(raw).trim() === "") return null;
    const n = validatePrice(raw);
    if (n == null || n <= 0) return null;
    return n;
  }

  function moneyCurrency(raw) {
    if (raw === "USD") return "USD";
    if (raw === "SYP") return "SYP";
    return null;
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

  function formatPercent(bps) {
    const percent = bps / 100;
    const rounded = Math.round(percent * 100) / 100;
    return String(rounded) + "٪";
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

  function lineCurrency(line) {
    return line && line.currency === "USD" ? "USD" : "SYP";
  }

  function cartKey(line) {
    const cur = lineCurrency(line);
    return line.productId ? "p:" + line.productId : "c:" + line.name + "|" + line.price + "|" + cur;
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
      const clean = {
        productId: productId,
        name: name,
        price: price,
        qty: qty,
        currency: lineCurrency(line)
      };
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

  function commissionBps(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return 300;
    const usd = currency === "USD";
    const low = usd ? 10 : 100000;
    const high = usd ? 100 : 1000000;
    if (n <= low) return 300;
    if (n >= high) return 150;
    const span = high - low;
    return (300 * span - (n - low) * 150) / span;
  }

  function commissionRate(amount, currency) {
    return commissionBps(amount, currency) / 10000;
  }

  function commissionAmount(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * commissionBps(n, currency) / 10000);
  }

  function normalizeTender(raw) {
    const tender = { cashSyp: 0, cashUsd: 0, shamSyp: 0, shamUsd: 0 };
    const source = raw && typeof raw === "object" ? raw : {};
    for (let i = 0; i < TENDER_KEYS.length; i += 1) {
      const key = TENDER_KEYS[i];
      const value = source[key];
      if (value == null || String(value).trim() === "") continue;
      const n = validatePrice(value);
      if (n == null) return { error: "tender" };
      tender[key] = n;
    }
    return { tender: tender };
  }

  function coverStatus(input) {
    const source = input || {};
    const due = validatePrice(source.due);
    const currency = moneyCurrency(source.currency) || "SYP";
    if (due == null) return { error: "amount" };
    const parsed = normalizeTender(source.tender);
    if (parsed.error) return { error: "tender" };
    const tender = parsed.tender;
    const syp = tender.cashSyp + tender.shamSyp;
    const usd = tender.cashUsd + tender.shamUsd;
    const rate = readRate(source.rate);
    const needs = currency === "SYP" ? usd > 0 : syp > 0;
    if (needs && rate == null) {
      return { error: "rate", tender: tender, due: due, currency: currency, remainder: null };
    }
    if (!needs) {
      const covered = currency === "SYP" ? syp : usd;
      return {
        remainder: due - covered,
        remainderCurrency: currency,
        currency: currency,
        tender: tender,
        due: due,
        rate: null
      };
    }
    if (currency === "SYP") {
      const coveredSyp = syp + usd * rate;
      return {
        remainder: due - coveredSyp,
        remainderCurrency: "SYP",
        currency: "SYP",
        tender: tender,
        due: due,
        rate: rate
      };
    }
    const dueSyp = due * rate;
    const paidSyp = syp + usd * rate;
    const diff = dueSyp - paidSyp;
    if (diff % rate === 0) {
      return {
        remainder: diff / rate,
        remainderCurrency: "USD",
        currency: "USD",
        tender: tender,
        due: due,
        rate: rate
      };
    }
    return {
      remainder: diff,
      remainderCurrency: "SYP",
      currency: "USD",
      tender: tender,
      due: due,
      rate: rate
    };
  }

  function cleanId(id) {
    return typeof id === "string" && id.trim() ? id.trim().slice(0, 40) : newId();
  }

  function cleanNote(note) {
    return typeof note === "string" ? note.trim().slice(0, 140) : "";
  }

  function stampOf(input) {
    return Number.isFinite(input && input.now) ? input.now : Date.now();
  }

  function movementShell(type, detail, deltas, input) {
    return {
      id: cleanId(input && input.id),
      at: stampOf(input),
      type: type,
      voided: false,
      note: cleanNote(input && input.note),
      deltas: deltas,
      detail: detail
    };
  }

  function readCash(input) {
    const sypRaw = input.cashSyp;
    const usdRaw = input.cashUsd;
    const cashSyp = sypRaw == null || String(sypRaw).trim() === "" ? 0 : validatePrice(sypRaw);
    const cashUsd = usdRaw == null || String(usdRaw).trim() === "" ? 0 : validatePrice(usdRaw);
    if (cashSyp == null || cashUsd == null) return { error: "tender" };
    return { cashSyp: cashSyp, cashUsd: cashUsd };
  }

  function resolveCommission(amount, currency, raw) {
    const suggested = commissionAmount(amount, currency);
    if (raw == null || String(raw).trim() === "") {
      return { commission: suggested, edited: false };
    }
    const commission = validatePrice(raw);
    if (commission == null) return { error: "commission" };
    return { commission: commission, edited: commission !== suggested };
  }

  function applyNegative(result, input, deltas) {
    if (!input.balances) return result;
    const negative = negativeBoxes(input.balances, deltas);
    result.negative = negative;
    if (negative.length && !input.allowNegative) {
      return {
        error: "negative",
        negative: negative,
        movement: result.movement,
        commission: result.commission,
        owed: result.owed,
        payout: result.payout
      };
    }
    return result;
  }

  function checkout(input) {
    const source = input || {};
    const cart = sanitizeCart(source.cart);
    if (!cart.length) return { error: "empty" };
    let currency = null;
    for (let i = 0; i < cart.length; i += 1) {
      const cur = cart[i].currency;
      if (currency && currency !== cur) return { error: "mixed" };
      currency = cur;
    }
    const discount = validateDiscount(source.discount);
    if (discount == null) return { error: "discount" };
    const sub = cart.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
    if (discount > sub) return { error: "discount" };
    const total = sub - discount;
    const tenderParsed = normalizeTender(source.tender || {});
    if (tenderParsed.error) return { error: "tender" };
    const cover = coverStatus({
      due: total,
      currency: currency,
      tender: tenderParsed.tender,
      rate: source.rate
    });
    if (cover.error) return { error: cover.error, remainder: cover.remainder, remainderCurrency: cover.remainderCurrency };
    if (cover.remainder !== 0) {
      return { error: "remainder", remainder: cover.remainder, remainderCurrency: cover.remainderCurrency };
    }
    const items = cart.map(function (item) {
      return {
        productId: item.productId,
        name: item.name,
        price: item.price,
        qty: item.qty,
        currency: item.currency
      };
    });
    const deltas = emptyDeltas();
    deltas.cashSyp = tenderParsed.tender.cashSyp;
    deltas.cashUsd = tenderParsed.tender.cashUsd;
    deltas.shamSyp = tenderParsed.tender.shamSyp;
    deltas.shamUsd = tenderParsed.tender.shamUsd;
    const movement = movementShell("sale", {
      items: items,
      discount: discount,
      total: total,
      currency: currency,
      tender: tenderParsed.tender,
      rate: cover.rate || null
    }, deltas, source);
    return {
      movement: movement,
      products: applyStock(source.products || [], items, 1)
    };
  }

  function buildShamSend(input) {
    const source = input || {};
    const currency = moneyCurrency(source.currency);
    if (!currency) return { error: "currency" };
    const amount = validatePrice(source.amount);
    if (amount == null || amount <= 0) return { error: "amount" };
    const fee = resolveCommission(amount, currency, source.commission);
    if (fee.error) return fee;
    const cash = readCash(source);
    if (cash.error) return cash;
    const owed = amount + fee.commission;
    if (!Number.isSafeInteger(owed) || owed > MAX_PRICE) return { error: "amount" };
    const cover = coverStatus({
      due: owed,
      currency: currency,
      tender: { cashSyp: cash.cashSyp, cashUsd: cash.cashUsd },
      rate: source.rate
    });
    if (cover.error) return { error: cover.error, remainder: cover.remainder, remainderCurrency: cover.remainderCurrency, commission: fee.commission, owed: owed };
    if (cover.remainder !== 0) {
      return {
        error: "remainder",
        remainder: cover.remainder,
        remainderCurrency: cover.remainderCurrency,
        commission: fee.commission,
        owed: owed
      };
    }
    const deltas = emptyDeltas();
    deltas[currency === "USD" ? "shamUsd" : "shamSyp"] = negate(amount);
    deltas.cashSyp = cash.cashSyp;
    deltas.cashUsd = cash.cashUsd;
    const movement = movementShell("sham_send", {
      currency: currency,
      amount: amount,
      commission: fee.commission,
      commissionEdited: fee.edited,
      rateBps: commissionBps(amount, currency),
      cashSyp: cash.cashSyp,
      cashUsd: cash.cashUsd,
      rate: cover.rate || null,
      owed: owed
    }, deltas, source);
    return applyNegative({
      movement: movement,
      commission: fee.commission,
      owed: owed,
      rateBps: movement.detail.rateBps
    }, source, deltas);
  }

  function buildShamReceive(input) {
    const source = input || {};
    const currency = moneyCurrency(source.currency);
    if (!currency) return { error: "currency" };
    const amount = validatePrice(source.amount);
    if (amount == null || amount <= 0) return { error: "amount" };
    const fee = resolveCommission(amount, currency, source.commission);
    if (fee.error) return fee;
    if (fee.commission > amount) return { error: "commission", commission: fee.commission };
    const cash = readCash(source);
    if (cash.error) return cash;
    const payout = amount - fee.commission;
    const cover = coverStatus({
      due: payout,
      currency: currency,
      tender: { cashSyp: cash.cashSyp, cashUsd: cash.cashUsd },
      rate: source.rate
    });
    if (cover.error) return { error: cover.error, remainder: cover.remainder, remainderCurrency: cover.remainderCurrency, commission: fee.commission, payout: payout };
    if (cover.remainder !== 0) {
      return {
        error: "remainder",
        remainder: cover.remainder,
        remainderCurrency: cover.remainderCurrency,
        commission: fee.commission,
        payout: payout
      };
    }
    if (source.balances) {
      const short = cashShortfall(source.balances, cash.cashSyp, cash.cashUsd);
      if (short) {
        return { error: "short", short: short, commission: fee.commission, payout: payout };
      }
    }
    const deltas = emptyDeltas();
    deltas[currency === "USD" ? "shamUsd" : "shamSyp"] = amount;
    deltas.cashSyp = negate(cash.cashSyp);
    deltas.cashUsd = negate(cash.cashUsd);
    const movement = movementShell("sham_receive", {
      currency: currency,
      amount: amount,
      commission: fee.commission,
      commissionEdited: fee.edited,
      rateBps: commissionBps(amount, currency),
      cashSyp: cash.cashSyp,
      cashUsd: cash.cashUsd,
      rate: cover.rate || null,
      payout: payout
    }, deltas, source);
    return {
      movement: movement,
      commission: fee.commission,
      payout: payout,
      rateBps: movement.detail.rateBps
    };
  }

  function buildShamBill(input) {
    const source = input || {};
    const currency = moneyCurrency(source.currency);
    if (!currency) return { error: "currency" };
    const amount = validatePrice(source.amount);
    if (amount == null || amount <= 0) return { error: "amount" };
    const cash = readCash(source);
    if (cash.error) return cash;
    const cover = coverStatus({
      due: amount,
      currency: currency,
      tender: { cashSyp: cash.cashSyp, cashUsd: cash.cashUsd },
      rate: source.rate
    });
    if (cover.error) return { error: cover.error, remainder: cover.remainder, remainderCurrency: cover.remainderCurrency };
    if (cover.remainder !== 0) {
      return { error: "remainder", remainder: cover.remainder, remainderCurrency: cover.remainderCurrency };
    }
    const deltas = emptyDeltas();
    deltas[currency === "USD" ? "shamUsd" : "shamSyp"] = negate(amount);
    deltas.cashSyp = cash.cashSyp;
    deltas.cashUsd = cash.cashUsd;
    const movement = movementShell("sham_bill", {
      currency: currency,
      amount: amount,
      cashSyp: cash.cashSyp,
      cashUsd: cash.cashUsd,
      rate: cover.rate || null
    }, deltas, source);
    return applyNegative({ movement: movement }, source, deltas);
  }

  function buildMegaFund(input) {
    const source = input || {};
    const amount = validatePrice(source.amount);
    if (amount == null || amount <= 0) return { error: "amount" };
    const deltas = emptyDeltas();
    deltas.shamSyp = negate(amount);
    deltas.mega = amount;
    const movement = movementShell("mega_fund", { amount: amount }, deltas, source);
    return applyNegative({ movement: movement }, source, deltas);
  }

  function buildMegaService(input) {
    const source = input || {};
    if (MEGA_KINDS.indexOf(source.kind) === -1) return { error: "kind" };
    const megaOut = validatePrice(source.megaOut);
    if (megaOut == null || megaOut <= 0) return { error: "amount" };
    const currency = moneyCurrency(source.currency);
    if (!currency) return { error: "currency" };
    const price = validatePrice(source.price);
    if (price == null) return { error: "price" };
    const tenderParsed = normalizeTender(source.tender || {});
    if (tenderParsed.error) return { error: "tender" };
    const cover = coverStatus({
      due: price,
      currency: currency,
      tender: tenderParsed.tender,
      rate: source.rate
    });
    if (cover.error) return { error: cover.error, remainder: cover.remainder, remainderCurrency: cover.remainderCurrency };
    if (cover.remainder !== 0) {
      return { error: "remainder", remainder: cover.remainder, remainderCurrency: cover.remainderCurrency };
    }
    const deltas = emptyDeltas();
    deltas.mega = negate(megaOut);
    deltas.cashSyp = tenderParsed.tender.cashSyp;
    deltas.cashUsd = tenderParsed.tender.cashUsd;
    deltas.shamSyp = tenderParsed.tender.shamSyp;
    deltas.shamUsd = tenderParsed.tender.shamUsd;
    const movement = movementShell("mega_service", {
      kind: source.kind,
      megaOut: megaOut,
      price: price,
      currency: currency,
      tender: tenderParsed.tender,
      rate: cover.rate || null
    }, deltas, source);
    return applyNegative({ movement: movement }, source, deltas);
  }

  function buildExpense(input) {
    const source = input || {};
    if (EXPENSE_SOURCES.indexOf(source.source) === -1) return { error: "source" };
    const amount = validatePrice(source.amount);
    if (amount == null || amount <= 0) return { error: "amount" };
    if (EXPENSE_KINDS.indexOf(source.kind) === -1) return { error: "kind" };
    const deltas = emptyDeltas();
    deltas[source.source] = negate(amount);
    const movement = movementShell("expense", {
      source: source.source,
      amount: amount,
      kind: source.kind
    }, deltas, source);
    return applyNegative({ movement: movement }, source, deltas);
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

  function voidMovement(data, movementId) {
    const current = data || emptyData();
    const move = (current.movements || []).find(function (item) { return item.id === movementId; });
    if (!move || move.voided) return { error: "missing", data: current };
    let products = current.products || [];
    if (move.type === "sale" && move.detail && Array.isArray(move.detail.items)) {
      products = applyStock(products, move.detail.items, -1);
    }
    return {
      data: Object.assign({}, current, {
        products: products,
        movements: current.movements.map(function (item) {
          return item.id === movementId ? Object.assign({}, item, { voided: true }) : item;
        })
      })
    };
  }

  function normalizeBalances(raw) {
    const out = emptyBalances();
    const source = raw && typeof raw === "object" ? raw : {};
    BOX_IDS.forEach(function (id) {
      const n = Number(source[id]);
      out[id] = Number.isFinite(n) ? n : 0;
    });
    return out;
  }

  function negativeBoxes(balances, deltas) {
    const current = normalizeBalances(balances);
    const found = [];
    BOX_IDS.forEach(function (id) {
      const delta = deltas && Number(deltas[id]) || 0;
      if (current[id] + delta < 0) found.push(id);
    });
    return found;
  }

  function cashShortfall(balances, cashSyp, cashUsd) {
    const current = normalizeBalances(balances);
    const short = {};
    if (cashSyp > current.cashSyp) short.cashSyp = cashSyp - current.cashSyp;
    if (cashUsd > current.cashUsd) short.cashUsd = cashUsd - current.cashUsd;
    if (short.cashSyp || short.cashUsd) return short;
    return null;
  }

  function boxBalance(openings, movements, boxId) {
    const open = openings && openings[boxId];
    const base = open && open.amount != null ? open.amount : 0;
    const since = open && Number.isFinite(Number(open.at)) ? Number(open.at) : null;
    let delta = 0;
    (movements || []).forEach(function (move) {
      if (!move || move.voided || !move.deltas) return;
      if (since != null && Number(move.at) < since) return;
      delta += Number(move.deltas[boxId]) || 0;
    });
    return base + delta;
  }

  function balances(openings, movements) {
    const out = emptyBalances();
    BOX_IDS.forEach(function (id) {
      out[id] = boxBalance(openings, movements, id);
    });
    return out;
  }

  function dayNet(movements, from, to) {
    const out = emptyDeltas();
    (movements || []).forEach(function (move) {
      if (!move || move.voided || !move.deltas) return;
      if (move.at < from || move.at >= to) return;
      BOX_IDS.forEach(function (id) {
        out[id] += Number(move.deltas[id]) || 0;
      });
    });
    return out;
  }

  function setOpening(openings, box, amount, now) {
    const current = Object.assign(emptyOpenings(), openings || {});
    if (!boxById(box)) return { error: "box", openings: current };
    const parsed = validatePrice(amount);
    if (parsed == null) return { error: "amount", openings: current };
    const next = Object.assign(emptyOpenings(), openings || {});
    next[box] = { amount: parsed, at: Number.isFinite(now) ? now : Date.now() };
    return { openings: next };
  }

  function signedMoney(amount, currency) {
    const sign = amount < 0 ? "−" : "+";
    return sign + formatMoney(Math.abs(amount), currency);
  }

  function describeMovement(move) {
    if (!move) return { title: "", changes: [], text: "" };
    const detail = move.detail || {};
    let title = "حركة";
    if (move.type === "sale") {
      const names = (detail.items || []).map(function (item) {
        return item.name + " ×" + item.qty;
      }).join("، ");
      title = "بيع: " + (names || formatMoney(detail.total, detail.currency));
    } else if (move.type === "sham_send") {
      title = "إرسال للزبون عبر شام كاش " + formatMoney(detail.amount, detail.currency);
      if (detail.commission) title += " · عمولة " + formatMoney(detail.commission, detail.currency);
    } else if (move.type === "sham_receive") {
      title = "استقبال من الزبون عبر شام كاش " + formatMoney(detail.amount, detail.currency);
      if (detail.commission) title += " · عمولة " + formatMoney(detail.commission, detail.currency);
    } else if (move.type === "sham_bill") {
      title = "دفع فاتورة من شام كاش " + formatMoney(detail.amount, detail.currency);
    } else if (move.type === "mega_fund") {
      title = "شحن ميجا من شام كاش " + formatMoney(detail.amount, "SYP");
    } else if (move.type === "mega_service") {
      title = "ميجا · " + (detail.kind || "خدمة");
      if (detail.megaOut) title += " · طلع من ميجا " + formatMoney(detail.megaOut, "SYP");
    } else if (move.type === "expense") {
      const box = boxById(detail.source);
      title = "مصروف " + (detail.kind || "") + (box ? " من " + box.label : "");
    }
    const changes = [];
    BOXES.forEach(function (box) {
      const amount = move.deltas ? Number(move.deltas[box.id]) || 0 : 0;
      if (!amount) return;
      changes.push(box.label + " " + signedMoney(amount, box.currency));
    });
    const note = move.note ? " · " + move.note : "";
    const changeText = changes.length ? " — " + changes.join(" · ") : "";
    return { title: title, changes: changes, text: title + changeText + note };
  }

  function sanitizeProduct(input, fallbackCurrency) {
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
    let currency = "SYP";
    if (input.currency === "USD" || input.currency === "SYP") currency = input.currency;
    else if (fallbackCurrency === "USD") currency = "USD";
    return {
      id: id,
      name: name,
      price: price,
      currency: currency,
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
    return {
      id: cleanId(input.id),
      at: at,
      items: items,
      discount: Math.min(discount, totals.sub),
      total: totals.total,
      note: cleanNote(input.note),
      voided: Boolean(input.voided)
    };
  }

  function validAt(at) {
    return Number.isFinite(at) && at >= MIN_AT && at <= Date.now() + 2 * 86400000;
  }

  function deltasMatch(type, detail) {
    const deltas = emptyDeltas();
    if (type === "sale" || type === "mega_service") {
      const tender = detail.tender;
      deltas.cashSyp = tender.cashSyp;
      deltas.cashUsd = tender.cashUsd;
      deltas.shamSyp = tender.shamSyp;
      deltas.shamUsd = tender.shamUsd;
      if (type === "mega_service") deltas.mega = negate(detail.megaOut);
      return deltas;
    }
    if (type === "sham_send") {
      deltas[detail.currency === "USD" ? "shamUsd" : "shamSyp"] = negate(detail.amount);
      deltas.cashSyp = detail.cashSyp;
      deltas.cashUsd = detail.cashUsd;
      return deltas;
    }
    if (type === "sham_receive") {
      deltas[detail.currency === "USD" ? "shamUsd" : "shamSyp"] = detail.amount;
      deltas.cashSyp = negate(detail.cashSyp);
      deltas.cashUsd = negate(detail.cashUsd);
      return deltas;
    }
    if (type === "sham_bill") {
      deltas[detail.currency === "USD" ? "shamUsd" : "shamSyp"] = negate(detail.amount);
      deltas.cashSyp = detail.cashSyp;
      deltas.cashUsd = detail.cashUsd;
      return deltas;
    }
    if (type === "mega_fund") {
      deltas.shamSyp = negate(detail.amount);
      deltas.mega = detail.amount;
      return deltas;
    }
    if (type === "expense") {
      deltas[detail.source] = negate(detail.amount);
      return deltas;
    }
    return null;
  }

  function sanitizeMovement(input) {
    if (!input || typeof input !== "object" || MOVE_TYPES.indexOf(input.type) === -1) return null;
    const at = Number(input.at);
    if (!validAt(at)) return null;
    const detail = input.detail;
    if (!detail || typeof detail !== "object") return null;
    let cleanDetail = null;
    if (input.type === "sale") {
      if (!Array.isArray(detail.items) || !detail.items.length) return null;
      const items = [];
      for (let i = 0; i < detail.items.length; i += 1) {
        const item = detail.items[i];
        if (!item || typeof item.name !== "string") return null;
        const name = item.name.trim().slice(0, 80);
        const price = validatePrice(item.price);
        const qty = validateQty(item.qty);
        if (!name || price == null || qty == null) return null;
        items.push({
          name: name,
          price: price,
          qty: qty,
          currency: item.currency === "USD" ? "USD" : "SYP",
          productId: typeof item.productId === "string" && item.productId ? item.productId.slice(0, 40) : null
        });
      }
      let currency = null;
      for (let i = 0; i < items.length; i += 1) {
        if (currency && currency !== items[i].currency) return null;
        currency = items[i].currency;
      }
      const discount = validateDiscount(detail.discount == null ? 0 : detail.discount);
      if (discount == null) return null;
      const sub = items.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
      if (discount > sub) return null;
      const tenderParsed = normalizeTender(detail.tender || {});
      if (tenderParsed.error) return null;
      const total = sub - discount;
      const cover = coverStatus({
        due: total,
        currency: currency,
        tender: tenderParsed.tender,
        rate: detail.rate
      });
      if (cover.error || cover.remainder !== 0) return null;
      cleanDetail = {
        items: items,
        discount: discount,
        total: total,
        currency: currency,
        tender: tenderParsed.tender,
        rate: cover.rate || null
      };
    } else if (input.type === "sham_send" || input.type === "sham_receive") {
      const currency = moneyCurrency(detail.currency);
      const amount = validatePrice(detail.amount);
      const commission = validatePrice(detail.commission == null ? 0 : detail.commission);
      const cashSyp = validatePrice(detail.cashSyp == null ? 0 : detail.cashSyp);
      const cashUsd = validatePrice(detail.cashUsd == null ? 0 : detail.cashUsd);
      if (!currency || amount == null || amount <= 0 || commission == null || cashSyp == null || cashUsd == null) return null;
      if (input.type === "sham_receive" && commission > amount) return null;
      const due = input.type === "sham_send" ? amount + commission : amount - commission;
      if (!Number.isSafeInteger(due) || due < 0 || due > MAX_PRICE) return null;
      const cover = coverStatus({
        due: due,
        currency: currency,
        tender: { cashSyp: cashSyp, cashUsd: cashUsd },
        rate: detail.rate
      });
      if (cover.error || cover.remainder !== 0) return null;
      cleanDetail = {
        currency: currency,
        amount: amount,
        commission: commission,
        commissionEdited: Boolean(detail.commissionEdited),
        rateBps: commissionBps(amount, currency),
        cashSyp: cashSyp,
        cashUsd: cashUsd,
        rate: cover.rate || null
      };
      if (input.type === "sham_send") cleanDetail.owed = due;
      else cleanDetail.payout = due;
    } else if (input.type === "sham_bill") {
      const currency = moneyCurrency(detail.currency);
      const amount = validatePrice(detail.amount);
      const cashSyp = validatePrice(detail.cashSyp == null ? 0 : detail.cashSyp);
      const cashUsd = validatePrice(detail.cashUsd == null ? 0 : detail.cashUsd);
      if (!currency || amount == null || amount <= 0 || cashSyp == null || cashUsd == null) return null;
      const cover = coverStatus({
        due: amount,
        currency: currency,
        tender: { cashSyp: cashSyp, cashUsd: cashUsd },
        rate: detail.rate
      });
      if (cover.error || cover.remainder !== 0) return null;
      cleanDetail = {
        currency: currency,
        amount: amount,
        cashSyp: cashSyp,
        cashUsd: cashUsd,
        rate: cover.rate || null
      };
    } else if (input.type === "mega_fund") {
      const amount = validatePrice(detail.amount);
      if (amount == null || amount <= 0) return null;
      cleanDetail = { amount: amount };
    } else if (input.type === "mega_service") {
      if (MEGA_KINDS.indexOf(detail.kind) === -1) return null;
      const megaOut = validatePrice(detail.megaOut);
      const currency = moneyCurrency(detail.currency);
      const price = validatePrice(detail.price);
      if (megaOut == null || megaOut <= 0 || !currency || price == null) return null;
      const tenderParsed = normalizeTender(detail.tender || {});
      if (tenderParsed.error) return null;
      const cover = coverStatus({
        due: price,
        currency: currency,
        tender: tenderParsed.tender,
        rate: detail.rate
      });
      if (cover.error || cover.remainder !== 0) return null;
      cleanDetail = {
        kind: detail.kind,
        megaOut: megaOut,
        price: price,
        currency: currency,
        tender: tenderParsed.tender,
        rate: cover.rate || null
      };
    } else if (input.type === "expense") {
      if (EXPENSE_SOURCES.indexOf(detail.source) === -1) return null;
      const amount = validatePrice(detail.amount);
      if (amount == null || amount <= 0 || EXPENSE_KINDS.indexOf(detail.kind) === -1) return null;
      cleanDetail = { source: detail.source, amount: amount, kind: detail.kind };
    }
    if (!cleanDetail) return null;
    const deltas = deltasMatch(input.type, cleanDetail);
    if (!deltas) return null;
    return {
      id: cleanId(input.id),
      at: at,
      type: input.type,
      voided: Boolean(input.voided),
      note: cleanNote(input.note),
      deltas: deltas,
      detail: cleanDetail
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

  function sanitizeOpenings(raw) {
    const out = emptyOpenings();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    BOX_IDS.forEach(function (id) {
      const value = raw[id];
      if (value == null || value === "") return;
      if (typeof value === "number" || typeof value === "string") {
        const amount = validatePrice(value);
        if (amount == null) return;
        out[id] = { amount: amount, at: 0 };
        return;
      }
      if (typeof value !== "object") return;
      const amount = validatePrice(value.amount);
      if (amount == null) return;
      const at = Number(value.at);
      out[id] = { amount: amount, at: Number.isFinite(at) ? at : 0 };
    });
    return out;
  }

  function sanitizeBackup(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad-backup");
    if (data.version !== 1) throw new Error("bad-version");
    if (!Array.isArray(data.products) || !Array.isArray(data.sales)) throw new Error("bad-backup");
    const rawMovements = data.movements == null ? [] : data.movements;
    if (!Array.isArray(rawMovements)) throw new Error("bad-backup");
    const fileCurrency = data.currency === "USD" ? "USD" : "SYP";
    const products = uniquify(data.products.map(function (item) {
      return sanitizeProduct(item, fileCurrency);
    }).filter(Boolean));
    const sales = uniquify(data.sales.map(sanitizeSale).filter(Boolean));
    const movements = uniquify(rawMovements.map(sanitizeMovement).filter(Boolean));
    return {
      currency: fileCurrency,
      usdRate: readRate(data.usdRate),
      openings: sanitizeOpenings(data.openings),
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
      usdRate: parsed.usdRate,
      openings: parsed.openings,
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
      usdRate: backup.usdRate,
      openings: backup.openings,
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

  function groupByDay(items) {
    const map = new Map();
    const sorted = (items || []).slice().sort(function (a, b) { return b.at - a.at; });
    sorted.forEach(function (item) {
      const day = startOfDay(item.at);
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(item);
    });
    return Array.from(map.entries()).map(function (entry) {
      return { day: entry[0], sales: entry[1], items: entry[1] };
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

  function receiptText(move) {
    const detail = move && move.detail ? move.detail : {};
    const currency = detail.currency === "USD" ? "USD" : "SYP";
    const lines = [
      "Mr. Robot | مستر روبوت",
      "دمشق - كورنيش التجارة",
      "فاتورة " + String(move && move.id || "").slice(-4).toUpperCase(),
      formatStamp(move && move.at),
      "----------------"
    ];
    (detail.items || []).forEach(function (item) {
      const cur = item.currency === "USD" ? "USD" : currency;
      lines.push(item.name + " × " + item.qty);
      lines.push(formatMoney(item.price * item.qty, cur));
    });
    lines.push("----------------");
    if (detail.discount) lines.push("حسم: " + formatMoney(detail.discount, currency));
    lines.push("المجموع: " + formatMoney(detail.total, currency));
    const tender = detail.tender || {};
    if (tender.cashSyp) lines.push("كاش ليرة: " + formatMoney(tender.cashSyp, "SYP"));
    if (tender.cashUsd) lines.push("كاش دولار: " + formatMoney(tender.cashUsd, "USD"));
    if (tender.shamSyp) lines.push("شام كاش ليرة: " + formatMoney(tender.shamSyp, "SYP"));
    if (tender.shamUsd) lines.push("شام كاش دولار: " + formatMoney(tender.shamUsd, "USD"));
    if (detail.rate) lines.push("سعر الدولار: " + formatMoney(detail.rate, "SYP"));
    if (move && move.note) lines.push(move.note);
    if (move && move.voided) lines.push("ملغية");
    lines.push("شكراً لزيارتكم");
    lines.push("0991008212");
    return lines.join("\n");
  }

  return {
    CATEGORIES: CATEGORIES,
    BOXES: BOXES,
    EXPENSE_SOURCES: EXPENSE_SOURCES,
    EXPENSE_KINDS: EXPENSE_KINDS,
    MEGA_KINDS: MEGA_KINDS,
    COMMISSION_HINT: COMMISSION_HINT,
    emptyData: emptyData,
    emptyOpenings: emptyOpenings,
    emptyDeltas: emptyDeltas,
    newId: newId,
    normalizeDigits: normalizeDigits,
    validatePrice: validatePrice,
    validateDiscount: validateDiscount,
    validateQty: validateQty,
    validateStock: validateStock,
    readRate: readRate,
    isPin: isPin,
    normalizedPin: normalizedPin,
    hashPin: hashPin,
    formatMoney: formatMoney,
    formatPercent: formatPercent,
    formatStamp: formatStamp,
    itemCountLabel: itemCountLabel,
    cartKey: cartKey,
    sanitizeCart: sanitizeCart,
    addToCart: addToCart,
    changeQty: changeQty,
    saleTotals: saleTotals,
    commissionBps: commissionBps,
    commissionRate: commissionRate,
    commissionAmount: commissionAmount,
    normalizeTender: normalizeTender,
    coverStatus: coverStatus,
    checkout: checkout,
    buildShamSend: buildShamSend,
    buildShamReceive: buildShamReceive,
    buildShamBill: buildShamBill,
    buildMegaFund: buildMegaFund,
    buildMegaService: buildMegaService,
    buildExpense: buildExpense,
    applyStock: applyStock,
    voidMovement: voidMovement,
    negativeBoxes: negativeBoxes,
    cashShortfall: cashShortfall,
    balances: balances,
    dayNet: dayNet,
    setOpening: setOpening,
    describeMovement: describeMovement,
    sanitizeProduct: sanitizeProduct,
    upsertProduct: upsertProduct,
    deleteProduct: deleteProduct,
    sanitizeBackup: sanitizeBackup,
    sanitizeStored: sanitizeStored,
    startOfDay: startOfDay,
    addDays: addDays,
    groupByDay: groupByDay,
    sortProducts: sortProducts,
    filterProducts: filterProducts,
    receiptText: receiptText
  };
});
