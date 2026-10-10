import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mrrobot_cashier/api.dart';
import 'package:mrrobot_cashier/ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('a redirect keeps the JSON body', () async {
    final client = MockClient((request) async {
      if (request.url.path == '/exec') {
        return http.Response('', 302, headers: {'location': 'https://script.google.com/done'});
      }
      expect(jsonDecode(request.body)['action'], 'ping');
      return http.Response(jsonEncode({'success': true, 'code': 'ok', 'message': '', 'data': {'api': 'v89-native'}}), 200);
    });
    final api = CashierApi(client: client);
    final result = await api.post(webAppUrl: 'https://script.google.com/exec', action: 'ping');
    expect(result.success, isTrue);
    expect(result.data['api'], 'v89-native');
    api.close();
  });

  testWidgets('the cashier opens in Arabic on the sale desk', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final client = MockClient((request) async {
      return http.Response(jsonEncode({'success': true, 'code': 'ok', 'message': 'تمام', 'data': {}}), 200);
    });
    await tester.pumpWidget(MrRobotApp(controller: ShopController(CashierApi(client: client))));
    await tester.pump();
    expect(find.text('كاشير مستر روبوت'), findsOneWidget);
    expect(find.text('الباركود'), findsOneWidget);
    expect(Directionality.of(tester.element(find.text('الباركود'))), TextDirection.rtl);
  });
}
