import 'package:flutter_test/flutter_test.dart';
import 'package:mrrobot_cashier/rules.dart';

void main() {
  test('sham tiers match the shop table', () {
    expect(MoneyRules.shamTierPct(100000), 3);
    expect(MoneyRules.shamTierPct(399999), 3);
    expect(MoneyRules.shamTierPct(400000), 2.5);
    expect(MoneyRules.shamTierPct(700000), 2);
    expect(MoneyRules.shamTierPct(1000000), 1.5);
    expect(MoneyRules.feeAmount(base: 1000000, currency: 'SP', pct: 1.5), 15000);
  });

  test('mega is 20 percent on top of the charge', () {
    final fee = MoneyRules.feeAmount(base: 10000, currency: 'SP', pct: MoneyRules.megaFeePct());
    expect(fee, 2000);
    expect(
      MoneyRules.customerHands(direction: 'SEND', mode: 'top', amount: 10000, fee: fee),
      12000,
    );
  });

  test('fee modes change what the customer hands over', () {
    expect(MoneyRules.customerHands(direction: 'SEND', mode: 'top', amount: 100000, fee: 3000), 103000);
    expect(MoneyRules.customerHands(direction: 'SEND', mode: 'sep', amount: 100000, fee: 3000), 103000);
    expect(MoneyRules.customerHands(direction: 'SEND', mode: 'deduct', amount: 100000, fee: 3000), 100000);
    expect(MoneyRules.customerHands(direction: 'RECEIVE', mode: 'top', amount: 100000, fee: 3000), 97000);
    expect(MoneyRules.customerHands(direction: 'BILL', mode: 'top', amount: 25000, fee: 0), 25000);
  });

  test('a gap under 1000 is rounding and does not block', () {
    expect(MoneyRules.blocksOnGap(150), isFalse);
    expect(MoneyRules.isRounding(150), isTrue);
    expect(MoneyRules.blocksOnGap(1000), isTrue);
    expect(MoneyRules.excessToFee(fee: 8000, overpaySp: 2000, currency: 'SP', gaveChange: false), 2000);
    expect(MoneyRules.excessToFee(fee: 8000, overpaySp: 2000, currency: 'SP', gaveChange: true), isNull);
  });

  test('a rate more than half away from the saved mid is rejected', () {
    expect(MoneyRules.fxRejected(16000, 10000), isTrue);
    expect(MoneyRules.fxRejected(14000, 10000), isFalse);
    expect(MoneyRules.diffTone(0), DiffTone.even);
    expect(MoneyRules.diffTone(5), DiffTone.over);
    expect(MoneyRules.diffTone(-1), DiffTone.short);
  });

  test('excel cells quote commas', () {
    expect(pocketsCsv([
      ['جيب', 'ملاحظة'],
      ['كاش', 'في, فرق'],
    ]), 'جيب,ملاحظة\nكاش,"في, فرق"');
  });
}
