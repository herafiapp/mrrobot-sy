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
    payMethod: "cash",
    note: "أبو أحمد",
    now: Date.UTC(2024, 2, 9, 12, 0, 0)
  });
  assert.equal(sold.error, undefined);
  assert.equal(sold.sale.total, 25000);
  assert.equal(sold.products[0].stock, 3);
  assert.equal(sold.sale.note, "أبو أحمد");

  const data = {
    version: 1,
    pinHash: "",
    currency: "SYP",
    products: sold.products,
    sales: [sold.sale],
    lastExportAt: null
  };
  const day = C.startOfDay(sold.sale.at);
  assert.equal(C.sumSales(data.sales, day, C.addDays(day, 1)), 25000);
  assert.equal(C.countSales(data.sales, day, C.addDays(day, 1)), 1);

  const undone = C.voidSale(data, sold.sale.id);
  assert.equal(undone.data.products[0].stock, 5);
  assert.equal(undone.data.sales[0].voided, true);
  assert.equal(C.sumSales(undone.data.sales, day, C.addDays(day, 1)), 0);
  const twice = C.voidSale(undone.data, sold.sale.id);
  assert.equal(twice.error, "missing");
  assert.equal(twice.data.products[0].stock, 5);
});

test("checkout blocks an empty cart and a discount bigger than the total", function () {
  assert.equal(C.checkout({ cart: [], payMethod: "cash" }).error, "empty");
  const result = C.checkout({
    cart: [{ name: "كبل", price: 8000, qty: 1 }],
    discount: 9000,
    payMethod: "cash",
    products: []
  });
  assert.equal(result.error, "discount");
  const free = C.checkout({
    cart: [{ name: "كفالة", price: 0, qty: 1 }],
    discount: 0,
    payMethod: "shamcash",
    products: [{ id: "x", name: "أخرى", price: 10, stock: 4 }]
  });
  assert.equal(free.sale.total, 0);
  assert.equal(free.products[0].stock, 4);
});

test("custom lines do not change stock", function () {
  const products = [{ id: "p1", name: "شاحن", price: 100, category: "شواحن", stock: 2 }];
  const sold = C.checkout({
    products: products,
    cart: [{ name: "سماعة خارجية", price: 3000, qty: 1 }],
    payMethod: "transfer"
  });
  assert.equal(sold.products[0].stock, 2);
  assert.equal(sold.sale.payMethod, "transfer");
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
    payMethod: "cash",
    now: Date.UTC(2024, 9, 8, 15, 30),
    id: "sale-abcd"
  }).sale;
  const text = C.receiptText(sale, "SYP");
  assert.match(text, /31,000 ل\.س/);
  assert.match(text, /شاحن × 1/);
  assert.match(text, /0991008212/);
  assert.match(text, /ABCD/);
  const day = C.startOfDay(sale.at);
  const breakdown = C.payBreakdown([sale], day, C.addDays(day, 1));
  assert.equal(breakdown.cash, 31000);
  assert.equal(breakdown.transfer, 0);
  const groups = C.groupByDay([sale]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sales[0].id, "sale-abcd");
});

test("a saved sale survives a reload", function () {
  const added = C.upsertProduct([], { name: "سماعة", price: 9000, category: "سماعات", stock: 1 });
  const sold = C.checkout({
    products: added.products,
    cart: [{ productId: added.product.id, name: "سماعة", price: 9000, qty: 1 }],
    payMethod: "cash",
    now: Date.now()
  });
  const stored = C.sanitizeStored({
    version: 1,
    pinHash: "",
    currency: "SYP",
    products: sold.products,
    sales: [sold.sale],
    lastExportAt: null
  });
  assert.equal(stored.products[0].stock, 0);
  assert.equal(stored.sales[0].total, 9000);
  assert.equal(stored.sales[0].items[0].name, "سماعة");
});

test("the drawer only moves with cash", function () {
  const now = Date.UTC(2024, 9, 8, 15, 0);
  const day = C.startOfDay(now);
  const end = C.addDays(day, 1);
  const cash = C.checkout({
    cart: [{ name: "شاحن", price: 15000, qty: 1 }],
    payMethod: "cash",
    now: now,
    id: "cash-sale"
  }).sale;
  const transfer = C.checkout({
    cart: [{ name: "كبل", price: 8000, qty: 1 }],
    payMethod: "transfer",
    now: now + 1000,
    id: "transfer-sale"
  }).sale;
  const sales = [cash, transfer];
  let snap = C.drawerDay(sales, [], day, end);
  assert.equal(snap.cashSales, 15000);
  assert.equal(snap.transfer, 8000);
  assert.equal(snap.expected, 15000);

  let movements = C.setOpening([], "50,000", now, "صباح").movements;
  movements = C.addDrawerMove(movements, "out", 10000, now + 2000, "غدا").movements;
  movements = C.addDrawerMove(movements, "in", 5000, now + 3000, "فكة").movements;
  snap = C.drawerDay(sales, movements, day, end);
  assert.equal(snap.opening, 50000);
  assert.equal(snap.expected, 50000 + 15000 + 5000 - 10000);

  const again = C.setOpening(movements, 40000, now + 4000, "");
  assert.equal(again.movements.filter(function (move) { return move.kind === "open"; }).length, 1);
  snap = C.drawerDay(sales, again.movements, day, end);
  assert.equal(snap.opening, 40000);

  const voided = C.voidSale({ sales: sales, products: [] }, "cash-sale");
  snap = C.drawerDay(voided.data.sales, again.movements, day, end);
  assert.equal(snap.cashSales, 0);
  assert.equal(snap.transfer, 8000);
  assert.equal(snap.expected, 40000 + 5000 - 10000);

  const kept = C.sanitizeStored({
    sales: sales,
    products: [],
    movements: movements
  });
  assert.equal(kept.movements.length, 3);
  const oldFile = C.sanitizeBackup({ version: 1, products: [], sales: [] });
  assert.deepEqual(oldFile.movements, []);
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
