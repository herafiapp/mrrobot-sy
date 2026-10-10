"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./core.js");

test("prices accept thousands separators and Arabic digits", function () {
  assert.equal(C.validatePrice("15000"), 15000);
  assert.equal(C.validatePrice("15,000"), 15000);
  assert.equal(C.validatePrice("15.000"), 15000);
  assert.equal(C.validatePrice("1.500.000"), 1500000);
  assert.equal(C.validatePrice("١٥٬٠٠٠"), 15000);
  assert.equal(C.validatePrice("15.50"), null);
  assert.equal(C.validatePrice("-5"), null);
  assert.equal(C.validatePrice(""), null);
  assert.equal(C.validateDiscount(""), 0);
  assert.equal(C.validateDiscount("1,000"), 1000);
});

test("Arabic and Latin pins hash the same", async function () {
  assert.equal(C.isPin("١٢٣٤"), true);
  assert.equal(C.isPin("12"), false);
  const a = await C.hashPin("1234");
  const b = await C.hashPin("١٢٣٤");
  const c = await C.hashPin("1235");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
});

test("cart merges the same piece and drops a zero quantity", function () {
  let cart = C.addToCart([], { productId: "p1", name: "شاحن", price: 15000, qty: 1 });
  cart = C.addToCart(cart, { productId: "p1", name: "شاحن", price: 15000, qty: 2 });
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 3);
  cart = C.addToCart(cart, { name: "كبل", price: "8,000", qty: 1 });
  assert.equal(cart.length, 2);
  assert.equal(cart[1].price, 8000);
  const key = C.cartKey(cart[0]);
  cart = C.changeQty(cart, key, 0);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].name, "كبل");
});

test("sell then void restores stock and ignores the voided sale", function () {
  const added = C.upsertProduct([], {
    name: "شاحن",
    price: 15000,
    category: "شواحن",
    stock: 5
  });
  const cart = C.addToCart([], {
    productId: added.product.id,
    name: "شاحن",
    price: 15000,
    qty: 2
  });
  const sold = C.checkout({
    products: added.products,
    cart: cart,
    discount: "5,000",
    tender: { cashSyp: 25000 },
    note: "أبو أحمد",
    now: Date.UTC(2024, 2, 9, 12, 0, 0)
  });
  assert.equal(sold.error, undefined);
  assert.equal(sold.movement.detail.total, 25000);
  assert.equal(sold.products[0].stock, 3);
  assert.equal(sold.movement.note, "أبو أحمد");
  assert.equal(sold.movement.deltas.cashSyp, 25000);

  const data = C.emptyData();
  data.products = sold.products;
  data.movements = [sold.movement];
  assert.equal(C.balances(data.openings, data.movements).cashSyp, 25000);

  const undone = C.voidMovement(data, sold.movement.id);
  assert.equal(undone.data.products[0].stock, 5);
  assert.equal(undone.data.movements[0].voided, true);
  assert.equal(C.balances(undone.data.openings, undone.data.movements).cashSyp, 0);
  const twice = C.voidMovement(undone.data, sold.movement.id);
  assert.equal(twice.error, "missing");
  assert.equal(twice.data.products[0].stock, 5);
});

test("checkout blocks an empty cart and a discount bigger than the total", function () {
  assert.equal(C.checkout({ cart: [], tender: { cashSyp: 0 } }).error, "empty");
  const result = C.checkout({
    cart: [{ name: "كبل", price: 8000, qty: 1 }],
    discount: 9000,
    tender: { cashSyp: 0 },
    products: []
  });
  assert.equal(result.error, "discount");
  const free = C.checkout({
    cart: [{ name: "كفالة", price: 0, qty: 1 }],
    discount: 0,
    tender: {},
    products: [{ id: "x", name: "أخرى", price: 10, stock: 4 }]
  });
  assert.equal(free.movement.detail.total, 0);
  assert.equal(free.products[0].stock, 4);
  const short = C.checkout({
    cart: [{ name: "كبل", price: 8000, qty: 1 }],
    tender: { cashSyp: 1000 }
  });
  assert.equal(short.error, "remainder");
  assert.equal(short.remainder, 7000);
});

test("custom lines do not change stock", function () {
  const products = [{ id: "p1", name: "شاحن", price: 100, category: "شواحن", stock: 2 }];
  const sold = C.checkout({
    products: products,
    cart: [{ name: "سماعة خارجية", price: 3000, qty: 1, currency: "USD" }],
    tender: { cashUsd: 3000 }
  });
  assert.equal(sold.products[0].stock, 2);
  assert.equal(sold.movement.deltas.cashUsd, 3000);
  assert.equal(sold.movement.deltas.cashSyp, 0);
});

test("backup keeps good rows and drops junk", function () {
  const clean = C.sanitizeBackup({
    version: 1,
    currency: "USD",
    products: [
      { id: "a", name: "سماعة", price: 10, category: "سماعات", stock: 2 },
      { id: "a", name: "مكررة", price: 4, category: "كبلات" },
      { name: "   ", price: 5 }
    ],
    sales: [
      {
        id: "s1",
        at: Date.UTC(2024, 5, 1, 9, 30),
        items: [{ name: "سماعة", price: 10, qty: 1, productId: "a" }],
        discount: 0,
        payMethod: "cash",
        note: "تمام",
        voided: false
      },
      { id: "bad", items: [] }
    ]
  });
  assert.equal(clean.currency, "USD");
  assert.equal(clean.products.length, 2);
  assert.notEqual(clean.products[0].id, clean.products[1].id);
  assert.equal(clean.droppedProducts, 1);
  assert.equal(clean.sales.length, 1);
  assert.equal(clean.droppedSales, 1);
  assert.equal(clean.products[0].stock, 2);
  assert.throws(function () { C.sanitizeBackup({ version: 2, products: [], sales: [] }); });
});

test("stored data keeps the pin and ignores a bad product", function () {
  const pin = "a".repeat(64);
  const stored = C.sanitizeStored({
    pinHash: pin,
    currency: "nope",
    products: [{ name: "كبل", price: "2.000", category: "فضائي", stock: "" }],
    sales: [],
    lastExportAt: 10
  });
  assert.equal(stored.pinHash, pin);
  assert.equal(stored.currency, "SYP");
  assert.equal(stored.products[0].category, "غير ذلك");
  assert.equal(stored.products[0].price, 2000);
  assert.equal(stored.products[0].stock, null);
  assert.equal(stored.lastExportAt, 10);
});

test("money, counts, and receipt text", function () {
  assert.equal(C.formatMoney(31000, "SYP"), "31,000 ل.س");
  assert.equal(C.formatMoney(31, "USD"), "$31");
  assert.equal(C.itemCountLabel(1), "قطعة واحدة");
  assert.equal(C.itemCountLabel(2), "قطعتين");
  assert.equal(C.itemCountLabel(4), "4 قطع");
  assert.equal(C.itemCountLabel(11), "11 قطعة");
  const sale = C.checkout({
    cart: [{ name: "شاحن", price: 15000, qty: 1 }, { name: "كبل", price: 8000, qty: 2 }],
    discount: 0,
    tender: { cashSyp: 31000 },
    now: Date.UTC(2024, 9, 8, 15, 30),
    id: "sale-abcd"
  }).movement;
  const text = C.receiptText(sale, "SYP");
  assert.match(text, /31,000 ل\.س/);
  assert.match(text, /شاحن × 1/);
  assert.match(text, /0991008212/);
  assert.match(text, /ABCD/);
  assert.match(text, /كاش ليرة/);
  const groups = C.groupByDay([sale]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sales[0].id, "sale-abcd");
});

test("a saved sale survives a reload", function () {
  const added = C.upsertProduct([], { name: "سماعة", price: 9000, category: "سماعات", stock: 1 });
  const sold = C.checkout({
    products: added.products,
    cart: [{ productId: added.product.id, name: "سماعة", price: 9000, qty: 1 }],
    tender: { cashSyp: 9000 },
    now: Date.now()
  });
  const stored = C.sanitizeStored({
    version: 1,
    pinHash: "",
    currency: "SYP",
    products: sold.products,
    sales: [],
    movements: [sold.movement],
    lastExportAt: null
  });
  assert.equal(stored.products[0].stock, 0);
  assert.equal(stored.movements[0].detail.total, 9000);
  assert.equal(stored.movements[0].detail.items[0].name, "سماعة");
  assert.equal(stored.movements[0].deltas.cashSyp, 9000);
});

test("old backups without the new money fields stay importable and keep the pin", function () {
  const pin = "ab".repeat(32);
  const stored = C.sanitizeStored({
    pinHash: pin,
    currency: "SYP",
    products: [],
    sales: []
  });
  assert.equal(stored.pinHash, pin);
  assert.equal(stored.usdRate, null);
  assert.deepEqual(stored.movements, []);
  assert.equal(stored.openings.cashSyp, null);
  assert.equal(stored.openings.cashUsd, null);
  assert.equal(stored.openings.shamSyp, null);
  assert.equal(stored.openings.shamUsd, null);
  assert.equal(stored.openings.mega, null);
  const oldFile = C.sanitizeBackup({
    version: 1,
    products: [],
    sales: [],
    movements: [
      { id: "old", at: Date.UTC(2024, 1, 1), kind: "in", amount: 5, note: "" }
    ]
  });
  assert.deepEqual(oldFile.movements, []);
  assert.equal(oldFile.droppedMovements, 1);
  assert.equal(oldFile.usdRate, null);
});

test("search respects the category", function () {
  const products = [
    { id: "1", name: "شاحن سامسونج", price: 1, category: "شواحن", stock: null },
    { id: "2", name: "شاحن آيفون", price: 1, category: "موبايلات", stock: null }
  ];
  const found = C.filterProducts(products, { q: "شاحن", category: "شواحن" });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "1");
});

test("commission rate is clamped and linear in SYP and USD", function () {
  assert.equal(C.commissionRate(100000, "SYP"), 0.03);
  assert.equal(C.commissionRate(1000000, "SYP"), 0.015);
  assert.equal(C.commissionRate(550000, "SYP"), 0.0225);
  assert.equal(C.commissionRate(50000, "SYP"), 0.03);
  assert.equal(C.commissionRate(1, "SYP"), 0.03);
  assert.equal(C.commissionRate(2000000, "SYP"), 0.015);
  assert.equal(C.commissionRate(1000001, "SYP"), 0.015);
  assert.equal(C.commissionAmount(100000, "SYP"), 3000);
  assert.equal(C.commissionAmount(1000000, "SYP"), 15000);
  assert.equal(C.commissionAmount(550000, "SYP"), 12375);

  assert.equal(C.commissionRate(10, "USD"), 0.03);
  assert.equal(C.commissionRate(100, "USD"), 0.015);
  assert.equal(C.commissionRate(55, "USD"), 0.0225);
  assert.equal(C.commissionRate(9, "USD"), 0.03);
  assert.equal(C.commissionRate(101, "USD"), 0.015);
  assert.equal(C.commissionAmount(100, "USD"), 2);
});

test("a split sale covers 100,000 SYP with cash pounds and dollars", function () {
  const missing = C.checkout({
    cart: [{ name: "قطعة", price: 100000, qty: 1, currency: "SYP" }],
    tender: { cashSyp: 40000, cashUsd: 6 },
    rate: null
  });
  assert.equal(missing.error, "rate");

  const sold = C.checkout({
    cart: [{ name: "قطعة", price: 100000, qty: 1, currency: "SYP" }],
    tender: { cashSyp: 40000, cashUsd: 6, shamSyp: 0, shamUsd: 0 },
    rate: 10000,
    now: Date.UTC(2024, 9, 8, 12, 0),
    id: "split-1"
  });
  assert.equal(sold.error, undefined);
  const cover = C.coverStatus({
    due: 100000,
    currency: "SYP",
    tender: { cashSyp: 40000, cashUsd: 6 },
    rate: 10000
  });
  assert.equal(cover.remainder, 0);
  assert.equal(sold.movement.deltas.cashSyp, 40000);
  assert.equal(sold.movement.deltas.cashUsd, 6);
  assert.equal(sold.movement.deltas.shamSyp, 0);
  assert.equal(sold.movement.deltas.shamUsd, 0);
  assert.equal(sold.movement.deltas.mega, 0);
  const data = C.emptyData();
  data.movements = [sold.movement];
  const bals = C.balances(data.openings, data.movements);
  assert.equal(bals.cashSyp, 40000);
  assert.equal(bals.cashUsd, 6);
  assert.equal(bals.shamSyp, 0);
  assert.equal(bals.shamUsd, 0);
  assert.equal(bals.mega, 0);

  function covered(tender, extra) {
    const status = C.coverStatus(Object.assign({
      due: 100000,
      currency: "SYP",
      rate: 10000
    }, extra || {}, { tender: tender }));
    assert.equal(status.error, undefined);
    assert.equal(status.remainder, 0);
  }
  covered({ cashSyp: 100000 }, { rate: null });
  covered({ cashUsd: 10 }, { due: 10, currency: "USD", rate: null });
  covered({ shamSyp: 100000, shamUsd: 0 }, { rate: null });
  covered({ cashSyp: 40000, cashUsd: 6 });
  covered({ cashSyp: 20000, shamSyp: 20000, cashUsd: 6 });
  covered({ cashSyp: 50000, shamSyp: 50000 }, { rate: null });
  covered({ cashUsd: 4, shamSyp: 60000 });
  covered({ cashUsd: 4, shamUsd: 6 });
});

test("Sham Cash send of 1,000,000 SYP takes the fee in cash", function () {
  const sent = C.buildShamSend({
    currency: "SYP",
    amount: 1000000,
    cashSyp: 1015000,
    cashUsd: 0,
    now: Date.UTC(2024, 9, 8, 13, 0),
    id: "send-1"
  });
  assert.equal(sent.error, undefined);
  assert.equal(sent.commission, 15000);
  assert.equal(sent.owed, 1015000);
  assert.equal(sent.movement.deltas.shamSyp, -1000000);
  assert.equal(sent.movement.deltas.cashSyp, 1015000);
  assert.equal(sent.movement.deltas.cashUsd, 0);
  assert.equal(sent.movement.deltas.shamUsd, 0);
  assert.equal(sent.movement.deltas.mega, 0);
  const data = C.emptyData();
  data.openings = C.setOpening(data.openings, "shamSyp", 1000000, Date.UTC(2024, 9, 8, 8)).openings;
  data.movements = [sent.movement];
  const bals = C.balances(data.openings, data.movements);
  assert.equal(bals.shamSyp, 0);
  assert.equal(bals.cashSyp, 1015000);
});

test("Sham Cash receive of 1,000,000 SYP pays out the net cash", function () {
  const got = C.buildShamReceive({
    currency: "SYP",
    amount: 1000000,
    cashSyp: 985000,
    cashUsd: 0,
    balances: { cashSyp: 985000, cashUsd: 0, shamSyp: 0, shamUsd: 0, mega: 0 },
    now: Date.UTC(2024, 9, 8, 14, 0),
    id: "recv-1"
  });
  assert.equal(got.error, undefined);
  assert.equal(got.commission, 15000);
  assert.equal(got.payout, 985000);
  assert.equal(got.movement.deltas.shamSyp, 1000000);
  assert.equal(got.movement.deltas.cashSyp, -985000);
  assert.equal(got.movement.deltas.cashUsd, 0);
  assert.equal(got.movement.deltas.mega, 0);
  const data = C.emptyData();
  data.openings = C.setOpening(data.openings, "cashSyp", 985000, Date.UTC(2024, 9, 8, 8)).openings;
  data.movements = [got.movement];
  assert.equal(C.balances(data.openings, data.movements).cashSyp, 0);
  assert.equal(C.balances(data.openings, data.movements).shamSyp, 1000000);

  const short = C.buildShamReceive({
    currency: "SYP",
    amount: 1000000,
    cashSyp: 985000,
    balances: { cashSyp: 1000, cashUsd: 50, shamSyp: 0, shamUsd: 0, mega: 0 }
  });
  assert.equal(short.error, "short");
  assert.equal(short.short.cashSyp, 984000);
  assert.equal(short.movement, undefined);

  const tooMuch = C.buildShamReceive({
    currency: "SYP",
    amount: 1000000,
    commission: 1000001,
    cashSyp: 0
  });
  assert.equal(tooMuch.error, "commission");
});

test("Mega top-up from Sham Cash moves both balances", function () {
  const funded = C.buildMegaFund({
    amount: 250000,
    now: Date.UTC(2024, 9, 8, 16, 0),
    id: "mega-fund"
  });
  assert.equal(funded.error, undefined);
  assert.equal(funded.movement.deltas.shamSyp, -250000);
  assert.equal(funded.movement.deltas.mega, 250000);
  assert.equal(funded.movement.deltas.cashSyp, 0);
  assert.equal(funded.movement.deltas.cashUsd, 0);
  assert.equal(funded.movement.deltas.shamUsd, 0);
  const data = C.emptyData();
  data.openings = C.setOpening(data.openings, "shamSyp", 400000, Date.UTC(2024, 9, 8, 8)).openings;
  data.movements = [funded.movement];
  const bals = C.balances(data.openings, data.movements);
  assert.equal(bals.shamSyp, 150000);
  assert.equal(bals.mega, 250000);
  assert.equal(bals.cashSyp, 0);
});

test("a personal expense decreases only the chosen balance", function () {
  const spent = C.buildExpense({
    source: "shamUsd",
    amount: 7,
    kind: "كهرباء",
    note: "مولدة",
    now: Date.UTC(2024, 9, 8, 17, 0),
    id: "exp-1"
  });
  assert.equal(spent.error, undefined);
  assert.equal(spent.movement.deltas.shamUsd, -7);
  assert.equal(spent.movement.deltas.cashSyp, 0);
  assert.equal(spent.movement.deltas.cashUsd, 0);
  assert.equal(spent.movement.deltas.shamSyp, 0);
  assert.equal(spent.movement.deltas.mega, 0);
  assert.equal(spent.movement.note, "مولدة");
  assert.equal(C.buildExpense({ source: "mega", amount: 5, kind: "شخصي" }).error, "source");
  const line = C.describeMovement(spent.movement);
  assert.match(line.text, /مصروف كهرباء/);
  assert.match(line.text, /شام كاش دولار/);
});

test("void reverses deltas once and not twice", function () {
  const added = C.upsertProduct([], { name: "كبل", price: 8000, category: "كبلات", stock: 4 });
  const sold = C.checkout({
    products: added.products,
    cart: [{ productId: added.product.id, name: "كبل", price: 8000, qty: 1 }],
    tender: { cashSyp: 8000 },
    now: Date.UTC(2024, 9, 8, 15, 0),
    id: "sale-void"
  });
  const data = C.emptyData();
  data.products = sold.products;
  data.movements = [sold.movement];
  data.openings = C.setOpening(data.openings, "cashSyp", 1000, Date.UTC(2024, 9, 8, 8)).openings;
  assert.equal(C.balances(data.openings, data.movements).cashSyp, 9000);
  assert.equal(data.products[0].stock, 3);
  const once = C.voidMovement(data, "sale-void");
  assert.equal(once.error, undefined);
  assert.equal(once.data.movements[0].voided, true);
  assert.equal(once.data.movements.length, 1);
  assert.equal(C.balances(once.data.openings, once.data.movements).cashSyp, 1000);
  assert.equal(once.data.products[0].stock, 4);
  const twice = C.voidMovement(once.data, "sale-void");
  assert.equal(twice.error, "missing");
  assert.equal(C.balances(twice.data.openings, twice.data.movements).cashSyp, 1000);
  assert.equal(twice.data.products[0].stock, 4);
  assert.equal(twice.data.movements[0].voided, true);
  assert.equal(twice.data.movements.length, 1);
});

test("a bill paid from Sham Cash has no automatic commission", function () {
  const bill = C.buildShamBill({
    currency: "SYP",
    amount: 50000,
    cashSyp: 20000,
    cashUsd: 3,
    rate: 10000,
    note: "كهرباء",
    now: Date.UTC(2024, 9, 8, 18, 0)
  });
  assert.equal(bill.error, undefined);
  assert.equal(bill.movement.deltas.shamSyp, -50000);
  assert.equal(bill.movement.deltas.cashSyp, 20000);
  assert.equal(bill.movement.deltas.cashUsd, 3);
  assert.equal(bill.movement.note, "كهرباء");
  assert.equal(bill.movement.detail.commission, undefined);
});
