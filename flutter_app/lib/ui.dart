import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';
import 'prayer.dart';
import 'rules.dart';

class ShopController extends ChangeNotifier {
  ShopController(this.api);

  final CashierApi api;
  String url = '';
  String pin = '';
  Map<String, dynamic> fx = {};
  String status = '';
  bool busy = false;
  int alarmMinutes = 20;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    url = prefs.getString('webAppUrl') ?? '';
    alarmMinutes = prefs.getInt('alarmMinutes') ?? 20;
    notifyListeners();
  }

  Future<void> saveUrl(String value) async {
    url = value.trim();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('webAppUrl', url);
    notifyListeners();
  }

  Future<void> saveAlarm(int minutes) async {
    alarmMinutes = minutes.clamp(1, 180);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('alarmMinutes', alarmMinutes);
    notifyListeners();
  }

  void setPin(String value) {
    pin = value.trim();
    notifyListeners();
  }

  Future<ApiResult> call(
    String action,
    Map<String, dynamic> payload, {
    bool write = false,
    String? key,
  }) async {
    busy = true;
    notifyListeners();
    final result = await api.post(
      webAppUrl: url,
      action: action,
      pin: pin,
      idempotencyKey: write ? (key ?? newIdempotencyKey()) : '',
      payload: payload,
    );
    if (action == 'fx.get' && result.success) fx = result.data;
    status = result.message;
    busy = false;
    notifyListeners();
    return result;
  }
}

class MrRobotApp extends StatelessWidget {
  const MrRobotApp({super.key, required this.controller});

  final ShopController controller;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'كاشير مستر روبوت',
      debugShowCheckedModeBanner: false,
      locale: const Locale('ar'),
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF120F2A),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF41F0E0),
          surface: Color(0xFF1C1840),
          error: Color(0xFFFF4D5E),
        ),
        cardTheme: const CardThemeData(color: Color(0xFF1C1840)),
        inputDecorationTheme: const InputDecorationTheme(
          filled: true,
          fillColor: Color(0xFF120F2A),
          border: OutlineInputBorder(),
        ),
      ),
      builder: (context, child) => Directionality(
        textDirection: TextDirection.rtl,
        child: child ?? const SizedBox.shrink(),
      ),
      home: ShopShell(controller: controller),
    );
  }
}

class ShopShell extends StatefulWidget {
  const ShopShell({super.key, required this.controller});

  final ShopController controller;

  @override
  State<ShopShell> createState() => _ShopShellState();
}

class _ShopShellState extends State<ShopShell> {
  int index = 0;

  @override
  void initState() {
    super.initState();
    widget.controller.load();
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      SaleScreen(controller: widget.controller),
      WalletsScreen(controller: widget.controller),
      PocketsScreen(controller: widget.controller),
      DayScreen(controller: widget.controller),
      PrayerScreen(controller: widget.controller),
      ConnectScreen(controller: widget.controller),
    ];
    const labels = ['بيع', 'محافظ', 'جيوب', 'اليوم', 'صلاة', 'ربط'];
    final wide = MediaQuery.sizeOf(context).width >= 900;
    return Scaffold(
      appBar: AppBar(
        title: const Text('كاشير مستر روبوت'),
        actions: [
          if (widget.controller.busy) const Padding(padding: EdgeInsets.all(16), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
        ],
      ),
      body: Row(
        children: [
          if (wide)
            NavigationRail(
              selectedIndex: index,
              onDestinationSelected: (v) => setState(() => index = v),
              labelType: NavigationRailLabelType.all,
              destinations: [
                for (final label in labels) NavigationRailDestination(icon: const Icon(Icons.circle_outlined), label: Text(label)),
              ],
            ),
          Expanded(child: pages[index]),
        ],
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: index,
              onDestinationSelected: (v) => setState(() => index = v),
              destinations: [
                for (final label in labels) NavigationDestination(icon: const Icon(Icons.circle_outlined), label: label),
              ],
            ),
    );
  }
}

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key, required this.controller});
  final ShopController controller;
  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  late final url = TextEditingController(text: widget.controller.url);
  late final pin = TextEditingController();
  String note = '';

  @override
  void dispose() {
    url.dispose();
    pin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Image.asset('assets/mr-robot-logo.png', height: 72),
        const SizedBox(height: 12),
        const Text('حط رابط الويب آب والرقم السري. الرقم ما ينحط جوا البرنامج، بينكتب هون كل مرة تفتح.'),
        const SizedBox(height: 12),
        TextField(controller: url, decoration: const InputDecoration(labelText: 'رابط الويب آب'), textDirection: TextDirection.ltr),
        const SizedBox(height: 8),
        TextField(controller: pin, obscureText: true, decoration: const InputDecoration(labelText: 'الرقم السري'), keyboardType: TextInputType.number),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: () async {
            await widget.controller.saveUrl(url.text);
            widget.controller.setPin(pin.text);
            final ping = await widget.controller.call('ping', {});
            final fx = ping.success ? await widget.controller.call('fx.get', {}) : null;
            setState(() {
              note = ping.success
                  ? 'اتصل. شراء ${fx?.data['buy'] ?? '—'} · مبيع ${fx?.data['sell'] ?? '—'} · وسطي ${fx?.data['mid'] ?? '—'}'
                  : ping.message;
            });
          },
          child: const Text('جرّب الاتصال'),
        ),
        if (note.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(note)),
      ],
    );
  }
}

class SaleScreen extends StatefulWidget {
  const SaleScreen({super.key, required this.controller});
  final ShopController controller;
  @override
  State<SaleScreen> createState() => _SaleScreenState();
}

class _SaleScreenState extends State<SaleScreen> {
  final barcode = TextEditingController();
  final qty = TextEditingController(text: '1');
  final phone = TextEditingController();
  final paidSp = TextEditingController();
  final paidUsd = TextEditingController();
  final shamSp = TextEditingController();
  final shamUsd = TextEditingController();
  String currency = 'SP';
  String note = '';
  String? lastKey;
  bool confirmCost = false;

  @override
  void dispose() {
    barcode.dispose();
    qty.dispose();
    phone.dispose();
    paidSp.dispose();
    paidUsd.dispose();
    shamSp.dispose();
    shamUsd.dispose();
    super.dispose();
  }

  Map<String, dynamic> tender() => {
        'paidSp': num.tryParse(paidSp.text) ?? 0,
        'paidUsd': num.tryParse(paidUsd.text) ?? 0,
        'shamSp': num.tryParse(shamSp.text) ?? 0,
        'shamUsd': num.tryParse(shamUsd.text) ?? 0,
      };

  Future<void> sell() async {
    lastKey ??= newIdempotencyKey();
    final result = await widget.controller.call('sale.scan', {
      'barcode': barcode.text.trim(),
      'mode': 'sale',
      'qty': num.tryParse(qty.text) ?? 1,
      'currency': currency,
      'buyerPhone': phone.text.trim(),
      'fxRate': widget.controller.fx['mid'] ?? 0,
      'tender': tender(),
      'confirmBelowCost': confirmCost,
      'confirmPriceAlert': confirmCost,
    }, write: true, key: lastKey);
    setState(() => note = result.message.isEmpty ? (result.success ? 'انسجلت' : 'ما انسجلت') : result.message);
    if (result.needsConfirm) {
      setState(() => confirmCost = true);
      return;
    }
    if (result.success) {
      lastKey = null;
      barcode.clear();
      setState(() => confirmCost = false);
    }
  }

  Future<void> whatsApp() async {
    final digits = phone.text.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 8) {
      setState(() => note = 'اكتب رقم الزبون قبل الواتساب.');
      return;
    }
    final uri = Uri.parse('https://wa.me/$digits');
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        TextField(
          controller: barcode,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'الباركود'),
          textDirection: TextDirection.ltr,
          onSubmitted: (_) => sell(),
        ),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: TextField(controller: qty, decoration: const InputDecoration(labelText: 'العدد'), keyboardType: TextInputType.number)),
          const SizedBox(width: 8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'SP', label: Text('ليرة')),
              ButtonSegment(value: 'USD', label: Text('دولار')),
            ],
            selected: {currency},
            onSelectionChanged: (v) => setState(() => currency = v.first),
          ),
        ]),
        const SizedBox(height: 8),
        const Text('الدفع، ممكن يتقسّم'),
        TextField(controller: paidSp, decoration: const InputDecoration(labelText: 'كاش ليرة'), keyboardType: TextInputType.number),
        TextField(controller: paidUsd, decoration: const InputDecoration(labelText: 'كاش دولار'), keyboardType: TextInputType.number),
        TextField(controller: shamSp, decoration: const InputDecoration(labelText: 'شام ليرة'), keyboardType: TextInputType.number),
        TextField(controller: shamUsd, decoration: const InputDecoration(labelText: 'شام دولار'), keyboardType: TextInputType.number),
        TextField(controller: phone, decoration: const InputDecoration(labelText: 'رقم الزبون للواتساب'), keyboardType: TextInputType.phone),
        const SizedBox(height: 12),
        FilledButton(onPressed: sell, child: Text(confirmCost ? 'كمّل رغم التنبيه' : 'سجّل البيع')),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: whatsApp, child: const Text('واتساب للزبون')),
        if (note.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(note)),
      ],
    );
  }
}

class WalletsScreen extends StatefulWidget {
  const WalletsScreen({super.key, required this.controller});
  final ShopController controller;
  @override
  State<WalletsScreen> createState() => _WalletsScreenState();
}

class _WalletsScreenState extends State<WalletsScreen> {
  String wallet = 'sham';
  String direction = 'SEND';
  String mode = 'top';
  final amount = TextEditingController();
  final fee = TextEditingController();
  final paidSp = TextEditingController();
  final paidUsd = TextEditingController();
  String note = '';
  String? key;

  @override
  void dispose() {
    amount.dispose();
    fee.dispose();
    paidSp.dispose();
    paidUsd.dispose();
    super.dispose();
  }

  double previewFee() {
    final base = num.tryParse(amount.text) ?? 0;
    final typed = num.tryParse(fee.text);
    final pct = wallet == 'mega' ? MoneyRules.megaFeePct() : MoneyRules.shamTierPct(base);
    return MoneyRules.feeAmount(base: base, currency: 'SP', pct: pct, typedFee: typed);
  }

  Future<void> post() async {
    final mid = widget.controller.fx['mid'];
    key ??= newIdempotencyKey();
    final hands = MoneyRules.customerHands(
      direction: direction,
      mode: mode,
      amount: num.tryParse(amount.text) ?? 0,
      fee: previewFee(),
    );
    final ApiResult result;
    if (wallet == 'sham') {
      result = await widget.controller.call('sham.post', {
        'transfer': num.tryParse(amount.text) ?? 0,
        'currency': 'SP',
        'commission': direction == 'BILL' ? (num.tryParse(fee.text) ?? 0) : previewFee(),
        'txDirection': direction,
        'feeMode': mode == 'deduct' ? 'DEDUCT' : (mode == 'sep' ? 'SEPARATE' : 'ABOVE'),
        'fxRate': mid ?? 0,
        'tender': {'paidSp': num.tryParse(paidSp.text) ?? 0, 'paidUsd': num.tryParse(paidUsd.text) ?? 0},
      }, write: true, key: key);
    } else if (wallet == 'mega') {
      result = await widget.controller.call('mega.post', {
        'txDirection': direction == 'RECEIVE' ? 'RECEIVE' : 'SEND',
        'paidCurrency': 'SP',
        'fxRate': mid ?? 0,
        'items': [
          {'base': num.tryParse(amount.text) ?? 0, 'fee': previewFee()}
        ],
        'tender': {'paidSp': num.tryParse(paidSp.text) ?? 0, 'paidUsd': num.tryParse(paidUsd.text) ?? 0},
      }, write: true, key: key);
    } else {
      result = await widget.controller.call('usdt.post', {
        'amount': num.tryParse(amount.text) ?? 0,
        'txDirection': direction == 'RECEIVE' ? 'RECEIVE' : 'SEND',
        'paidCurrency': 'USD',
        'commission': previewFee(),
        'fxRate': mid ?? 0,
        'tender': {'paidSp': num.tryParse(paidSp.text) ?? 0, 'paidUsd': num.tryParse(paidUsd.text) ?? 0},
      }, write: true, key: key);
    }
    setState(() => note = '${result.message.isEmpty ? (result.success ? 'انسجلت' : 'ما انسجلت') : result.message}\nالمطلوب من الزبون: ${formatMoney(hands, 'SP')}');
    if (result.success) key = null;
  }

  @override
  Widget build(BuildContext context) {
    final feeValue = previewFee();
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'sham', label: Text('شام')),
            ButtonSegment(value: 'mega', label: Text('ميجا')),
            ButtonSegment(value: 'usdt', label: Text('USDT')),
          ],
          selected: {wallet},
          onSelectionChanged: (v) => setState(() => wallet = v.first),
        ),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: [
            const ButtonSegment(value: 'SEND', label: Text('إرسال')),
            const ButtonSegment(value: 'RECEIVE', label: Text('استقبال')),
            if (wallet == 'sham') const ButtonSegment(value: 'BILL', label: Text('فاتورة')),
          ],
          selected: {direction},
          onSelectionChanged: (v) => setState(() => direction = v.first),
        ),
        if (wallet == 'sham' && direction != 'BILL')
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'top', label: Text('فوق')),
                ButtonSegment(value: 'deduct', label: Text('ناقص')),
                ButtonSegment(value: 'sep', label: Text('لحال')),
              ],
              selected: {mode},
              onSelectionChanged: (v) => setState(() => mode = v.first),
            ),
          ),
        TextField(
          controller: amount,
          decoration: const InputDecoration(labelText: 'المبلغ'),
          keyboardType: TextInputType.number,
          onChanged: (_) => setState(() {}),
        ),
        TextField(
          controller: fee,
          decoration: InputDecoration(labelText: 'العمولة (فاضية = ${wallet == 'mega' ? '٢٠٪' : 'الشرائح'})'),
          keyboardType: TextInputType.number,
          onChanged: (_) => setState(() {}),
        ),
        Text('العمولة الظاهرة: ${formatMoney(feeValue, wallet == 'usdt' ? 'USD' : 'SP')}'),
        TextField(controller: paidSp, decoration: const InputDecoration(labelText: 'كاش ليرة'), keyboardType: TextInputType.number),
        TextField(controller: paidUsd, decoration: const InputDecoration(labelText: 'كاش دولار'), keyboardType: TextInputType.number),
        const SizedBox(height: 12),
        FilledButton(onPressed: post, child: const Text('سجّل')),
        if (note.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(note)),
      ],
    );
  }
}

class PocketsScreen extends StatefulWidget {
  const PocketsScreen({super.key, required this.controller});
  final ShopController controller;
  @override
  State<PocketsScreen> createState() => _PocketsScreenState();
}

class _PocketsScreenState extends State<PocketsScreen> {
  String type = 'sale';
  String mode = 'deduct';
  final amount = TextEditingController();
  final price = TextEditingController();
  final paySp = TextEditingController();
  final fee = TextEditingController();
  String preview = '';
  bool ok = false;
  Map<String, dynamic>? excess;
  Map<String, dynamic>? lastInp;
  String? key;

  @override
  void dispose() {
    amount.dispose();
    price.dispose();
    paySp.dispose();
    fee.dispose();
    super.dispose();
  }

  Map<String, dynamic> form() {
    return {
      'type': type,
      'amount': num.tryParse(amount.text) ?? 0,
      'price': num.tryParse(price.text) ?? 0,
      'cur': 'SP',
      'mode': mode,
      if (fee.text.trim().isNotEmpty) 'fee': num.tryParse(fee.text) ?? 0,
      'pay': [
        {'src': 'CASH_SP', 'amt': num.tryParse(paySp.text) ?? 0}
      ],
    };
  }

  Future<void> runPreview() async {
    final result = await widget.controller.call('pockets.preview', {'inp': form()});
    final op = result.data['op'];
    final map = op is Map ? Map<String, dynamic>.from(op) : <String, dynamic>{};
    final lines = result.data['lines'];
    setState(() {
      ok = map['ok'] == true;
      excess = result.data['excess'] is Map ? Map<String, dynamic>.from(result.data['excess'] as Map) : null;
      lastInp = form();
      preview = [
        if (lines is List) ...lines.map((e) => '$e'),
        if ((map['balanceMsg'] ?? '').toString().isNotEmpty) map['balanceMsg'],
        if (map['summary'] != null) map['summary'],
        result.message,
      ].where((s) => s.toString().isNotEmpty).join('\n');
    });
  }

  Future<void> save() async {
    if (!ok) return;
    key ??= newIdempotencyKey();
    final result = await widget.controller.call('pockets.post', {
      'inp': lastInp ?? form(),
      'opId': key,
    }, write: true, key: key);
    setState(() => preview = result.success ? 'انحفظت' : result.message);
    if (result.success) key = null;
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DropdownButton<String>(
          value: type,
          items: const [
            DropdownMenuItem(value: 'sale', child: Text('بيع')),
            DropdownMenuItem(value: 'sham_send', child: Text('إرسال شام')),
            DropdownMenuItem(value: 'sham_recv', child: Text('استقبال شام')),
            DropdownMenuItem(value: 'mega', child: Text('ميجا')),
            DropdownMenuItem(value: 'expense', child: Text('مصروف')),
          ],
          onChanged: (v) => setState(() => type = v ?? 'sale'),
        ),
        TextField(controller: price, decoration: const InputDecoration(labelText: 'السعر'), keyboardType: TextInputType.number),
        TextField(controller: amount, decoration: const InputDecoration(labelText: 'المبلغ'), keyboardType: TextInputType.number),
        TextField(controller: fee, decoration: const InputDecoration(labelText: 'العمولة، فاضية يعني الشرائح'), keyboardType: TextInputType.number),
        TextField(controller: paySp, decoration: const InputDecoration(labelText: 'الزبون دفع كاش ليرة'), keyboardType: TextInputType.number),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'top', label: Text('فوق')),
            ButtonSegment(value: 'deduct', label: Text('ناقص')),
            ButtonSegment(value: 'sep', label: Text('لحال')),
          ],
          selected: {mode},
          onSelectionChanged: (v) => setState(() => mode = v.first),
        ),
        const SizedBox(height: 8),
        FilledButton(onPressed: runPreview, child: const Text('معاينة')),
        if (excess != null)
          OutlinedButton(
            onPressed: () {
              fee.text = '${excess!['fee']}';
              runPreview();
            },
            child: Text('الزيادة عمولة (+${excess!['add']})'),
          ),
        FilledButton(onPressed: ok ? save : null, child: const Text('حفظ')),
        if (preview.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(preview)),
      ],
    );
  }
}

class DayScreen extends StatefulWidget {
  const DayScreen({super.key, required this.controller});
  final ShopController controller;
  @override
  State<DayScreen> createState() => _DayScreenState();
}

class _DayScreenState extends State<DayScreen> {
  final fields = <String, TextEditingController>{
    'cashSp': TextEditingController(),
    'cashUsd': TextEditingController(),
    'shamSp': TextEditingController(),
    'shamUsd': TextEditingController(),
    'mega': TextEditingController(),
    'usdt': TextEditingController(),
    'extExp': TextEditingController(),
  };
  final counted = <String, TextEditingController>{
    'cashSp': TextEditingController(),
    'cashUsd': TextEditingController(),
    'shamSp': TextEditingController(),
    'shamUsd': TextEditingController(),
    'mega': TextEditingController(),
    'usdt': TextEditingController(),
    'extExp': TextEditingController(),
  };
  Map<String, dynamic> book = {};
  String note = '';

  static const labels = {
    'cashSp': 'كاش ليرة',
    'cashUsd': 'كاش دولار',
    'shamSp': 'شام ليرة',
    'shamUsd': 'شام دولار',
    'mega': 'ميجا',
    'usdt': 'USDT',
    'extExp': 'مصاريف',
  };

  @override
  void initState() {
    super.initState();
    for (final c in counted.values) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final c in fields.values) {
      c.dispose();
    }
    for (final c in counted.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> saveMorning() async {
    final payload = {
      for (final e in fields.entries) e.key: num.tryParse(e.value.text) ?? 0,
    };
    final result = await widget.controller.call('opening.save', payload, write: true);
    setState(() => note = result.success ? 'انحفظ صباح اليوم. ما في ترحيل من مبارح.' : result.message);
  }

  Future<void> loadZ() async {
    final result = await widget.controller.call('z.stats', {});
    setState(() {
      book = result.data;
      note = result.success ? 'الدفتر = الصبح + حركات اليوم' : result.message;
    });
  }

  Future<void> copyCsv() async {
    final rows = <List<String>>[
      ['الجيب', 'الدفتر', 'العد', 'الفرق'],
      for (final key in labels.keys)
        [
          labels[key]!,
          '${_bookValue(key)}',
          counted[key]!.text,
          '${(num.tryParse(counted[key]!.text) ?? 0) - _bookValue(key)}',
        ],
    ];
    await Clipboard.setData(ClipboardData(text: pocketsCsv(rows)));
    setState(() => note = 'اننسخ جدول Excel. الصقه بملف.');
  }

  num _bookValue(String key) {
    final books = book['books'];
    if (books is Map && books[key] != null) return num.tryParse('${books[key]}') ?? 0;
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('أرصدة الصبح، تنكتب باليد. ما بتنتقل من مبارح.'),
        for (final key in labels.keys)
          TextField(controller: fields[key], decoration: InputDecoration(labelText: 'صبح ${labels[key]}'), keyboardType: TextInputType.number),
        const SizedBox(height: 8),
        FilledButton(onPressed: saveMorning, child: const Text('احفظ الصبح')),
        OutlinedButton(onPressed: loadZ, child: const Text('جيب الدفتر')),
        const SizedBox(height: 8),
        for (final key in labels.keys)
          _DiffRow(label: labels[key]!, book: _bookValue(key), counted: counted[key]!),
        TextButton(onPressed: copyCsv, child: const Text('انسخ Excel')),
        if (note.isNotEmpty) Text(note),
      ],
    );
  }
}

class _DiffRow extends StatelessWidget {
  const _DiffRow({required this.label, required this.book, required this.counted});
  final String label;
  final num book;
  final TextEditingController counted;

  @override
  Widget build(BuildContext context) {
    final count = num.tryParse(counted.text) ?? 0;
    final gap = counted.text.isEmpty ? 0 : count - book;
    final tone = MoneyRules.diffTone(counted.text.isEmpty ? 0 : gap);
    final color = switch (tone) {
      DiffTone.over => const Color(0xFF7CB7FF),
      DiffTone.short => const Color(0xFFFF4D5E),
      DiffTone.even => const Color(0xFF3DDC97),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          Expanded(child: Text('الدفتر $book')),
          SizedBox(width: 90, child: TextField(controller: counted, decoration: const InputDecoration(labelText: 'العد'), keyboardType: TextInputType.number)),
          const SizedBox(width: 8),
          Text(counted.text.isEmpty ? '' : '$gap', style: TextStyle(color: color, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class PrayerScreen extends StatefulWidget {
  const PrayerScreen({super.key, required this.controller});
  final ShopController controller;
  @override
  State<PrayerScreen> createState() => _PrayerScreenState();
}

class _PrayerScreenState extends State<PrayerScreen> {
  late final minutes = TextEditingController(text: '${widget.controller.alarmMinutes}');

  @override
  void dispose() {
    minutes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now().toUtc().add(const Duration(hours: 3));
    final table = PrayerTimes.minutesOn(now.year, now.month, now.day);
    final lead = int.tryParse(minutes.text) ?? 20;
    final alarm = PrayerTimes.nextAlarm(now, minutesBefore: lead);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text('مواقيت دمشق. المنبه القوي قبل الأذان، والافتراضي ٢٠ دقيقة.'),
        for (final name in PrayerTimes.names)
          ListTile(title: Text(name.$2), trailing: Text(PrayerTimes.hhmm(table[name.$1] ?? 0))),
        TextField(
          controller: minutes,
          decoration: const InputDecoration(labelText: 'دقائق المنبه القوي'),
          keyboardType: TextInputType.number,
          onChanged: (v) {
            final n = int.tryParse(v);
            if (n != null) widget.controller.saveAlarm(n);
            setState(() {});
          },
        ),
        Text('الجرس الجاي: ${alarm.hour.toString().padLeft(2, '0')}:${alarm.minute.toString().padLeft(2, '0')} بتوقيت دمشق'),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () {
            showDialog<void>(
              context: context,
              builder: (context) => AlertDialog(
                title: const Text('منبه التجربة'),
                content: Text('قوم صلّي. الجرس الحقيقي بيضل قبل الأذان بـ $lead دقيقة، حتى لو التطبيق بالخلفية بعد ما يتبني على الجهاز.'),
                actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('تمام'))],
              ),
            );
          },
          child: const Text('جرّب المنبه'),
        ),
      ],
    );
  }
}
