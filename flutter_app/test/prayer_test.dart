import 'package:flutter_test/flutter_test.dart';
import 'package:mrrobot_cashier/prayer.dart';

void main() {
  test('Damascus 6 Oct 2026 matches the cashier table', () {
    final t = PrayerTimes.minutesOn(2026, 10, 6);
    expect(PrayerTimes.hhmm(t['fajr']!), '05:03');
    expect(PrayerTimes.hhmm(t['sunrise']!), '06:33');
    expect(PrayerTimes.hhmm(t['dhuhr']!), '12:23');
    expect(PrayerTimes.hhmm(t['asr']!), '15:42');
    expect(PrayerTimes.hhmm(t['maghrib']!), '18:13');
    expect(PrayerTimes.hhmm(t['isha']!), '19:33');
  });

  test('the strong alarm is 20 minutes before the next adhan', () {
    final now = DateTime(2026, 10, 6, 15, 0);
    final alarm = PrayerTimes.nextAlarm(now, minutesBefore: 20);
    expect(alarm, DateTime(2026, 10, 6, 15, 22));
  });
}
