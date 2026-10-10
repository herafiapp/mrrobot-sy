import 'dart:convert';

import 'package:http/http.dart' as http;

/// Actions the app may send. Kept in lockstep with apps-script/NativeApi.js.
const kApiActions = [
  'ping',
  'fx.get',
  'fx.refresh',
  'sale.scan',
  'sham.post',
  'mega.post',
  'usdt.post',
  'pockets.preview',
  'pockets.post',
  'pockets.book',
  'opening.save',
  'z.stats',
  'z.close',
  'invoice.get',
  'request.lookup',
];

class ApiResult {
  const ApiResult({
    required this.success,
    required this.code,
    required this.message,
    required this.data,
  });

  final bool success;
  final String code;
  final String message;
  final Map<String, dynamic> data;

  bool get needsConfirm => code == 'needs_confirm' || data['needsConfirm'] == true;

  factory ApiResult.fromJson(Map<String, dynamic> json) {
    final raw = json['data'];
    return ApiResult(
      success: json['success'] == true,
      code: '${json['code'] ?? ''}',
      message: '${json['message'] ?? ''}',
      data: raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{'value': raw},
    );
  }

  factory ApiResult.fail(String message, {String code = 'error'}) {
    return ApiResult(success: false, code: code, message: message, data: const {});
  }
}

class CashierApi {
  CashierApi({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  Future<ApiResult> post({
    required String webAppUrl,
    required String action,
    String pin = '',
    String idempotencyKey = '',
    Map<String, dynamic> payload = const {},
  }) async {
    final uri = Uri.tryParse(webAppUrl.trim());
    if (uri == null || !uri.hasScheme || !(uri.scheme == 'https' || uri.scheme == 'http')) {
      return ApiResult.fail('حط رابط الويب آب كامل، ويبلّش بـ https.', code: 'bad_url');
    }
    final body = jsonEncode({
      'action': action,
      'pin': pin,
      'idempotencyKey': idempotencyKey,
      'payload': payload,
    });
    try {
      final response = await _send(uri, body);
      final decoded = jsonDecode(response.body);
      if (decoded is! Map) return ApiResult.fail('الجواب مو مفهوم.');
      return ApiResult.fromJson(Map<String, dynamic>.from(decoded));
    } catch (err) {
      return ApiResult.fail('ما وصل الجواب. تأكد من النت ومن الرابط.\n$err');
    }
  }

  Future<http.Response> _send(Uri uri, String body) async {
    final first = http.Request('POST', uri)
      ..headers['Content-Type'] = 'application/json'
      ..body = body
      ..followRedirects = false;
    final opened = await _client.send(first);
    final response = await http.Response.fromStream(opened);
    if (response.statusCode == 301 || response.statusCode == 302) {
      final loc = response.headers['location'];
      if (loc != null && loc.isNotEmpty) {
        final next = http.Request('POST', Uri.parse(loc))
          ..headers['Content-Type'] = 'application/json'
          ..body = body
          ..followRedirects = false;
        return http.Response.fromStream(await _client.send(next));
      }
    }
    return response;
  }

  void close() => _client.close();
}

String newIdempotencyKey() {
  final n = DateTime.now().microsecondsSinceEpoch.toRadixString(16);
  final tail = (n.hashCode & 0x7fffffff).toRadixString(16);
  return 'app-$n-$tail';
}
