/// Shop money rules shared by the screens. The server rebuilds the same
/// operation and is the one that writes. These numbers are the preview.
class MoneyRules {
  static const shamTiers = <(int, double)>[
    (400000, 3),
    (700000, 2.5),
    (1000000, 2),
  ];

  /// 3% under 400,000 · 2.5% under 700,000 · 2% under 1,000,000 · 1.5% after.
  static double shamTierPct(num spEquivalent) {
    final a = spEquivalent.abs();
    if (a < 400000) return 3;
    if (a < 700000) return 2.5;
    if (a < 1000000) return 2;
    return 1.5;
  }

  static double megaFeePct() => 20;

  /// Nearest whole unit for SYP, 2 decimals for dollars.
  static double roundMoney(num amount, String currency) {
    if (currency == 'USD') {
      return (amount * 100).roundToDouble() / 100;
    }
    return amount.roundToDouble();
  }

  static double feeAmount({
    required num base,
    required String currency,
    required double pct,
    num? typedFee,
  }) {
    if (typedFee != null) return roundMoney(typedFee, currency);
    return roundMoney(base * pct / 100, currency);
  }

  /// What the customer hands the shop, in the wallet currency.
  /// Send فوق / لحال = T+C. Send ناقص = T. Receive = we hand T−C.
  /// A bill is the bill plus a fee only when a fee was typed.
  static double customerHands({
    required String direction,
    required String mode,
    required num amount,
    required num fee,
  }) {
    final t = amount.abs();
    final c = fee.abs();
    final dir = direction.toUpperCase();
    final m = mode.toLowerCase();
    if (dir == 'BILL') return roundMoney(t + c, 'SP');
    if (dir == 'RECEIVE') return roundMoney(t - c, 'SP');
    if (m == 'deduct' || m == 'ناقص') return roundMoney(t, 'SP');
    return roundMoney(t + c, 'SP');
  }

  /// A gap under 1,000 SP is تدوير and does not block the save.
  static bool blocksOnGap(num residualSp) => residualSp.abs() >= 1000;

  static bool isRounding(num residualSp) {
    final a = residualSp.abs();
    return a >= 1 && a < 1000;
  }

  /// Extra the customer paid can become fee. Returns the added fee, or null.
  static double? excessToFee({
    required num fee,
    required num overpaySp,
    required String currency,
    required bool gaveChange,
  }) {
    if (gaveChange || overpaySp <= 0) return null;
    return roundMoney(overpaySp, currency);
  }

  /// Client rate versus the saved mid. The server rejects above 0.5.
  static double? fxDrift(num clientRate, num savedMid) {
    if (clientRate <= 0 || savedMid <= 0) return null;
    return (clientRate - savedMid).abs() / savedMid;
  }

  static bool fxRejected(num clientRate, num savedMid) {
    final drift = fxDrift(clientRate, savedMid);
    return drift != null && drift > 0.5;
  }

  /// Blue when the count is over the book, red when short, green on zero.
  static DiffTone diffTone(num countedMinusBook) {
    if (countedMinusBook == 0) return DiffTone.even;
    if (countedMinusBook > 0) return DiffTone.over;
    return DiffTone.short;
  }
}

enum DiffTone { over, short, even }

String formatMoney(num value, String currency) {
  final neg = value < 0;
  final abs = value.abs();
  final text = currency == 'USD'
      ? abs.toStringAsFixed(2)
      : abs.round().toString();
  final parts = text.split('.');
  final digits = parts[0];
  final grouped = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) grouped.write(',');
    grouped.write(digits[i]);
  }
  if (parts.length > 1) grouped.write('.${parts[1]}');
  final unit = currency == 'USD' ? r'$' : 'ل.س';
  return '${neg ? '−' : ''}$grouped $unit';
}

String csvCell(String value) {
  final clean = value.replaceAll('"', '""');
  if (clean.contains(',') || clean.contains('"') || clean.contains('\n')) {
    return '"$clean"';
  }
  return clean;
}

/// Spreadsheet the owner can paste into Excel.
String pocketsCsv(List<List<String>> rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}
