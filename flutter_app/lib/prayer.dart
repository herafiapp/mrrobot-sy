import 'dart:math' as math;

/// Damascus prayer times. Same compact PrayTimes math as the cashier page.
class PrayerTimes {
  static const lat = 33.5138;
  static const lng = 36.2765;
  static const tz = 3.0;
  static const fajrAngle = 19.5;
  static const ishaAngle = 17.5;

  static const names = <(String, String)>[
    ('fajr', 'الفجر'),
    ('sunrise', 'الشروق'),
    ('dhuhr', 'الظهر'),
    ('asr', 'العصر'),
    ('maghrib', 'المغرب'),
    ('isha', 'العشاء'),
  ];

  /// Minutes after local midnight for one civil date.
  static Map<String, int> minutesOn(int year, int month, int day) {
    final jd = _julian(year, month, day) - lng / (15 * 24);
    var t = <String, double>{
      'fajr': 5,
      'sunrise': 6,
      'dhuhr': 12,
      'asr': 13,
      'maghrib': 18,
      'isha': 18,
    };
    for (var i = 0; i < 2; i++) {
      final f = {for (final e in t.entries) e.key: e.value / 24};
      t = {
        'fajr': _sunAngle(jd, fajrAngle, f['fajr']!, ccw: true),
        'sunrise': _sunAngle(jd, 0.833, f['sunrise']!, ccw: true),
        'dhuhr': _midDay(jd, f['dhuhr']!),
        'asr': _asr(jd, 1, f['asr']!),
        'maghrib': _sunAngle(jd, 0.833, f['maghrib']!),
        'isha': _sunAngle(jd, ishaAngle, f['isha']!),
      };
    }
    return {
      for (final e in t.entries)
        e.key: ((e.value + tz - lng / 15) * 60).round(),
    };
  }

  /// Fire time of the strong alarm: [minutesBefore] before the next adhan.
  /// Sunrise is never the next prayer.
  static DateTime nextAlarm(DateTime damascusNow, {int minutesBefore = 20}) {
    final lead = minutesBefore.clamp(1, 180);
    final today = minutesOn(damascusNow.year, damascusNow.month, damascusNow.day);
    final tomorrowDate = DateTime(damascusNow.year, damascusNow.month, damascusNow.day)
        .add(const Duration(days: 1));
    final tomorrow = minutesOn(tomorrowDate.year, tomorrowDate.month, tomorrowDate.day);
    final nowMin = damascusNow.hour * 60 + damascusNow.minute;
    const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    for (final name in order) {
      final at = today[name]!;
      if (at > nowMin) {
        return DateTime(damascusNow.year, damascusNow.month, damascusNow.day)
            .add(Duration(minutes: at - lead));
      }
    }
    final fajr = tomorrow['fajr']!;
    return DateTime(tomorrowDate.year, tomorrowDate.month, tomorrowDate.day)
        .add(Duration(minutes: fajr - lead));
  }

  static String hhmm(int minutes) {
    final m = ((minutes % 1440) + 1440) % 1440;
    final h = m ~/ 60;
    final min = m % 60;
    return '${h.toString().padLeft(2, '0')}:${min.toString().padLeft(2, '0')}';
  }

  static double _julian(int year, int month, int day) {
    var y = year;
    var m = month;
    if (m <= 2) {
      y -= 1;
      m += 12;
    }
    final a = (y / 100).floor();
    final b = 2 - a + (a / 4).floor();
    return (365.25 * (y + 4716)).floor() + (30.6001 * (m + 1)).floor() + day + b - 1524.5;
  }

  static double _sin(double deg) => math.sin(deg * math.pi / 180);
  static double _cos(double deg) => math.cos(deg * math.pi / 180);
  static double _tan(double deg) => math.tan(deg * math.pi / 180);
  static double _asin(double x) => math.asin(x) * 180 / math.pi;
  static double _acos(double x) => math.acos(x.clamp(-1.0, 1.0)) * 180 / math.pi;
  static double _atan2(double y, double x) => math.atan2(y, x) * 180 / math.pi;
  static double _acot(double x) => math.atan(1 / x) * 180 / math.pi;

  static double _fix(double a, double b) {
    var v = a - b * (a / b).floor();
    if (v < 0) v += b;
    return v;
  }

  static ({double decl, double eqt}) _sun(double jd) {
    final dd = jd - 2451545.0;
    final g = _fix(357.529 + 0.98560028 * dd, 360);
    final q = _fix(280.459 + 0.98564736 * dd, 360);
    final l = _fix(q + 1.915 * _sin(g) + 0.020 * _sin(2 * g), 360);
    final e = 23.439 - 0.00000036 * dd;
    final ra = _atan2(_cos(e) * _sin(l), _cos(l)) / 15;
    return (decl: _asin(_sin(e) * _sin(l)), eqt: q / 15 - _fix(ra, 24));
  }

  static double _midDay(double jd, double t) => _fix(12 - _sun(jd + t).eqt, 24);

  static double _sunAngle(double jd, double angle, double t, {bool ccw = false}) {
    final p = _sun(jd + t);
    final noon = _midDay(jd, t);
    final x = (-_sin(angle) - _sin(p.decl) * _sin(lat)) / (_cos(p.decl) * _cos(lat));
    final h = _acos(x) / 15;
    return noon + (ccw ? -h : h);
  }

  static double _asr(double jd, double factor, double t) {
    final decl = _sun(jd + t).decl;
    return _sunAngle(jd, -_acot(factor + _tan((lat - decl).abs())), t);
  }
}
