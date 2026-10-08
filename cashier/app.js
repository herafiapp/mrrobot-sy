"use strict";

(function () {
  const C = globalThis.MrRobotCashier;
  if (!C) return;

  const KEY = "mrrobot-cashier-v1";
  const loaded = loadData();
  const savedCart = loadCart();
  const state = {
    data: loaded.data,
    corrupt: loaded.corrupt,
    cart: savedCart.lines,
    pay: savedCart.pay,
    tab: "sale",
    cat: "الكل",
    editingId: null,
    lastSale: null,
    checking: false
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
    const empty = { lines: [], discount: "", pay: "cash", note: "" };
    try {
      const parsed = JSON.parse(sessionStorage.getItem("mrrobot-cart") || "null");
      if (!parsed || typeof parsed !== "object") return empty;
      const pay = parsed.pay === "transfer" || parsed.pay === "shamcash" ? parsed.pay : "cash";
      return {
        lines: C.sanitizeCart(parsed.lines),
        discount: typeof parsed.discount === "string" ? parsed.discount.slice(0, 20) : "",
        pay: pay,
        note: typeof parsed.note === "string" ? parsed.note.slice(0, 140) : ""
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
    try {
      sessionStorage.setItem("mrrobot-cart", JSON.stringify({
        lines: state.cart,
        discount: $("discount").value,
        pay: state.pay,
        note: $("note").value
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

  function money(amount) {
    return C.formatMoney(amount, state.data.currency);
  }

  function payLabel(id) {
    const found = C.PAY_METHODS.find(function (item) { return item.id === id; });
    return found ? found.label : "كاش";
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

  function todayRange(now) {
    const start = C.startOfDay(now);
    const end = C.addDays(start, 1);
    return {
      today: [start, end],
      week: [C.addDays(start, -6), end],
      month: [C.addDays(start, -29), end]
    };
  }

  function fillCats(select) {
    select.replaceChildren();
    C.CATEGORIES.forEach(function (category) {
      select.append(el("option", { value: category, text: category }));
    });
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
    ["sale", "today", "products", "more"].forEach(function (name) {
      $("panel-" + name).hidden = name !== tab;
      const button = document.querySelector('[data-tab="' + name + '"]');
      if (!button) return;
      if (name === tab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (tab !== "sale") closeCart();
    if (tab === "today") renderToday();
    if (tab === "products") renderCatalog();
    if (tab === "more") renderMore();
    renderCartBar();
  }

  function renderHeader() {
    const range = todayRange(Date.now()).today;
    $("header-total").textContent = "اليوم " + money(C.sumSales(state.data.sales, range[0], range[1]));
  }

  function needsBackup() {
    const count = state.data.sales.filter(function (sale) { return !sale.voided; }).length;
    if (count < 3) return false;
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
    const cats = ["الكل"].concat(C.CATEGORIES);
    cats.forEach(function (category) {
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
        el("span", { class: "price", text: money(product.price) })
      );
      if (product.stock != null) button.append(el("span", { class: "stock", text: stockLabel(product) }));
      if (inCart) button.append(el("span", { class: "badge", text: String(inCart.qty) }));
      button.addEventListener("click", function () { addProductToCart(product); });
      grid.append(button);
    });
  }

  function addProductToCart(product) {
    const current = state.cart.find(function (line) { return line.productId === product.id; });
    const nextQty = (current ? current.qty : 0) + 1;
    if (product.stock != null && nextQty === product.stock + 1) {
      toast(product.stock <= 0 ? "هاي القطعة مخلّصة بالمحل، بس ضفناها." : "الكمية بالسلة صارت أكتر من الموجود.");
    }
    state.cart = C.addToCart(state.cart, {
      productId: product.id,
      name: product.name,
      price: product.price,
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
      const info = el("div", {},
        el("strong", { text: line.name }),
        el("div", { class: "mut", text: line.qty + " × " + money(line.price) })
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

  function renderCartTotals() {
    const totals = discountState();
    $("discount-error").textContent = totals.error;
    $("cart-total").textContent = money(totals.total);
    $("checkout").disabled = !state.cart.length || Boolean(totals.error);
    $("cart-error").textContent = "";
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
    bar.textContent = C.itemCountLabel(count) + " · " + money(totals.total);
  }

  function syncPay() {
    document.querySelectorAll("[data-pay]").forEach(function (button) {
      button.classList.toggle("on", button.getAttribute("data-pay") === state.pay);
    });
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
    if (!name || price == null) {
      $("quick-error").textContent = "اكتب الاسم والسعر رقم صحيح، بلا فواصل عشرية.";
      return;
    }
    let productId = null;
    if ($("quick-save").checked) {
      const saved = C.upsertProduct(state.data.products, {
        name: name,
        price: price,
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
    state.cart = C.addToCart(state.cart, { productId: productId, name: name, price: price, qty: 1 });
    $("quick-name").value = "";
    $("quick-price").value = "";
    $("quick-error").textContent = "";
    persistCart();
    renderCartLines();
    renderCartTotals();
    renderProductGrid();
    toast("انضافت للسلة.");
  }

  function onCheckout() {
    if (state.checking) return;
    const result = C.checkout({
      products: state.data.products,
      cart: state.cart,
      discount: $("discount").value,
      payMethod: state.pay,
      note: $("note").value,
      now: Date.now()
    });
    if (result.error) {
      $("cart-error").textContent = result.error === "discount"
        ? "الحسم مو صحيح أو أكبر من المجموع."
        : "السلة فاضية.";
      return;
    }
    state.checking = true;
    const previous = state.data;
    state.data = Object.assign({}, state.data, {
      products: result.products,
      sales: state.data.sales.concat([result.sale])
    });
    if (!save()) {
      state.data = previous;
      state.checking = false;
      return;
    }
    state.cart = [];
    $("discount").value = "";
    $("note").value = "";
    persistCart();
    state.checking = false;
    closeCart();
    renderAll();
    showReceipt(result.sale);
    toast("تم البيع.");
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function showReceipt(sale) {
    state.lastSale = sale;
    const paper = $("receipt-paper");
    const totals = C.saleTotals(sale);
    paper.replaceChildren();
    paper.append(el("div", { class: "r-shop", text: "Mr. Robot | مستر روبوت" }));
    paper.append(el("div", { class: "r-center", text: "دمشق - كورنيش التجارة" }));
    paper.append(el("div", { class: "r-center", text: "فاتورة " + String(sale.id).slice(-4).toUpperCase() }));
    paper.append(el("div", { class: "r-center", text: C.formatStamp(sale.at) }));
    paper.append(el("hr"));
    sale.items.forEach(function (item) {
      paper.append(el("div", { class: "r-row" },
        el("span", { text: item.name + " × " + item.qty }),
        el("span", { text: money(item.price * item.qty) })
      ));
    });
    paper.append(el("hr"));
    if (totals.discount) {
      paper.append(el("div", { class: "r-row" },
        el("span", { text: "حسم" }),
        el("span", { text: money(totals.discount) })
      ));
    }
    paper.append(el("div", { class: "r-row total" },
      el("span", { text: "المجموع" }),
      el("span", { text: money(totals.total) })
    ));
    paper.append(el("div", { class: "r-center", text: "الدفع: " + payLabel(sale.payMethod) }));
    if (sale.note) paper.append(el("div", { class: "r-center", text: sale.note }));
    if (sale.voided) paper.append(el("div", { class: "r-center", text: "ملغية" }));
    paper.append(el("div", { class: "r-center", text: "شكراً لزيارتكم" }));
    paper.append(el("div", { class: "r-center", dir: "ltr", text: "0991008212" }));
    if (!$("receipt-dialog").open) $("receipt-dialog").showModal();
  }

  function shareReceipt() {
    if (!state.lastSale) return;
    const text = C.receiptText(state.lastSale, state.data.currency);
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
    const now = Date.now();
    const range = todayRange(now);
    $("stat-today").textContent = money(C.sumSales(state.data.sales, range.today[0], range.today[1]));
    $("stat-week").textContent = money(C.sumSales(state.data.sales, range.week[0], range.week[1]));
    $("stat-month").textContent = money(C.sumSales(state.data.sales, range.month[0], range.month[1]));
    const breakdown = C.payBreakdown(state.data.sales, range.today[0], range.today[1]);
    $("pay-break").textContent = "اليوم: " + C.PAY_METHODS.map(function (item) {
      return item.label + " " + money(breakdown[item.id]);
    }).join(" · ");
    const recent = state.data.sales
      .filter(function (sale) { return sale.at >= range.month[0]; })
      .sort(function (a, b) { return b.at - a.at; });
    const list = $("sales-list");
    list.replaceChildren();
    if (!recent.length) {
      list.append(el("p", { class: "hint", text: "لسا ما في مبيعات." }));
      return;
    }
    const shown = recent.slice(0, 100);
    if (recent.length > shown.length) {
      list.append(el("p", { class: "hint", text: "عم نعرض آخر ١٠٠ عملية." }));
    }
    C.groupByDay(shown).forEach(function (group) {
      list.append(el("h3", { class: "day", text: formatDay(group.day) }));
      group.sales.forEach(function (sale) {
        const actions = el("div", { class: "row" });
        const receipt = el("button", { type: "button", class: "btn ghost", text: "الفاتورة" });
        receipt.addEventListener("click", function () { showReceipt(sale); });
        actions.append(receipt);
        if (!sale.voided) {
          const voidButton = el("button", { type: "button", class: "btn danger", text: "إلغاء البيع" });
          voidButton.addEventListener("click", function () { onVoid(sale.id); });
          actions.append(voidButton);
        } else {
          actions.append(el("span", { class: "tag", text: "ملغي" }));
        }
        list.append(el("article", { class: sale.voided ? "sale voided" : "sale" },
          el("div", { class: "mut", text: C.formatStamp(sale.at) }),
          el("div", { text: sale.items.map(function (item) { return item.name + " ×" + item.qty; }).join("، ") }),
          el("strong", { text: money(sale.total) + " · " + payLabel(sale.payMethod) }),
          sale.note ? el("div", { class: "mut", text: sale.note }) : null,
          actions
        ));
      });
    });
  }

  function onVoid(id) {
    const sale = state.data.sales.find(function (item) { return item.id === id; });
    if (!sale || sale.voided) return;
    if (!window.confirm("بدك تلغي هالبيع (" + money(sale.total) + ")؟ إذا الكمية محسوبة بترجع للمخزون.")) return;
    const result = C.voidSale(state.data, id);
    if (result.error) return;
    const previous = state.data;
    state.data = result.data;
    if (!save()) {
      state.data = previous;
      return;
    }
    renderAll();
    toast("انلغى البيع.");
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
          el("div", { class: "mut", text: product.category + " · " + money(product.price) + (stock ? " · " + stock : "") })
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
    if (!window.confirm("بدك تحذف هالقطعة؟ المبيعات القديمة بتضل، وإذا كانت بالسلة بتنشال منها.")) return;
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
    document.querySelectorAll("[data-currency]").forEach(function (button) {
      button.classList.toggle("on", button.getAttribute("data-currency") === state.data.currency);
      button.classList.toggle("pay-btn", true);
    });
  }

  function onExport() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      currency: state.data.currency,
      products: state.data.products,
      sales: state.data.sales
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
      const message = "النسخة فيها " + clean.products.length + " قطعة و " + clean.sales.length + " عملية بيع. رح نستبدل البضاعة والمبيعات على هالجهاز.";
      if (!window.confirm(message)) return;
      const previous = state.data;
      state.data = Object.assign({}, state.data, {
        currency: clean.currency,
        products: clean.products,
        sales: clean.sales
      });
      state.cart = [];
      $("discount").value = "";
      $("note").value = "";
      if (!save()) {
        state.data = previous;
        return;
      }
      persistCart();
      renderAll();
      toast(clean.droppedProducts || clean.droppedSales
        ? "استرجعنا النسخة، وفيه أسطر ما انفهمت وتجاوزناها."
        : "استرجعنا النسخة.");
    }).catch(function () {
      toast("ما قدرنا نقرأ الملف.");
    });
  }

  function setCurrency(code) {
    if (code !== "SYP" && code !== "USD") return;
    if (code === state.data.currency) return;
    const hasNumbers = state.data.products.length || state.data.sales.length;
    if (hasNumbers && !window.confirm("الأرقام رح تضل متل ما هي، بس بيتغير اسم العملة. ما في تحويل تلقائي. نكمّل؟")) return;
    state.data.currency = code;
    if (!save()) return;
    renderAll();
  }

  function wipe() {
    if ($("wipe-word").value.trim() !== "مسح") return;
    if (!window.confirm("آخر تأكيد: كل المبيعات والبضاعة رح تنمسح من هالجهاز.")) return;
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
    if (state.tab === "today") renderToday();
    if (state.tab === "products") renderCatalog();
    if (state.tab === "more") renderMore();
  }

  function boot() {
    fillCats($("quick-cat"));
    fillCats($("pf-cat"));
    $("quick-cat").value = "غير ذلك";
    $("pf-cat").value = "غير ذلك";
    $("discount").value = savedCart.discount;
    $("note").value = savedCart.note;
    syncPay();
    $("lock-form").addEventListener("submit", onLockSubmit);
    $("quick-form").addEventListener("submit", onQuick);
    $("product-form").addEventListener("submit", onSaveProduct);
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
    $("discount").addEventListener("input", function () {
      persistCart();
      renderCartTotals();
    });
    $("note").addEventListener("input", persistCart);
    $("pay").addEventListener("click", function (event) {
      const button = event.target.closest("[data-pay]");
      if (!button) return;
      state.pay = button.getAttribute("data-pay");
      syncPay();
      persistCart();
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
    $("currency").addEventListener("click", function (event) {
      const button = event.target.closest("[data-currency]");
      if (!button) return;
      setCurrency(button.getAttribute("data-currency"));
    });
    $("wipe-word").addEventListener("input", function () {
      $("wipe-btn").disabled = $("wipe-word").value.trim() !== "مسح";
    });
    $("wipe-btn").addEventListener("click", wipe);
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
