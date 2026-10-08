"use strict";

(function () {
  const C = globalThis.MrRobotCashier;
  if (!C) return;

  const KEY = "mrrobot-cashier-v1";
  const TABS = ["sale", "sham", "mega", "expense", "today", "products", "more"];
  const RATE_IDS = ["usd-rate", "cart-rate", "sham-rate", "mega-rate"];
  const loaded = loadData();
  const savedCart = loadCart();
  const state = {
    data: loaded.data,
    corrupt: loaded.corrupt,
    cart: savedCart.lines,
    tab: "sale",
    cat: "الكل",
    editingId: null,
    lastSale: null,
    checking: false,
    shamMode: "send",
    shamCurrency: "SYP",
    shamCommissionAuto: true,
    megaKind: "شحن رصيد",
    megaCurrency: "SYP",
    expenseSource: "cashSyp",
    expenseKind: "شخصي",
    openingBox: "cashSyp"
  };
  let attempts = Number(sessionStorage.getItem("mrrobot-attempts") || 0);
  let lockUntil = Number(sessionStorage.getItem("mrrobot-lockout") || 0);
  let toastTimer = 0;

  const $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs) {
    const node = document.createElement(tag);
    const children = Array.prototype.slice.call(arguments, 2);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        const value = attrs[key];
        if (value == null || value === false) return;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = String(value);
        else node.setAttribute(key, String(value));
      });
    }
    children.forEach(function (child) {
      if (child == null || child === false || child === "") return;
      node.append(child);
    });
    return node;
  }

  function loadData() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { data: C.emptyData(), corrupt: false };
    try {
      return { data: C.sanitizeStored(JSON.parse(raw)), corrupt: false };
    } catch (err) {
      try { localStorage.setItem(KEY + "-corrupt", raw); } catch (ignore) {}
      return { data: C.emptyData(), corrupt: true };
    }
  }

  function loadCart() {
    const tender = { cashSyp: "", cashUsd: "", shamSyp: "", shamUsd: "" };
    const empty = { lines: [], discount: "", note: "", tender: tender };
    try {
      const parsed = JSON.parse(sessionStorage.getItem("mrrobot-cart") || "null");
      if (!parsed || typeof parsed !== "object") return empty;
      const rawTender = parsed.tender && typeof parsed.tender === "object" ? parsed.tender : {};
      return {
        lines: C.sanitizeCart(parsed.lines),
        discount: typeof parsed.discount === "string" ? parsed.discount.slice(0, 20) : "",
        note: typeof parsed.note === "string" ? parsed.note.slice(0, 140) : "",
        tender: {
          cashSyp: typeof rawTender.cashSyp === "string" ? rawTender.cashSyp.slice(0, 20) : "",
          cashUsd: typeof rawTender.cashUsd === "string" ? rawTender.cashUsd.slice(0, 20) : "",
          shamSyp: typeof rawTender.shamSyp === "string" ? rawTender.shamSyp.slice(0, 20) : "",
          shamUsd: typeof rawTender.shamUsd === "string" ? rawTender.shamUsd.slice(0, 20) : ""
        }
      };
    } catch (err) {
      return empty;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state.data));
      return true;
    } catch (err) {
      toast("ما قدرنا نحفظ. ممكن الذاكرة امتلت. نزّل نسخة احتياطية.");
      return false;
    }
  }

  function persistCart() {
    if (!$("discount")) return;
    try {
      sessionStorage.setItem("mrrobot-cart", JSON.stringify({
        lines: state.cart,
        discount: $("discount").value,
        note: $("note").value,
        tender: {
          cashSyp: $("tender-cash-syp").value,
          cashUsd: $("tender-cash-usd").value,
          shamSyp: $("tender-sham-syp").value,
          shamUsd: $("tender-sham-usd").value
        }
      }));
    } catch (err) {}
  }

  function toast(message) {
    const node = $("toast");
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 2600);
  }

  function money(amount, currency) {
    return C.formatMoney(amount, currency === "USD" ? "USD" : "SYP");
  }

  function liveBalances() {
    if (!state.data.openings) state.data.openings = C.emptyOpenings();
    if (!Array.isArray(state.data.movements)) state.data.movements = [];
    return C.balances(state.data.openings, state.data.movements);
  }

  function formatDay(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleDateString("ar-SY-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });
    } catch (err) {
      return date.toDateString();
    }
  }

  function stockLabel(product) {
    if (product.stock == null) return "";
    if (product.stock < 0) return "ناقص " + Math.abs(product.stock);
    if (product.stock === 0) return "خلصت";
    return "بالمحل " + product.stock;
  }

  function fillCats(select) {
    select.replaceChildren();
    C.CATEGORIES.forEach(function (category) {
      select.append(el("option", { value: category, text: category }));
    });
  }

  function markOn(selector, attr, value) {
    document.querySelectorAll(selector).forEach(function (button) {
      button.classList.toggle("on", button.getAttribute(attr) === value);
    });
  }

  function amountOf(id) {
    const raw = $(id).value;
    if (String(raw).trim() === "") return 0;
    const n = C.validatePrice(raw);
    return n == null ? 1 : n;
  }

  function shortText(short) {
    const parts = [];
    if (short && short.cashSyp) parts.push("كاش الليرة ناقص " + money(short.cashSyp, "SYP"));
    if (short && short.cashUsd) parts.push("كاش الدولار ناقص " + money(short.cashUsd, "USD"));
    if (!parts.length) return "الصندوق ناقص. غيّر التقسيمة.";
    return parts.join(" · ") + ". غيّر التقسيمة.";
  }

  function coverPhrase(status) {
    if (!status) return "";
    if (status.error === "rate") return "حط سعر الدولار حتى نحسب الليرة والدولار مع بعض.";
    if (status.error === "tender") return "المبالغ أرقام صحيحة، بلا فواصل عشرية.";
    if (status.error === "commission") return "العمولة أكبر من المبلغ.";
    if (status.error === "short") return shortText(status.short);
    if (status.error === "negative") return "الرصيد مو كافي، نكمّل؟";
    if (typeof status.remainder === "number") {
      const cur = status.remainderCurrency || "SYP";
      if (status.remainder === 0) return "مغطى";
      if (status.remainder > 0) return "الباقي " + money(status.remainder, cur);
      return "زيادة " + money(Math.abs(status.remainder), cur);
    }
    if (status.error === "amount" || status.error === "price") return "اكتب المبلغ رقم صحيح.";
    if (status.error === "discount") return "الحسم مو صحيح أو أكبر من المجموع.";
    if (status.error === "empty") return "السلة فاضية.";
    if (status.error === "mixed") return "السلة فيها ليرة ودولار. خلّص وحدة قبل التانية.";
    if (status.error) return "تأكد من الأرقام.";
    return "";
  }

  function setRemain(node, status) {
    const text = coverPhrase(status);
    node.textContent = text;
    node.className = "remain" + (text ? (text === "مغطى" ? " ok" : " bad") : "");
  }

  function renderRateStatus() {
    $("rate-status").textContent = state.data.usdRate
      ? "محفوظ: " + money(state.data.usdRate, "SYP") + " لكل دولار."
      : "بنستخدمه لما الدفع يخلط ليرة ودولار. إذا فاضي ما منخمّن سعر.";
  }

  function syncRateInputs() {
    const text = state.data.usdRate == null ? "" : String(state.data.usdRate);
    RATE_IDS.forEach(function (id) {
      const node = $(id);
      if (!node || document.activeElement === node) return;
      if (node.value !== text) node.value = text;
    });
  }

  function commitRate(node) {
    if (!node) return true;
    const raw = node.value;
    if (String(raw).trim() === "") {
      if (state.data.usdRate != null) {
        state.data.usdRate = null;
        if (!save()) return false;
      }
      $("rate-error").textContent = "";
      renderRateStatus();
      return true;
    }
    const n = C.readRate(raw);
    if (n == null) return false;
    if (n !== state.data.usdRate) {
      state.data.usdRate = n;
      if (!save()) return false;
    }
    $("rate-error").textContent = "";
    renderRateStatus();
    return true;
  }

  function onRateInput(event) {
    const ok = commitRate(event.target);
    if (!ok) {
      const message = "سعر الدولار لازم يكون رقم صحيح.";
      if (event.target.id === "usd-rate") $("rate-error").textContent = message;
      if (event.target.id === "cart-rate") $("cart-error").textContent = message;
      if (event.target.id === "sham-rate") $("sham-error").textContent = message;
      if (event.target.id === "mega-rate") $("mega-warn").textContent = message;
      return;
    }
    $("rate-error").textContent = "";
    $("cart-error").textContent = "";
    syncRateInputs();
    renderCartTotals();
    if (state.tab === "sham") renderSham();
    if (state.tab === "mega") renderMega();
    if (state.tab === "today") renderToday();
  }

  function showLock() {
    const first = !state.data.pinHash;
    $("pin2-wrap").hidden = !first;
    $("lock-help").textContent = first
      ? "أول مرة على هالجهاز. اختار رقم سري من ٤ أرقام حتى الزبون ما يفتح الحسابات إذا مسك الموبايل."
      : "اكتب الرقم السري حتى نفتح الكاشير.";
    $("lock-submit").textContent = first ? "حفظ الرقم السري" : "دخول";
    $("pin").setAttribute("autocomplete", first ? "new-password" : "current-password");
    $("lock-error").textContent = "";
    $("app").hidden = true;
    $("lock").hidden = false;
    document.body.classList.remove("unlocked");
    const wait = lockUntil - Date.now();
    $("lock-submit").disabled = wait > 0;
    if (wait > 0) {
      $("lock-error").textContent = "استنى شوي وجرب مرة ثانية.";
      setTimeout(function () {
        if (Date.now() >= lockUntil) {
          $("lock-submit").disabled = false;
          $("lock-error").textContent = "";
        }
      }, wait + 20);
    }
  }

  function unlock() {
    sessionStorage.setItem("mrrobot-unlocked", "1");
    attempts = 0;
    lockUntil = 0;
    sessionStorage.removeItem("mrrobot-attempts");
    sessionStorage.removeItem("mrrobot-lockout");
    $("pin").value = "";
    $("pin2").value = "";
    $("lock").hidden = true;
    $("app").hidden = false;
    document.body.classList.add("unlocked");
    $("corrupt-note").hidden = !state.corrupt;
    if (!state.data.products.length) {
      $("quick-form").hidden = false;
      $("toggle-quick").setAttribute("aria-expanded", "true");
    }
    renderAll();
    setTab("sale");
    syncCartAria();
  }

  function lockNow() {
    sessionStorage.removeItem("mrrobot-unlocked");
    closeCart();
    showLock();
    $("pin").focus();
  }

  function onLockSubmit(event) {
    event.preventDefault();
    if (Date.now() < lockUntil) {
      $("lock-error").textContent = "استنى شوي وجرب مرة ثانية.";
      return;
    }
    const pin = $("pin").value;
    if (!C.isPin(pin)) {
      $("lock-error").textContent = "الرقم السري ٤ أرقام.";
      return;
    }
    if (!state.data.pinHash) {
      if (C.normalizedPin(pin) !== C.normalizedPin($("pin2").value)) {
        $("lock-error").textContent = "الرقمين مو متطابقين.";
        return;
      }
      C.hashPin(pin).then(function (hash) {
        state.data.pinHash = hash;
        if (!save()) return;
        unlock();
      }).catch(function () {
        $("lock-error").textContent = "ما قدرنا نحفظ الرقم السري على هالمتصفح.";
      });
      return;
    }
    C.hashPin(pin).then(function (hash) {
      if (hash !== state.data.pinHash) {
        attempts += 1;
        if (attempts >= 5) {
          attempts = 0;
          lockUntil = Date.now() + 30000;
          $("lock-error").textContent = "محاولات كتيرة. استنى نص دقيقة.";
          $("lock-submit").disabled = true;
          setTimeout(function () {
            $("lock-submit").disabled = false;
            $("lock-error").textContent = "";
          }, 30000);
        } else {
          $("lock-error").textContent = "الرقم غلط.";
        }
        sessionStorage.setItem("mrrobot-attempts", String(attempts));
        sessionStorage.setItem("mrrobot-lockout", String(lockUntil));
        return;
      }
      unlock();
    }).catch(function () {
      $("lock-error").textContent = "ما قدرنا نتحقق من الرقم على هالمتصفح.";
    });
  }

  function setTab(tab) {
    state.tab = tab;
    TABS.forEach(function (name) {
      const panel = $("panel-" + name);
      if (panel) panel.hidden = name !== tab;
      const button = document.querySelector('[data-tab="' + name + '"]');
      if (!button) return;
      if (name === tab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (tab !== "sale") closeCart();
    if (tab === "today") renderToday();
    if (tab === "products") renderCatalog();
    if (tab === "more") renderMore();
    if (tab === "sham") renderSham();
    if (tab === "mega") renderMega();
    if (tab === "expense") renderExpense();
    renderCartBar();
  }

  function renderHeader() {
    const bals = liveBalances();
    const node = $("header-total");
    node.textContent = money(bals.cashSyp, "SYP") + " · " + money(bals.cashUsd, "USD");
    node.setAttribute("title", "كاش الليرة وكاش الدولار");
  }

  function needsBackup() {
    const moves = (state.data.movements || []).filter(function (move) { return !move.voided; }).length;
    const sales = (state.data.sales || []).filter(function (sale) { return !sale.voided; }).length;
    if (moves + sales < 3) return false;
    if (!state.data.lastExportAt) return true;
    return Date.now() - state.data.lastExportAt > 3 * 86400000;
  }

  function renderBanner() {
    $("backup-banner").hidden = !needsBackup();
  }

  function renderCats() {
    const available = state.data.products.some(function (product) { return product.category === state.cat; });
    if (state.cat !== "الكل" && !available) state.cat = "الكل";
    const wrap = $("cats");
    wrap.replaceChildren();
    ["الكل"].concat(C.CATEGORIES).forEach(function (category) {
      const count = category === "الكل"
        ? state.data.products.length
        : state.data.products.filter(function (product) { return product.category === category; }).length;
      if (category !== "الكل" && count === 0) return;
      const button = el("button", {
        type: "button",
        class: state.cat === category ? "chip on" : "chip",
        text: category
      });
      button.addEventListener("click", function () {
        state.cat = category;
        renderCats();
        renderProductGrid();
      });
      wrap.append(button);
    });
  }

  function renderProductGrid() {
    const grid = $("product-grid");
    const products = C.filterProducts(state.data.products, { q: $("search").value, category: state.cat });
    grid.replaceChildren();
    if (!products.length) {
      grid.append(el("p", {
        class: "hint",
        text: state.data.products.length
          ? "ما في شي بهالاسم."
          : "ما في قطع محفوظة. فيك تبيع قطعة مو بالقائمة من فوق."
      }));
      return;
    }
    products.forEach(function (product) {
      const inCart = state.cart.find(function (line) { return line.productId === product.id; });
      const button = el("button", {
        type: "button",
        class: product.stock === 0 ? "product out" : "product"
      });
      button.append(
        el("span", { class: "pname", text: product.name }),
        el("span", { class: "price", text: money(product.price, product.currency) })
      );
      if (product.stock != null) button.append(el("span", { class: "stock", text: stockLabel(product) }));
      if (inCart) button.append(el("span", { class: "badge", text: String(inCart.qty) }));
      button.addEventListener("click", function () { addProductToCart(product); });
      grid.append(button);
    });
  }

  function cartCurrency() {
    if (!state.cart.length) return null;
    return state.cart[0].currency === "USD" ? "USD" : "SYP";
  }

  function addProductToCart(product) {
    const currency = product.currency === "USD" ? "USD" : "SYP";
    if (cartCurrency() && cartCurrency() !== currency) {
      toast("السلة بعملة ثانية. خلّص البيع أو فضّيها.");
      return;
    }
    const current = state.cart.find(function (line) { return line.productId === product.id; });
    const nextQty = (current ? current.qty : 0) + 1;
    if (product.stock != null && nextQty === product.stock + 1) {
      toast(product.stock <= 0 ? "هاي القطعة مخلّصة بالمحل، بس ضفناها." : "الكمية بالسلة صارت أكتر من الموجود.");
    }
    state.cart = C.addToCart(state.cart, {
      productId: product.id,
      name: product.name,
      price: product.price,
      currency: currency,
      qty: 1
    });
    persistCart();
    renderCartLines();
    renderCartTotals();
    renderProductGrid();
  }

  function renderCartLines() {
    const box = $("cart-lines");
    box.replaceChildren();
    if (!state.cart.length) {
      box.append(el("p", { class: "hint", text: "السلة فاضية." }));
      return;
    }
    state.cart.forEach(function (line) {
      const key = C.cartKey(line);
      const info = el("div", { class: "cinfo" },
        el("strong", { text: line.name }),
        el("div", { class: "mut", text: line.qty + " × " + money(line.price, line.currency) })
      );
      const minus = el("button", { type: "button", text: "−", "aria-label": "أنقص " + line.name });
      const plus = el("button", { type: "button", text: "+", "aria-label": "زيد " + line.name });
      const remove = el("button", { type: "button", text: "شيل", "aria-label": "شيل " + line.name });
      minus.addEventListener("click", function () { changeLine(key, line.qty - 1); });
      plus.addEventListener("click", function () { changeLine(key, line.qty + 1); });
      remove.addEventListener("click", function () { changeLine(key, 0); });
      box.append(el("div", { class: "cline" }, info, el("div", { class: "cqty" }, minus, el("span", { text: String(line.qty) }), plus, remove)));
    });
  }

  function changeLine(key, qty) {
    state.cart = C.changeQty(state.cart, key, qty);
    persistCart();
    renderCartLines();
    renderCartTotals();
    renderProductGrid();
  }

  function discountState() {
    const sub = state.cart.reduce(function (sum, line) { return sum + line.price * line.qty; }, 0);
    if (!state.cart.length) return { error: "", sub: 0, total: 0 };
    const discount = C.validateDiscount($("discount").value);
    if (discount == null) return { error: "اكتب الحسم رقم صحيح.", sub: sub, total: sub };
    if (discount > sub) return { error: "الحسم أكبر من المجموع.", sub: sub, total: sub };
    return { error: "", sub: sub, total: sub - discount };
  }

  function cartTender() {
    return {
      cashSyp: $("tender-cash-syp").value,
      cashUsd: $("tender-cash-usd").value,
      shamSyp: $("tender-sham-syp").value,
      shamUsd: $("tender-sham-usd").value
    };
  }

  function cartNeedsRate() {
    if (!state.cart.length) return false;
    const currency = cartCurrency();
    const syp = amountOf("tender-cash-syp") + amountOf("tender-sham-syp");
    const usd = amountOf("tender-cash-usd") + amountOf("tender-sham-usd");
    if (currency === "USD") return syp > 0;
    return usd > 0;
  }

  function renderCartTotals() {
    const totals = discountState();
    $("discount-error").textContent = totals.error;
    const currency = cartCurrency() || "SYP";
    $("cart-total").textContent = money(state.cart.length ? totals.total : 0, currency);
    const needs = cartNeedsRate();
    $("cart-rate-label").hidden = !needs;
    if (needs) syncRateInputs();
    if (!state.cart.length || totals.error) {
      $("cart-remainder").textContent = "";
      $("cart-remainder").className = "remain";
      $("checkout").disabled = true;
      if (!totals.error) $("cart-error").textContent = "";
      renderCartBar();
      return;
    }
    const status = C.coverStatus({
      due: totals.total,
      currency: currency,
      tender: cartTender(),
      rate: state.data.usdRate
    });
    setRemain($("cart-remainder"), status);
    $("cart-error").textContent = "";
    $("checkout").disabled = Boolean(status.error) || status.remainder !== 0;
    renderCartBar();
  }

  function renderCartBar() {
    const bar = $("cart-bar");
    const wide = window.matchMedia("(min-width: 960px)").matches;
    bar.hidden = state.tab !== "sale" || wide;
    const count = state.cart.reduce(function (sum, line) { return sum + line.qty; }, 0);
    if (!count) {
      bar.textContent = "السلة فاضية";
      return;
    }
    const totals = discountState();
    bar.textContent = C.itemCountLabel(count) + " · " + money(totals.total, cartCurrency());
  }

  function openCart() {
    if (window.matchMedia("(min-width: 960px)").matches) return;
    $("cart-panel").classList.add("open");
    $("scrim").hidden = false;
    syncCartAria();
  }

  function closeCart() {
    $("cart-panel").classList.remove("open");
    $("scrim").hidden = true;
    syncCartAria();
  }

  function syncCartAria() {
    const wide = window.matchMedia("(min-width: 960px)").matches;
    const open = wide || $("cart-panel").classList.contains("open");
    $("cart-panel").setAttribute("aria-hidden", open ? "false" : "true");
  }

  function onQuick(event) {
    event.preventDefault();
    const name = $("quick-name").value.trim();
    const price = C.validatePrice($("quick-price").value);
    const currency = $("quick-cur").value === "USD" ? "USD" : "SYP";
    if (!name || price == null) {
      $("quick-error").textContent = "اكتب الاسم والسعر رقم صحيح، بلا فواصل عشرية.";
      return;
    }
    if (cartCurrency() && cartCurrency() !== currency) {
      $("quick-error").textContent = "السلة بعملة ثانية. خلّصها أو فضّيها.";
      return;
    }
    let productId = null;
    if ($("quick-save").checked) {
      const saved = C.upsertProduct(state.data.products, {
        name: name,
        price: price,
        currency: currency,
        category: $("quick-cat").value,
        stock: ""
      });
      if (saved.error) {
        $("quick-error").textContent = "ما قدرنا نحفظ القطعة.";
        return;
      }
      const previous = state.data.products;
      state.data.products = saved.products;
      if (!save()) {
        state.data.products = previous;
        return;
      }
      productId = saved.product.id;
      renderCats();
      renderCatalog();
    }
    state.cart = C.addToCart(state.cart, {
      productId: productId,
      name: name,
      price: price,
      currency: currency,
      qty: 1
    });
    $("quick-name").value = "";
    $("quick-price").value = "";
    $("quick-error").textContent = "";
    persistCart();
    renderCartLines();
    renderCartTotals();
    renderProductGrid();
    toast("انضافت للسلة.");
  }

  function commitMovement(movement, products) {
    const previous = state.data;
    const next = { movements: (state.data.movements || []).concat([movement]) };
    if (products) next.products = products;
    state.data = Object.assign({}, state.data, next);
    if (!save()) {
      state.data = previous;
      return false;
    }
    renderHeader();
    renderBanner();
    return true;
  }

  function onCheckout() {
    if (state.checking) return;
    if (!$("cart-rate-label").hidden && !commitRate($("cart-rate"))) {
      $("cart-error").textContent = "سعر الدولار لازم يكون رقم صحيح.";
      return;
    }
    const result = C.checkout({
      products: state.data.products,
      cart: state.cart,
      discount: $("discount").value,
      tender: cartTender(),
      rate: state.data.usdRate,
      note: $("note").value,
      now: Date.now()
    });
    if (result.error) {
      $("cart-error").textContent = coverPhrase(result) || "ما تم البيع.";
      return;
    }
    state.checking = true;
    if (!commitMovement(result.movement, result.products)) {
      state.checking = false;
      return;
    }
    state.cart = [];
    $("discount").value = "";
    $("note").value = "";
    ["tender-cash-syp", "tender-cash-usd", "tender-sham-syp", "tender-sham-usd"].forEach(function (id) {
      $(id).value = "";
    });
    persistCart();
    state.checking = false;
    closeCart();
    renderAll();
    showReceipt(result.movement);
    toast("تم البيع.");
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function showReceipt(move) {
    if (!move || move.type !== "sale" || !move.detail) return;
    state.lastSale = move;
    const paper = $("receipt-paper");
    const detail = move.detail;
    const currency = detail.currency === "USD" ? "USD" : "SYP";
    paper.replaceChildren();
    paper.append(el("div", { class: "r-shop", text: "Mr. Robot | مستر روبوت" }));
    paper.append(el("div", { class: "r-center", text: "دمشق - كورنيش التجارة" }));
    paper.append(el("div", { class: "r-center", text: "فاتورة " + String(move.id).slice(-4).toUpperCase() }));
    paper.append(el("div", { class: "r-center", text: C.formatStamp(move.at) }));
    paper.append(el("hr"));
    (detail.items || []).forEach(function (item) {
      paper.append(el("div", { class: "r-row" },
        el("span", { text: item.name + " × " + item.qty }),
        el("span", { text: money(item.price * item.qty, item.currency || currency) })
      ));
    });
    paper.append(el("hr"));
    if (detail.discount) {
      paper.append(el("div", { class: "r-row" },
        el("span", { text: "حسم" }),
        el("span", { text: money(detail.discount, currency) })
      ));
    }
    paper.append(el("div", { class: "r-row total" },
      el("span", { text: "المجموع" }),
      el("span", { text: money(detail.total, currency) })
    ));
    const tender = detail.tender || {};
    const tenderNames = [
      ["cashSyp", "كاش ليرة", "SYP"],
      ["cashUsd", "كاش دولار", "USD"],
      ["shamSyp", "شام كاش ليرة", "SYP"],
      ["shamUsd", "شام كاش دولار", "USD"]
    ];
    tenderNames.forEach(function (row) {
      if (!tender[row[0]]) return;
      paper.append(el("div", { class: "r-row" },
        el("span", { text: row[1] }),
        el("span", { text: money(tender[row[0]], row[2]) })
      ));
    });
    if (detail.rate) paper.append(el("div", { class: "r-center", text: "سعر الدولار " + money(detail.rate, "SYP") }));
    if (move.note) paper.append(el("div", { class: "r-center", text: move.note }));
    if (move.voided) paper.append(el("div", { class: "r-center", text: "ملغية" }));
    paper.append(el("div", { class: "r-center", text: "شكراً لزيارتكم" }));
    paper.append(el("div", { class: "r-center", dir: "ltr", text: "0991008212" }));
    if (!$("receipt-dialog").open) $("receipt-dialog").showModal();
  }

  function shareReceipt() {
    if (!state.lastSale) return;
    const text = C.receiptText(state.lastSale);
    if (navigator.share) {
      navigator.share({ text: text }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        copyText(text);
      });
      return;
    }
    copyText(text);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("نسخنا الفاتورة. فيك تلصقها بواتساب.");
      }).catch(function () { fallbackCopy(text); });
      return;
    }
    fallbackCopy(text);
  }

  function fallbackCopy(text) {
    const area = el("textarea", { text: text });
    document.body.append(area);
    area.select();
    try {
      document.execCommand("copy");
      toast("نسخنا الفاتورة. فيك تلصقها بواتساب.");
    } catch (err) {
      toast("ما قدرنا ننسخ. انسخ الفاتورة بإيدك.");
    }
    area.remove();
  }

  function renderToday() {
    const bals = liveBalances();
    const box = $("balance-cards");
    box.replaceChildren();
    C.BOXES.forEach(function (meta) {
      const open = state.data.openings[meta.id];
      const button = el("button", { type: "button", class: "btn ghost", "data-open": meta.id, text: "عهدة" });
      button.addEventListener("click", function () { openOpening(meta.id); });
      box.append(el("article", { class: "bal-card" },
        el("div", { text: meta.label }),
        el("strong", { "data-balance": meta.id, text: money(bals[meta.id], meta.currency) }),
        el("div", { class: "mut", text: "العهدة: " + (open ? money(open.amount, meta.currency) : "ما انحطت") }),
        button
      ));
    });
    $("today-rate").textContent = state.data.usdRate
      ? "سعر الدولار: " + money(state.data.usdRate, "SYP")
      : "سعر الدولار لسا ما انحط.";
    renderMoves();
  }

  function renderMoves() {
    const list = $("move-list");
    list.replaceChildren();
    const moves = (state.data.movements || []).slice().sort(function (a, b) { return b.at - a.at; });
    if (!moves.length) {
      list.append(el("p", { class: "hint", text: "لسا ما في حركات." }));
      return;
    }
    const shown = moves.slice(0, 100);
    if (moves.length > shown.length) {
      list.append(el("p", { class: "hint", text: "عم نعرض آخر ١٠٠ حركة." }));
    }
    C.groupByDay(shown).forEach(function (group) {
      list.append(el("h3", { class: "day", text: formatDay(group.day) }));
      group.items.forEach(function (move) {
        const info = C.describeMovement(move);
        const actions = el("div", { class: "row" });
        if (move.type === "sale") {
          const receipt = el("button", { type: "button", class: "btn ghost", text: "الفاتورة" });
          receipt.addEventListener("click", function () { showReceipt(move); });
          actions.append(receipt);
        }
        if (!move.voided) {
          const voidButton = el("button", { type: "button", class: "btn danger", text: "إلغاء" });
          voidButton.addEventListener("click", function () { onVoid(move.id); });
          actions.append(voidButton);
        } else {
          actions.append(el("span", { class: "tag", text: "ملغية" }));
        }
        list.append(el("article", { class: move.voided ? "sale voided" : "sale" },
          el("div", { class: "mut", text: C.formatStamp(move.at) }),
          el("strong", { text: info.title }),
          info.changes.length ? el("div", { text: info.changes.join(" · ") }) : null,
          move.note ? el("div", { class: "mut", text: move.note }) : null,
          move.detail && move.detail.rate ? el("div", { class: "mut", text: "سعر الدولار " + money(move.detail.rate, "SYP") }) : null,
          actions
        ));
      });
    });
  }

  function onVoid(id) {
    const move = (state.data.movements || []).find(function (item) { return item.id === id; });
    if (!move || move.voided) return;
    const info = C.describeMovement(move);
    const extra = move.type === "sale" ? " إذا الكمية محسوبة بترجع للمخزون." : "";
    if (!window.confirm("بدك تلغي هالحركة؟ " + info.title + "." + extra)) return;
    const result = C.voidMovement(state.data, id);
    if (result.error) return;
    const previous = state.data;
    state.data = result.data;
    if (!save()) {
      state.data = previous;
      return;
    }
    renderAll();
    toast("انلغت الحركة.");
  }

  function openOpening(id) {
    state.openingBox = id;
    const meta = C.BOXES.find(function (item) { return item.id === id; });
    $("opening-title").textContent = "عهدة " + (meta ? meta.label : "");
    const current = state.data.openings && state.data.openings[id];
    $("opening-amount").value = current ? String(current.amount) : "";
    $("opening-error").textContent = "";
    if (!$("opening-dialog").open) $("opening-dialog").showModal();
    $("opening-amount").focus();
  }

  function onOpeningSubmit(event) {
    event.preventDefault();
    const result = C.setOpening(state.data.openings, state.openingBox, $("opening-amount").value, Date.now());
    if (result.error) {
      $("opening-error").textContent = "اكتب المبلغ رقم صحيح.";
      return;
    }
    const previous = state.data.openings;
    state.data.openings = result.openings;
    if (!save()) {
      state.data.openings = previous;
      return;
    }
    $("opening-dialog").close();
    renderHeader();
    renderToday();
    toast("انحفظت العهدة.");
  }

  function paintCommissionLine() {
    if (state.shamMode !== "send" && state.shamMode !== "receive") {
      $("sham-rate-line").textContent = "";
      return;
    }
    const amount = C.validatePrice($("sham-amount").value);
    if (amount == null || amount <= 0) {
      $("sham-rate-line").textContent = "";
      if (state.shamCommissionAuto) $("sham-commission").value = "";
      return;
    }
    const bps = C.commissionBps(amount, state.shamCurrency);
    const suggested = C.commissionAmount(amount, state.shamCurrency);
    $("sham-rate-line").textContent = "النسبة " + C.formatPercent(bps) + " · العمولة " + money(suggested, state.shamCurrency);
    if (state.shamCommissionAuto) $("sham-commission").value = String(suggested);
  }

  function shamNeedsRate() {
    const usd = amountOf("sham-cash-usd");
    const syp = amountOf("sham-cash-syp");
    if (state.shamCurrency === "SYP") return usd > 0;
    return syp > 0;
  }

  function shamInput(allowNegative) {
    return {
      currency: state.shamCurrency,
      amount: $("sham-amount").value,
      commission: $("sham-commission").value,
      cashSyp: $("sham-cash-syp").value,
      cashUsd: $("sham-cash-usd").value,
      rate: state.data.usdRate,
      note: $("sham-note").value,
      balances: liveBalances(),
      allowNegative: Boolean(allowNegative),
      now: Date.now()
    };
  }

  function buildCurrentSham(allowNegative) {
    const input = shamInput(allowNegative);
    if (state.shamMode === "send") return C.buildShamSend(input);
    if (state.shamMode === "receive") return C.buildShamReceive(input);
    if (state.shamMode === "bill") return C.buildShamBill(input);
    if (state.shamMode === "mega") return C.buildMegaFund(input);
    return C.buildExpense({
      source: state.shamCurrency === "USD" ? "shamUsd" : "shamSyp",
      amount: input.amount,
      kind: "شخصي",
      note: input.note,
      balances: input.balances,
      allowNegative: Boolean(allowNegative),
      now: input.now
    });
  }

  function renderSham() {
    const mode = state.shamMode;
    markOn("[data-sham]", "data-sham", mode);
    markOn("[data-sham-cur]", "data-sham-cur", state.shamCurrency);
    $("sham-commission-box").hidden = mode !== "send" && mode !== "receive";
    $("sham-cash-box").hidden = mode === "mega" || mode === "expense";
    $("sham-cur").hidden = mode === "mega";
    const amountLabels = {
      send: "المبلغ اللي أرسلناه",
      receive: "المبلغ اللي وصلنا",
      bill: "مبلغ الفاتورة",
      mega: "المبلغ بالليرة من شام كاش",
      expense: "المبلغ"
    };
    $("sham-amount-label").textContent = amountLabels[mode] || "المبلغ";
    const handing = mode === "receive";
    $("sham-syp-label").textContent = handing ? "كاش ليرة سلّمناها" : "كاش ليرة استلمناها";
    $("sham-usd-label").textContent = handing ? "كاش دولار سلّمناه" : "كاش دولار استلمناه";
    $("sham-note-caption").textContent = mode === "bill" ? "نوع الفاتورة" : "ملاحظة";
    $("sham-note").placeholder = mode === "bill" ? "كهرباء، ماء، أو غير ذلك" : "اختياري";
    const submitLabels = {
      send: "تأكيد الإرسال",
      receive: "تأكيد الاستقبال",
      bill: "تأكيد الفاتورة",
      mega: "حوّل لميجا",
      expense: "سجّل المصروف"
    };
    $("sham-submit").textContent = submitLabels[mode] || "تأكيد";
    const showRate = (mode === "send" || mode === "receive" || mode === "bill") && shamNeedsRate();
    $("sham-rate-box").hidden = !showRate;
    if (showRate) syncRateInputs();
    const bals = liveBalances();
    $("sham-balances").textContent = "شام كاش ليرة " + money(bals.shamSyp, "SYP") + " · شام كاش دولار " + money(bals.shamUsd, "USD");
    paintCommissionLine();
    updateShamOwed();
    if (String($("sham-amount").value).trim() === "") {
      $("sham-preview").textContent = "";
      $("sham-preview").className = "remain";
      $("sham-error").textContent = "";
      $("sham-submit").disabled = true;
      return;
    }
    const result = buildCurrentSham(false);
    if (result.error === "negative") {
      const covered = result.movement ? "مغطى" : "";
      $("sham-preview").textContent = mode === "mega" || mode === "expense" ? "" : covered;
      $("sham-preview").className = "remain" + (covered ? " ok" : "");
      $("sham-error").textContent = "الرصيد مو كافي، نكمّل؟";
      $("sham-submit").disabled = false;
      return;
    }
    if (result.error || !result.movement) {
      setRemain($("sham-preview"), result);
      $("sham-error").textContent = result.error === "short" ? shortText(result.short) : "";
      if (result.error === "short") $("sham-preview").textContent = "";
      $("sham-submit").disabled = true;
      return;
    }
    $("sham-preview").textContent = mode === "mega" || mode === "expense" ? "جاهز" : "مغطى";
    $("sham-preview").className = "remain ok";
    $("sham-error").textContent = "";
    $("sham-submit").disabled = false;
  }

  function updateShamOwed() {
    const mode = state.shamMode;
    const amount = C.validatePrice($("sham-amount").value);
    const commission = C.validatePrice($("sham-commission").value);
    if (amount == null) {
      $("sham-owed").textContent = "";
      return;
    }
    if (mode === "send" && commission != null) {
      $("sham-owed").textContent = "الزبون يدفع " + money(amount + commission, state.shamCurrency);
      return;
    }
    if (mode === "receive" && commission != null && commission <= amount) {
      $("sham-owed").textContent = "منسلّم الزبون " + money(amount - commission, state.shamCurrency);
      return;
    }
    if (mode === "receive" && commission != null && commission > amount) {
      $("sham-owed").textContent = "العمولة أكبر من المبلغ.";
      return;
    }
    if (mode === "bill") {
      $("sham-owed").textContent = "الزبون يدفع " + money(amount, state.shamCurrency);
      return;
    }
    if (mode === "mega") {
      $("sham-owed").textContent = "شام كاش ليرة بتنقص " + money(amount, "SYP") + " وميجا بتزيد نفس المبلغ.";
      return;
    }
    $("sham-owed").textContent = "";
  }

  function shamToast(mode) {
    if (mode === "send") return "انسجل الإرسال.";
    if (mode === "receive") return "انسجل الاستقبال.";
    if (mode === "bill") return "اندفعت الفاتورة.";
    if (mode === "mega") return "انشحن ميجا.";
    return "انسجل المصروف.";
  }

  function clearShamAmounts() {
    $("sham-amount").value = "";
    $("sham-commission").value = "";
    $("sham-cash-syp").value = "";
    $("sham-cash-usd").value = "";
    $("sham-note").value = "";
    state.shamCommissionAuto = true;
  }

  function onShamSubmit(event) {
    event.preventDefault();
    if (state.checking) return;
    if (!$("sham-rate-box").hidden && !commitRate($("sham-rate"))) {
      $("sham-error").textContent = "سعر الدولار لازم يكون رقم صحيح.";
      return;
    }
    if ((state.shamMode === "send" || state.shamMode === "receive") && String($("sham-commission").value).trim() === "") {
      state.shamCommissionAuto = true;
      paintCommissionLine();
    }
    let result = buildCurrentSham(false);
    if (result.error === "negative") {
      if (!window.confirm("الرصيد مو كافي، نكمّل؟")) return;
      result = buildCurrentSham(true);
    }
    if (result.error || !result.movement) {
      $("sham-error").textContent = coverPhrase(result) || "تأكد من الأرقام.";
      renderSham();
      return;
    }
    state.checking = true;
    if (!commitMovement(result.movement)) {
      state.checking = false;
      return;
    }
    state.checking = false;
    clearShamAmounts();
    renderSham();
    toast(shamToast(state.shamMode));
  }

  function megaTender() {
    return {
      cashSyp: $("mega-cash-syp").value,
      cashUsd: $("mega-cash-usd").value,
      shamSyp: $("mega-sham-syp").value,
      shamUsd: $("mega-sham-usd").value
    };
  }

  function megaNeedsRate() {
    const syp = amountOf("mega-cash-syp") + amountOf("mega-sham-syp");
    const usd = amountOf("mega-cash-usd") + amountOf("mega-sham-usd");
    if (state.megaCurrency === "USD") return syp > 0;
    return usd > 0;
  }

  function megaPayload(allowNegative) {
    return {
      kind: state.megaKind,
      megaOut: $("mega-out").value,
      currency: state.megaCurrency,
      price: $("mega-price").value,
      tender: megaTender(),
      rate: state.data.usdRate,
      note: $("mega-note").value,
      balances: liveBalances(),
      allowNegative: Boolean(allowNegative),
      now: Date.now()
    };
  }

  function renderMega() {
    markOn("[data-mega-kind]", "data-mega-kind", state.megaKind);
    markOn("[data-mega-cur]", "data-mega-cur", state.megaCurrency);
    const bals = liveBalances();
    $("mega-balance").textContent = "رصيد ميجا: " + money(bals.mega, "SYP");
    const needs = megaNeedsRate();
    $("mega-rate-label").hidden = !needs;
    if (needs) syncRateInputs();
    if (String($("mega-out").value).trim() === "" || String($("mega-price").value).trim() === "") {
      $("mega-remainder").textContent = "";
      $("mega-remainder").className = "remain";
      $("mega-warn").textContent = "";
      $("mega-submit").disabled = true;
      return;
    }
    const result = C.buildMegaService(megaPayload(false));
    if (result.error === "negative") {
      setRemain($("mega-remainder"), { remainder: 0 });
      $("mega-warn").textContent = "الرصيد مو كافي، نكمّل؟";
      $("mega-submit").disabled = false;
      return;
    }
    $("mega-warn").textContent = "";
    if (result.error || !result.movement) {
      setRemain($("mega-remainder"), result);
      $("mega-submit").disabled = true;
      return;
    }
    setRemain($("mega-remainder"), { remainder: 0 });
    $("mega-submit").disabled = false;
  }

  function onMegaSubmit(event) {
    event.preventDefault();
    if (state.checking) return;
    if (!$("mega-rate-label").hidden && !commitRate($("mega-rate"))) {
      $("mega-warn").textContent = "سعر الدولار لازم يكون رقم صحيح.";
      return;
    }
    let result = C.buildMegaService(megaPayload(false));
    if (result.error === "negative") {
      if (!window.confirm("الرصيد مو كافي، نكمّل؟")) return;
      result = C.buildMegaService(megaPayload(true));
    }
    if (result.error || !result.movement) {
      $("mega-warn").textContent = coverPhrase(result) || "تأكد من الأرقام.";
      renderMega();
      return;
    }
    state.checking = true;
    if (!commitMovement(result.movement)) {
      state.checking = false;
      return;
    }
    state.checking = false;
    $("mega-out").value = "";
    $("mega-price").value = "";
    $("mega-note").value = "";
    ["mega-cash-syp", "mega-cash-usd", "mega-sham-syp", "mega-sham-usd"].forEach(function (id) {
      $(id).value = "";
    });
    renderMega();
    toast("انسجلت خدمة ميجا.");
  }

  function renderExpense() {
    markOn("[data-exp-source]", "data-exp-source", state.expenseSource);
    markOn("[data-exp-kind]", "data-exp-kind", state.expenseKind);
    const bals = liveBalances();
    const box = C.BOXES.find(function (item) { return item.id === state.expenseSource; });
    $("exp-balance").textContent = (box ? box.label : "") + ": " + money(bals[state.expenseSource], box ? box.currency : "SYP");
    const amount = C.validatePrice($("exp-amount").value);
    if (amount && bals[state.expenseSource] < amount) $("exp-warn").textContent = "الرصيد مو كافي، نكمّل؟";
    else $("exp-warn").textContent = "";
  }

  function onExpenseSubmit(event) {
    event.preventDefault();
    if (state.checking) return;
    const payload = {
      source: state.expenseSource,
      amount: $("exp-amount").value,
      kind: state.expenseKind,
      note: $("exp-note").value,
      balances: liveBalances(),
      now: Date.now()
    };
    let result = C.buildExpense(payload);
    if (result.error === "negative") {
      if (!window.confirm("الرصيد مو كافي، نكمّل؟")) return;
      result = C.buildExpense(Object.assign({}, payload, { allowNegative: true }));
    }
    if (result.error || !result.movement) {
      $("exp-warn").textContent = coverPhrase(result) || "تأكد من المبلغ.";
      return;
    }
    state.checking = true;
    if (!commitMovement(result.movement)) {
      state.checking = false;
      return;
    }
    state.checking = false;
    $("exp-amount").value = "";
    $("exp-note").value = "";
    renderExpense();
    toast("انسجل المصروف.");
  }

  function renderCatalog() {
    const box = $("catalog");
    box.replaceChildren();
    const products = C.sortProducts(state.data.products);
    if (!products.length) {
      box.append(el("p", { class: "hint", text: "لسا ما في بضاعة. ضيف قطعة، أو بيعها من صفحة البيع بدون ما تحفظها." }));
      return;
    }
    products.forEach(function (product) {
      const edit = el("button", { type: "button", class: "btn ghost", text: "تعديل" });
      edit.addEventListener("click", function () { openProduct(product); });
      const stock = stockLabel(product);
      box.append(el("div", { class: "prow" },
        el("div", {},
          el("strong", { text: product.name }),
          el("div", { class: "mut", text: product.category + " · " + money(product.price, product.currency) + (stock ? " · " + stock : "") })
        ),
        edit
      ));
    });
  }

  function openProduct(product) {
    state.editingId = product ? product.id : null;
    $("product-title").textContent = product ? "تعديل قطعة" : "قطعة جديدة";
    $("pf-name").value = product ? product.name : "";
    $("pf-price").value = product ? String(product.price) : "";
    $("pf-cur").value = product && product.currency === "USD" ? "USD" : "SYP";
    $("pf-cat").value = product ? product.category : (state.cat !== "الكل" ? state.cat : "غير ذلك");
    $("pf-stock").value = product && product.stock != null ? String(product.stock) : "";
    $("pf-delete").hidden = !product;
    $("pf-error").textContent = "";
    if (!$("product-dialog").open) $("product-dialog").showModal();
    $("pf-name").focus();
  }

  function onSaveProduct(event) {
    event.preventDefault();
    const stock = C.validateStock($("pf-stock").value);
    if (!stock.ok) {
      $("pf-error").textContent = "الكمية لازم تكون رقم.";
      return;
    }
    const saved = C.upsertProduct(state.data.products, {
      id: state.editingId || C.newId(),
      name: $("pf-name").value,
      price: $("pf-price").value,
      currency: $("pf-cur").value,
      category: $("pf-cat").value,
      stock: stock.stock
    });
    if (saved.error) {
      $("pf-error").textContent = "تأكد من الاسم والسعر. السعر رقم صحيح.";
      return;
    }
    const previous = state.data.products;
    state.data.products = saved.products;
    if (!save()) {
      state.data.products = previous;
      return;
    }
    $("product-dialog").close();
    renderCats();
    renderProductGrid();
    renderCatalog();
    toast(state.editingId ? "تعدّلت القطعة." : "انضافت القطعة.");
  }

  function onDeleteProduct() {
    if (!state.editingId) return;
    if (!window.confirm("بدك تحذف هالقطعة؟ الحركات القديمة بتضل، وإذا كانت بالسلة بتنشال منها.")) return;
    const previous = state.data.products;
    state.data.products = C.deleteProduct(state.data.products, state.editingId);
    state.cart = state.cart.filter(function (line) { return line.productId !== state.editingId; });
    if (!save()) {
      state.data.products = previous;
      return;
    }
    persistCart();
    $("product-dialog").close();
    renderAll();
    toast("انحذفت القطعة.");
  }

  function renderMore() {
    $("export-status").textContent = state.data.lastExportAt
      ? "آخر نسخة: " + C.formatStamp(state.data.lastExportAt)
      : "لسا ما نزلت نسخة.";
    renderRateStatus();
    syncRateInputs();
  }

  function onExport() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      currency: state.data.currency,
      usdRate: state.data.usdRate,
      openings: state.data.openings,
      products: state.data.products,
      sales: state.data.sales || [],
      movements: state.data.movements || []
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "mrrobot-cashier-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1500);
    state.data.lastExportAt = Date.now();
    save();
    renderBanner();
    renderMore();
    toast("بدأت التنزيل. احتفظ بالملف بمكان آمن.");
  }

  function onImportFile(file) {
    if (!file) return;
    if (file.size > 2000000) {
      toast("الملف كبير كتير.");
      return;
    }
    file.text().then(function (text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        toast("ما قدرنا نقرأ الملف.");
        return;
      }
      let clean;
      try {
        clean = C.sanitizeBackup(parsed);
      } catch (err) {
        toast("الملف مو نسخة من كاشير مستر روبوت.");
        return;
      }
      const message = "النسخة فيها " + clean.products.length + " قطعة و " + clean.movements.length + " حركة. رح نستبدل البضاعة والحركات والعهدة وسعر الدولار. الرقم السري بيضل.";
      if (!window.confirm(message)) return;
      const previous = state.data;
      state.data = Object.assign({}, state.data, {
        currency: clean.currency,
        usdRate: clean.usdRate,
        openings: clean.openings,
        products: clean.products,
        sales: clean.sales,
        movements: clean.movements
      });
      state.cart = [];
      $("discount").value = "";
      $("note").value = "";
      ["tender-cash-syp", "tender-cash-usd", "tender-sham-syp", "tender-sham-usd"].forEach(function (id) {
        $(id).value = "";
      });
      if (!save()) {
        state.data = previous;
        return;
      }
      persistCart();
      renderAll();
      const dropped = clean.droppedProducts || clean.droppedSales || clean.droppedMovements;
      toast(dropped ? "استرجعنا النسخة، وفيه أسطر ما انفهمت وتجاوزناها." : "استرجعنا النسخة.");
    }).catch(function () {
      toast("ما قدرنا نقرأ الملف.");
    });
  }

  function wipe() {
    if ($("wipe-word").value.trim() !== "مسح") return;
    if (!window.confirm("آخر تأكيد: كل البضاعة والحركات رح تنمسح من هالجهاز.")) return;
    localStorage.removeItem(KEY);
    sessionStorage.removeItem("mrrobot-unlocked");
    sessionStorage.removeItem("mrrobot-cart");
    sessionStorage.removeItem("mrrobot-attempts");
    sessionStorage.removeItem("mrrobot-lockout");
    location.reload();
  }

  function renderAll() {
    renderHeader();
    renderBanner();
    renderCats();
    renderProductGrid();
    renderCartLines();
    renderCartTotals();
    syncRateInputs();
    if (state.tab === "today") renderToday();
    if (state.tab === "products") renderCatalog();
    if (state.tab === "more") renderMore();
    if (state.tab === "sham") renderSham();
    if (state.tab === "mega") renderMega();
    if (state.tab === "expense") renderExpense();
  }

  function boot() {
    fillCats($("quick-cat"));
    fillCats($("pf-cat"));
    $("quick-cat").value = "غير ذلك";
    $("pf-cat").value = "غير ذلك";
    $("discount").value = savedCart.discount;
    $("note").value = savedCart.note;
    $("tender-cash-syp").value = savedCart.tender.cashSyp;
    $("tender-cash-usd").value = savedCart.tender.cashUsd;
    $("tender-sham-syp").value = savedCart.tender.shamSyp;
    $("tender-sham-usd").value = savedCart.tender.shamUsd;
    $("lock-form").addEventListener("submit", onLockSubmit);
    $("quick-form").addEventListener("submit", onQuick);
    $("product-form").addEventListener("submit", onSaveProduct);
    $("sham-form").addEventListener("submit", onShamSubmit);
    $("mega-form").addEventListener("submit", onMegaSubmit);
    $("expense-form").addEventListener("submit", onExpenseSubmit);
    $("opening-form").addEventListener("submit", onOpeningSubmit);
    $("toggle-quick").addEventListener("click", function () {
      const form = $("quick-form");
      form.hidden = !form.hidden;
      $("toggle-quick").setAttribute("aria-expanded", form.hidden ? "false" : "true");
      if (!form.hidden) $("quick-name").focus();
    });
    $("quick-save").addEventListener("change", function () {
      $("quick-cat-wrap").hidden = !$("quick-save").checked;
    });
    $("search").addEventListener("input", renderProductGrid);
    ["discount", "note", "tender-cash-syp", "tender-cash-usd", "tender-sham-syp", "tender-sham-usd"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        persistCart();
        renderCartTotals();
      });
    });
    $("checkout").addEventListener("click", onCheckout);
    $("cart-bar").addEventListener("click", openCart);
    $("close-cart").addEventListener("click", closeCart);
    $("scrim").addEventListener("click", closeCart);
    $("lock-now").addEventListener("click", lockNow);
    $("lock-more").addEventListener("click", lockNow);
    $("add-product").addEventListener("click", function () { openProduct(null); });
    $("pf-cancel").addEventListener("click", function () { $("product-dialog").close(); });
    $("pf-delete").addEventListener("click", onDeleteProduct);
    $("print-receipt").addEventListener("click", function () {
      const root = $("print-root");
      root.replaceChildren($("receipt-paper").cloneNode(true));
      window.print();
    });
    $("share-receipt").addEventListener("click", shareReceipt);
    $("close-receipt").addEventListener("click", function () { $("receipt-dialog").close(); });
    $("export-btn").addEventListener("click", onExport);
    $("banner-export").addEventListener("click", onExport);
    $("import-btn").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function () {
      const file = $("import-file").files && $("import-file").files[0];
      $("import-file").value = "";
      if (file) onImportFile(file);
    });
    RATE_IDS.forEach(function (id) {
      const node = $(id);
      if (node) node.addEventListener("input", onRateInput);
    });
    $("wipe-word").addEventListener("input", function () {
      $("wipe-btn").disabled = $("wipe-word").value.trim() !== "مسح";
    });
    $("wipe-btn").addEventListener("click", wipe);
    $("opening-cancel").addEventListener("click", function () { $("opening-dialog").close(); });
    $("sham-modes").addEventListener("click", function (event) {
      const button = event.target.closest("[data-sham]");
      if (!button) return;
      state.shamMode = button.getAttribute("data-sham");
      state.shamCommissionAuto = true;
      clearShamAmounts();
      renderSham();
    });
    $("sham-cur").addEventListener("click", function (event) {
      const button = event.target.closest("[data-sham-cur]");
      if (!button) return;
      state.shamCurrency = button.getAttribute("data-sham-cur");
      state.shamCommissionAuto = true;
      renderSham();
    });
    ["sham-amount", "sham-cash-syp", "sham-cash-usd", "sham-note"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        if (id === "sham-amount") state.shamCommissionAuto = true;
        renderSham();
      });
    });
    $("sham-commission").addEventListener("input", function () {
      state.shamCommissionAuto = false;
      renderSham();
    });
    $("mega-kinds").addEventListener("click", function (event) {
      const button = event.target.closest("[data-mega-kind]");
      if (!button) return;
      state.megaKind = button.getAttribute("data-mega-kind");
      renderMega();
    });
    $("mega-cur").addEventListener("click", function (event) {
      const button = event.target.closest("[data-mega-cur]");
      if (!button) return;
      state.megaCurrency = button.getAttribute("data-mega-cur");
      renderMega();
    });
    ["mega-out", "mega-price", "mega-cash-syp", "mega-cash-usd", "mega-sham-syp", "mega-sham-usd", "mega-note"].forEach(function (id) {
      $(id).addEventListener("input", renderMega);
    });
    $("exp-sources").addEventListener("click", function (event) {
      const button = event.target.closest("[data-exp-source]");
      if (!button) return;
      state.expenseSource = button.getAttribute("data-exp-source");
      renderExpense();
    });
    $("exp-kinds").addEventListener("click", function (event) {
      const button = event.target.closest("[data-exp-kind]");
      if (!button) return;
      state.expenseKind = button.getAttribute("data-exp-kind");
      renderExpense();
    });
    $("exp-amount").addEventListener("input", renderExpense);
    document.querySelector(".nav").addEventListener("click", function (event) {
      const button = event.target.closest("[data-tab]");
      if (!button) return;
      setTab(button.getAttribute("data-tab"));
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && $("cart-panel").classList.contains("open")) closeCart();
    });
    window.matchMedia("(min-width: 960px)").addEventListener("change", function () {
      closeCart();
      renderCartBar();
    });
    if (state.data.pinHash && sessionStorage.getItem("mrrobot-unlocked") === "1") unlock();
    else showLock();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  boot();
})();
