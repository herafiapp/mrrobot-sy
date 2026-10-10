/**
 * Native cashier API (Option A). Paste this file into the live Apps Script
 * project next to Main.js. Do not replace doGet. Deploy the same Web App
 * (execute as the owner). Phones and the Mac call HTTPS only.
 *
 * Body: { action, pin?, idempotencyKey?, payload }
 * Reply: { success, code, message, data }
 *
 * The PIN is checked with the existing owner gate (Script Properties hash).
 * Write actions that already live in runOnce keep that idempotency key, so a
 * retry does not post twice. Nothing here stores a Gemini key or the PIN.
 */
var NATIVE_ACTION_NAMES_ = [
  'ping',
  'fx.get',
  'fx.refresh',
  'sale.scan',
  'sham.post',
  'mega.post',
  'usdt.post',
  'pockets.preview',
  'pockets.post',
  'pockets.book',
  'opening.save',
  'z.stats',
  'z.close',
  'invoice.get',
  'request.lookup'
];

var NATIVE_RUNONCE_FNS_ = {
  'sale.scan': 'processScan',
  'sham.post': 'logShamCash',
  'mega.post': 'logMegaTxBulk',
  'usdt.post': 'logUsdtTransaction'
};

function nativeKeyOk_(id) {
  return /^[A-Za-z0-9_.:-]{8,120}$/.test(String(id || ''));
}

/** Relative drift of a client rate against the saved mid. Null when there is nothing to compare. */
function nativeFxDrift_(clientRate, savedMid) {
  var c = Number(clientRate);
  var m = Number(savedMid);
  if (!(c > 0) || !(m > 0)) return null;
  return Math.abs(c - m) / m;
}

function nativeClientRate_(action, payload) {
  var p = payload || {};
  if (Number(p.fxRate) > 0) return Number(p.fxRate);
  if (p.rates && Number(p.rates.mid) > 0) return Number(p.rates.mid);
  var rates = p.ctx && p.ctx.rates;
  if (rates && Number(rates.buy) > 0 && Number(rates.sell) > 0) {
    return (Number(rates.buy) + Number(rates.sell)) / 2;
  }
  if (action === 'pockets.post' || action === 'pockets.preview') {
    var inp = p.inp || p;
    if (inp.rates && Number(inp.rates.mid) > 0) return Number(inp.rates.mid);
  }
  return 0;
}

function nativeCallArgs_(action, payload) {
  var p = payload || {};
  if (action === 'sale.scan') {
    return ['processScan', [
      p.barcode, p.mode || 'sale', p.buyerName || '', p.buyerPhone || '',
      p.qty == null ? 1 : p.qty, p.discountAmount || 0, p.currency || 'SP',
      p.invoiceId || '', p.fxRate || 0, p.tender || null,
      !!p.confirmBelowCost, !!p.confirmPriceAlert
    ]];
  }
  if (action === 'sham.post') {
    return ['logShamCash', [
      p.transfer, p.currency || 'SP', p.commission || 0, p.client || '',
      p.paidCurrency || p.currency || 'SP', p.txDirection || 'SEND',
      p.fxRate || 0, p.outsideCash || 0, p.tender || null,
      p.billType || '', p.billRef || '', p.feeMode || 'ABOVE'
    ]];
  }
  if (action === 'mega.post') {
    return ['logMegaTxBulk', [
      p.client || '', p.items || [], p.paidCurrency || 'SP',
      p.txDirection || 'SEND', p.fxRate || 0, p.tender || null
    ]];
  }
  if (action === 'usdt.post') {
    return ['logUsdtTransaction', [
      p.client || '', p.amount, p.network || '', p.networkFee || 0, p.commission || 0,
      p.paidCurrency || 'USD', p.txDirection || 'SEND', p.fxRate || 0, p.tender || null
    ]];
  }
  if (action === 'fx.get') return ['getFxRates', []];
  if (action === 'fx.refresh') return ['refreshFxPair', []];
  if (action === 'pockets.preview') return ['previewPocketOp', [p.inp || p]];
  if (action === 'pockets.post') {
    return ['postPocketOp', [p.inp || p, p.opId || '', p.ctx || {}]];
  }
  if (action === 'pockets.book') return ['getPocketsBook', [p.day || '', p.pin || '']];
  if (action === 'opening.save') return ['saveOpeningBalances', [p]];
  if (action === 'z.stats') return ['getZReportStats', [p]];
  if (action === 'z.close') return ['closeRegister', [p]];
  if (action === 'invoice.get') return ['getInvoiceReceipt', [p.invoiceId || '']];
  if (action === 'request.lookup') return ['lookupRequest', [p.idempotencyKey || '']];
  return null;
}

function nativeEnvelope_(res) {
  if (!res || typeof res !== 'object' || Array.isArray(res)) {
    return { success: true, code: 'ok', message: '', data: res == null ? null : res };
  }
  var needs = !!res.needsConfirm;
  var ok = res.success !== false && !needs && !res.busy;
  var code = res.code || (needs ? 'needs_confirm' : (res.busy ? 'busy' : (res.inflight ? 'inflight' : (ok ? 'ok' : 'failed'))));
  return { success: ok, code: code, message: String(res.message || ''), data: res };
}

function nativeCopy_(res) {
  var copy = JSON.parse(JSON.stringify(res));
  if (copy && typeof copy === 'object') copy.replayed = true;
  return copy;
}

/**
 * Pure dispatcher. deps:
 *   gate(pin) -> { ok, code, message }
 *   call(name, args) -> server result
 *   runOnce(reqId, day, name, args) optional
 *   fxMid() -> number
 *   recall(key) / remember(key, res) optional, for writes runOnce does not cover
 */
function nativeHandle_(body, deps) {
  body = body || {};
  deps = deps || {};
  var action = String(body.action || '').trim();
  if (NATIVE_ACTION_NAMES_.indexOf(action) < 0) {
    return { success: false, code: 'unknown_action', message: 'العملية مو معروفة.', data: { action: action } };
  }
  if (action === 'ping') {
    return { success: true, code: 'ok', message: '', data: { app: 'mrrobot-cashier', api: 'v89-native' } };
  }
  var gate = deps.gate ? deps.gate(body.pin) : { ok: false, code: 'no_gate', message: 'ما في فحص للرقم السري.' };
  if (!gate.ok) {
    return { success: false, code: gate.code || 'denied', message: gate.message || 'الرقم السري مرفوض.', data: null };
  }
  var payload = body.payload || {};
  if (action === 'pockets.book') payload = Object.assign({ pin: body.pin }, payload);
  if (action === 'pockets.post') {
    var opId = payload.opId || body.idempotencyKey || '';
    payload = Object.assign({}, payload, { opId: opId });
  }
  var drift = nativeFxDrift_(nativeClientRate_(action, payload), deps.fxMid ? deps.fxMid() : 0);
  if (drift != null && drift > 0.5) {
    return {
      success: false,
      code: 'fx_rejected',
      message: 'سعر الصرف بعيد أكتر من النص عن السعر المحفوظ. ما انكتب شي.',
      data: { drift: drift }
    };
  }
  var spec = nativeCallArgs_(action, payload);
  if (!spec) return { success: false, code: 'unknown_action', message: 'العملية مو معروفة.', data: null };
  var fnName = spec[0];
  var args = spec[1];
  var key = String(body.idempotencyKey || '');
  var write = !!NATIVE_RUNONCE_FNS_[action] || action === 'pockets.post' || action === 'opening.save' || action === 'z.close';
  if (write && !nativeKeyOk_(key)) {
    return { success: false, code: 'idempotency', message: 'لازم رقم للمحاولة (٨ خانات على الأقل) حتى ما تنسجل الحركة مرتين.', data: null };
  }
  if (action === 'request.lookup') args = [key || payload.idempotencyKey || ''];

  var produce = function () {
    if (NATIVE_RUNONCE_FNS_[action] && deps.runOnce) {
      return deps.runOnce(key, '', fnName, args);
    }
    if (!deps.call) return { success: false, code: 'missing', message: 'السيرفر ما فيه هالدالة.' };
    return deps.call(fnName, args);
  };

  if (write && !NATIVE_RUNONCE_FNS_[action] && action !== 'pockets.post' && deps.recall) {
    var prev = deps.recall(key);
    if (prev) return nativeEnvelope_(nativeCopy_(prev));
  }

  var raw;
  try {
    raw = produce();
  } catch (err) {
    return { success: false, code: 'error', message: String(err && err.message ? err.message : err), data: null };
  }
  if (write && !NATIVE_RUNONCE_FNS_[action] && action !== 'pockets.post' && deps.remember && raw && raw.success === true) {
    deps.remember(key, raw);
  }
  return nativeEnvelope_(raw);
}

function nativeJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return nativeJson_({ success: false, code: 'bad_json', message: 'الطلب مو JSON.', data: null });
  }
  var deps = {
    gate: function (pin) {
      if (typeof posOwnerGate_ !== 'function') {
        return { ok: false, code: 'no_gate', message: 'فحص الرقم السري مو موجود بهالنسخة.' };
      }
      return posOwnerGate_(pin, true);
    },
    call: function (name, args) {
      var table = {
        processScan: typeof processScan === 'function' ? processScan : null,
        logShamCash: typeof logShamCash === 'function' ? logShamCash : null,
        logMegaTxBulk: typeof logMegaTxBulk === 'function' ? logMegaTxBulk : null,
        logUsdtTransaction: typeof logUsdtTransaction === 'function' ? logUsdtTransaction : null,
        getFxRates: typeof getFxRates === 'function' ? getFxRates : null,
        refreshFxPair: typeof refreshFxPair === 'function' ? refreshFxPair : null,
        previewPocketOp: typeof previewPocketOp === 'function' ? previewPocketOp : null,
        postPocketOp: typeof postPocketOp === 'function' ? postPocketOp : null,
        getPocketsBook: typeof getPocketsBook === 'function' ? getPocketsBook : null,
        saveOpeningBalances: typeof saveOpeningBalances === 'function' ? saveOpeningBalances : null,
        getZReportStats: typeof getZReportStats === 'function' ? getZReportStats : null,
        closeRegister: typeof closeRegister === 'function' ? closeRegister : null,
        getInvoiceReceipt: typeof getInvoiceReceipt === 'function' ? getInvoiceReceipt : null,
        lookupRequest: typeof lookupRequest === 'function' ? lookupRequest : null
      };
      var fn = table[name];
      if (typeof fn !== 'function') return { success: false, code: 'missing', message: 'الدالة ' + name + ' مو موجودة بهالمشروع.' };
      return fn.apply(null, args);
    },
    runOnce: typeof runOnce === 'function' ? runOnce : null,
    fxMid: function () {
      try {
        if (typeof getFxRates !== 'function') return 0;
        var rates = getFxRates();
        return rates && rates.mid ? Number(rates.mid) : 0;
      } catch (e2) {
        return 0;
      }
    },
    recall: function (key) {
      try {
        var raw = CacheService.getScriptCache().get('napi:' + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e3) {
        return null;
      }
    },
    remember: function (key, res) {
      try {
        var text = JSON.stringify(res);
        if (text.length > 90000) {
          text = JSON.stringify({ success: true, slim: true, message: res.message || '', invoice: res.invoice || '' });
        }
        CacheService.getScriptCache().put('napi:' + key, text, 21600);
      } catch (e4) { /* a lost cache still has the sheet row */ }
    }
  };
  return nativeJson_(nativeHandle_(body, deps));
}

if (typeof module === 'object' && module.exports) {
  module.exports = {
    nativeHandle_: nativeHandle_,
    nativeFxDrift_: nativeFxDrift_,
    nativeKeyOk_: nativeKeyOk_,
    nativeCallArgs_: nativeCallArgs_,
    NATIVE_ACTION_NAMES_: NATIVE_ACTION_NAMES_
  };
}
