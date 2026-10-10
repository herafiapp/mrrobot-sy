'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const api = require('./NativeApi.js');

function memoryDeps(calls) {
  const store = {};
  return {
    gate: function (pin) {
      if (pin === '1234') return { ok: true, code: 'ok', message: '' };
      return { ok: false, code: 'bad_pin', message: 'الرقم السري غلط.' };
    },
    call: function (name, args) {
      calls.push({ name: name, args: args });
      return { success: true, message: 'written', invoice: 'INV1' };
    },
    runOnce: function (reqId, day, name, args) {
      calls.push({ name: name, args: args, reqId: reqId, via: 'runOnce' });
      const prev = store[reqId];
      if (prev) {
        const copy = JSON.parse(JSON.stringify(prev));
        copy.replayed = true;
        return copy;
      }
      const res = { success: true, message: 'written', invoice: 'INV1' };
      store[reqId] = res;
      return res;
    },
    fxMid: function () { return 10000; },
    recall: function (key) { return store['mem:' + key] || null; },
    remember: function (key, res) { store['mem:' + key] = res; }
  };
}

test('action list matches the Flutter client', function () {
  const dart = fs.readFileSync(path.join(__dirname, '../flutter_app/lib/api.dart'), 'utf8');
  const block = dart.match(/const kApiActions = \[([\s\S]*?)\];/);
  assert.ok(block, 'kApiActions missing');
  const names = block[1].match(/'([^']+)'/g).map(function (s) { return s.slice(1, -1); });
  assert.deepEqual(names, api.NATIVE_ACTION_NAMES_);
});

test('ping does not need a PIN', function () {
  const out = api.nativeHandle_({ action: 'ping' }, memoryDeps([]));
  assert.equal(out.success, true);
  assert.equal(out.data.api, 'v89-native');
});

test('a sale without the PIN is refused and nothing is called', function () {
  const calls = [];
  const out = api.nativeHandle_({ action: 'sale.scan', payload: { barcode: '1' } }, memoryDeps(calls));
  assert.equal(out.success, false);
  assert.equal(out.code, 'bad_pin');
  assert.equal(calls.length, 0);
});

test('a sale retry uses runOnce once', function () {
  const calls = [];
  const deps = memoryDeps(calls);
  const body = {
    action: 'sale.scan',
    pin: '1234',
    idempotencyKey: 'device-1-abcdefgh',
    payload: { barcode: '123', qty: 1, currency: 'SP', fxRate: 10000 }
  };
  const first = api.nativeHandle_(body, deps);
  const second = api.nativeHandle_(body, deps);
  assert.equal(first.success, true);
  assert.equal(first.data.replayed, undefined);
  assert.equal(second.data.replayed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].via, 'runOnce');
  assert.equal(calls[0].name, 'processScan');
  assert.equal(calls[1].reqId, 'device-1-abcdefgh');
});

test('opening save is remembered without runOnce', function () {
  const calls = [];
  const deps = memoryDeps(calls);
  const body = {
    action: 'opening.save',
    pin: '1234',
    idempotencyKey: 'open-2026-10-10',
    payload: { cashSp: 500000, cashUsd: 100 }
  };
  assert.equal(api.nativeHandle_(body, deps).data.replayed, undefined);
  assert.equal(api.nativeHandle_(body, deps).data.replayed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'saveOpeningBalances');
});

test('a rate more than half away from the saved mid is rejected', function () {
  const calls = [];
  const out = api.nativeHandle_({
    action: 'sham.post',
    pin: '1234',
    idempotencyKey: 'sham-key-0001',
    payload: { transfer: 100000, fxRate: 16000 }
  }, memoryDeps(calls));
  assert.equal(out.code, 'fx_rejected');
  assert.equal(calls.length, 0);
  assert.ok(api.nativeFxDrift_(14000, 10000) < 0.5);
  assert.equal(api.nativeKeyOk_('short'), false);
});

test('sham arguments keep fee mode and direction', function () {
  const spec = api.nativeCallArgs_('sham.post', {
    transfer: 1000000, currency: 'SP', commission: 15000, txDirection: 'SEND', feeMode: 'SEPARATE', fxRate: 10000
  });
  assert.equal(spec[0], 'logShamCash');
  assert.equal(spec[1][0], 1000000);
  assert.equal(spec[1][5], 'SEND');
  assert.equal(spec[1][11], 'SEPARATE');
});
