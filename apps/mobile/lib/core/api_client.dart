import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';

/// Lỗi trả về từ API, đã gỡ envelope của Rule 6.2 / ADR-003.
class ApiException implements Exception {
  ApiException(this.code, this.message,
      {this.requestId = '', this.statusCode = 0});

  final String code;
  final String message;

  /// Dùng để đối chiếu với log server khi hỗ trợ người dùng.
  final String requestId;
  final int statusCode;

  /// Lỗi mạng/hạ tầng: app phải chuyển sang phương án dự phòng (TDD §12).
  bool get isConnectivityProblem =>
      code == 'NETWORK_UNAVAILABLE' || code == 'TIMEOUT' || statusCode >= 500;

  @override
  String toString() => '[$code] $message';
}

/// Client REST gọi backend S.O.S Aid.
///
/// Mọi phản hồi đều có dạng `{ success, data, requestId }` hoặc
/// `{ success, error, requestId }`, nên việc gỡ envelope tập trung ở đây —
/// màn hình không bao giờ phải tự kiểm tra `success`.
class ApiClient {
  ApiClient({http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final http.Client _http;
  String? _accessToken;

  void setAccessToken(String? token) => _accessToken = token;

  bool get isAuthenticated => _accessToken != null;

  Future<dynamic> get(String path) => _send('GET', path);

  Future<dynamic> post(String path, {Object? body, String? idempotencyKey}) =>
      _send('POST', path, body: body, idempotencyKey: idempotencyKey);

  Future<dynamic> put(String path, {Object? body}) =>
      _send('PUT', path, body: body);

  Future<dynamic> delete(String path) => _send('DELETE', path);

  Future<dynamic> _send(
    String method,
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    final uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    final headers = <String, String>{'Content-Type': 'application/json'};

    if (_accessToken != null) {
      headers['Authorization'] = 'Bearer $_accessToken';
    }
    if (idempotencyKey != null) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    final request = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) {
      request.body = jsonEncode(body);
    }

    http.Response response;
    try {
      final streamed = await _http.send(request).timeout(AppConfig.apiTimeout);
      response = await http.Response.fromStream(streamed);
    } on TimeoutException {
      throw ApiException('TIMEOUT', 'Máy chủ phản hồi quá chậm.');
    } catch (_) {
      // Không hiển thị lỗi kỹ thuật cho người đang hoảng loạn; màn hình sẽ
      // chuyển sang hướng dẫn gọi trực tiếp.
      throw ApiException(
          'NETWORK_UNAVAILABLE', 'Không kết nối được tới máy chủ.');
    }

    if (response.statusCode == 204) return null;

    final Map<String, dynamic> payload;
    try {
      payload =
          jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException(
        'INVALID_RESPONSE',
        'Máy chủ trả về dữ liệu không đọc được.',
        statusCode: response.statusCode,
      );
    }

    if (payload['success'] == true) {
      return payload['data'];
    }

    final error = (payload['error'] as Map<String, dynamic>?) ?? const {};
    throw ApiException(
      (error['code'] as String?) ?? 'UNKNOWN',
      (error['message'] as String?) ?? 'Đã xảy ra lỗi.',
      requestId: (payload['requestId'] as String?) ?? '',
      statusCode: response.statusCode,
    );
  }

  void dispose() => _http.close();
}
