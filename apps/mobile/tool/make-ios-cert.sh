#!/usr/bin/env bash
#
# Tạo chứng chỉ ký iOS (.p12) mà KHÔNG cần máy Mac.
#
# Đây là bước thủ công dễ sai nhất trong cả quy trình phát hành. Script chia nó
# thành hai lượt chạy, ở giữa là đúng một thao tác trên trang web của Apple.
#
# Dùng (Git Bash trên Windows, hoặc macOS/Linux):
#
#   # Lượt 1 – sinh khoá riêng và CSR
#   ./tool/make-ios-cert.sh init email-cua-ban@example.com
#
#   # ... lên developer.apple.com tải CSR lên, tải distribution.cer về,
#   #     đặt vào thư mục .ios-signing/ ...
#
#   # Lượt 2 – đóng gói .p12 và xuất sẵn giá trị cho GitHub Secrets
#   ./tool/make-ios-cert.sh pack
#
# CẢNH BÁO: thư mục .ios-signing/ chứa khoá ký. Ai có nó thì ký được ứng dụng
# mạo danh tổ chức của bạn. Thư mục này đã nằm trong .gitignore — KHÔNG commit,
# KHÔNG gửi qua chat hay email.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/.ios-signing"

KEY_FILE="$WORK_DIR/ios_distribution.key"
CSR_FILE="$WORK_DIR/ios_distribution.csr"
CONF_FILE="$WORK_DIR/csr.conf"
CER_FILE="$WORK_DIR/distribution.cer"
PEM_FILE="$WORK_DIR/distribution.pem"
P12_FILE="$WORK_DIR/ios_distribution.p12"
SECRETS_FILE="$WORK_DIR/github-secrets.txt"

usage() {
  cat <<'USAGE'
Cách dùng:
  make-ios-cert.sh init <email>   Sinh khoá riêng + CSR để tải lên Apple
  make-ios-cert.sh pack           Đóng gói .p12 từ .cer đã tải về, xuất secrets

Biến môi trường (tuỳ chọn):
  P12_PASSWORD   Mật khẩu cho file .p12. Bỏ trống thì script tự sinh ngẫu nhiên.
USAGE
  exit 1
}

cmd_init() {
  local email="${1:-}"
  if [ -z "$email" ]; then
    echo "Thiếu email. Ví dụ: ./tool/make-ios-cert.sh init ban@example.com"
    exit 1
  fi

  mkdir -p "$WORK_DIR"

  if [ -f "$KEY_FILE" ]; then
    # Sinh đè khoá sẽ làm .cer đã tải về trở nên vô dụng: khoá riêng và chứng
    # chỉ phải là một cặp. Dừng lại thay vì âm thầm phá hỏng.
    echo "ĐÃ TỒN TẠI: $KEY_FILE"
    echo "Muốn làm lại từ đầu thì xoá thư mục .ios-signing/ rồi chạy lại."
    exit 1
  fi

  echo "==> Sinh khoá riêng 2048-bit"
  openssl genrsa -out "$KEY_FILE" 2048 2>/dev/null
  chmod 600 "$KEY_FILE"

  # Subject viết trong file config thay vì tham số `-subj`.
  #
  # Lý do: Git Bash trên Windows tưởng "/emailAddress=..." là đường dẫn Unix và
  # đổi thành "C:/Program Files/Git/emailAddress=...", khiến openssl từ chối.
  # Tắt phép chuyển đổi đó lại làm hỏng các đường dẫn file thật trong cùng lệnh.
  # Config file thì không có chuỗi nào bị shell diễn giải — chạy đúng trên cả
  # Windows, macOS và Linux.
  echo "==> Sinh Certificate Signing Request"
  cat > "$CONF_FILE" <<EOF
[ req ]
default_md         = sha256
distinguished_name = dn
prompt             = no

[ dn ]
emailAddress = $email
CN           = SOS Aid Distribution
C            = VN
EOF

  openssl req -new -key "$KEY_FILE" -out "$CSR_FILE" -config "$CONF_FILE"

  cat <<EOF

Xong lượt 1.

Tiếp theo, làm trên trình duyệt:

  1. Mở https://developer.apple.com/account/resources/certificates/list
  2. Bấm "+", chọn "Apple Distribution", Continue
  3. Tải lên file CSR:
       $CSR_FILE
  4. Continue → Download, được file distribution.cer
  5. Chép file đó vào thư mục:
       $WORK_DIR

Sau đó chạy:
  ./tool/make-ios-cert.sh pack
EOF
}

cmd_pack() {
  if [ ! -f "$KEY_FILE" ]; then
    echo "Chưa có khoá riêng. Chạy: ./tool/make-ios-cert.sh init <email>"
    exit 1
  fi
  if [ ! -f "$CER_FILE" ]; then
    echo "Chưa thấy file: $CER_FILE"
    echo "Tải chứng chỉ từ developer.apple.com và đặt vào thư mục .ios-signing/"
    exit 1
  fi

  echo "==> Chuyển .cer (DER) sang .pem"
  openssl x509 -inform DER -in "$CER_FILE" -out "$PEM_FILE"

  # Kiểm tra khoá và chứng chỉ có khớp nhau không TRƯỚC khi đóng gói. Nếu lệch,
  # .p12 vẫn tạo ra được nhưng Xcode sẽ báo "no signing identity" lúc build —
  # lỗi rất khó lần khi chỉ nhìn log CI.
  echo "==> Đối chiếu khoá riêng với chứng chỉ"
  local key_modulus cert_modulus
  key_modulus="$(openssl rsa -noout -modulus -in "$KEY_FILE" 2>/dev/null | openssl md5)"
  cert_modulus="$(openssl x509 -noout -modulus -in "$PEM_FILE" | openssl md5)"

  if [ "$key_modulus" != "$cert_modulus" ]; then
    echo ""
    echo "LỖI: chứng chỉ KHÔNG khớp khoá riêng."
    echo "Nhiều khả năng .cer được tạo từ một CSR khác."
    echo "Xoá thư mục .ios-signing/ và làm lại từ bước init."
    exit 1
  fi
  echo "    Khớp."

  # Mật khẩu sinh ngẫu nhiên thay vì hỏi người dùng.
  #
  # Hai lý do: (1) `openssl pkcs12 -export` đọc mật khẩu từ terminal, nên khi
  # chạy trong script/CI nó treo vô hạn; (2) mật khẩu này chỉ dùng để nạp vào
  # GitHub Secrets, không ai phải gõ lại, nên chuỗi ngẫu nhiên an toàn hơn hẳn
  # mật khẩu người dùng tự nghĩ.
  local password="${P12_PASSWORD:-}"
  if [ -z "$password" ]; then
    password="$(openssl rand -base64 24 | tr -d '\n/+=' | cut -c1-24)"
  fi

  echo "==> Đóng gói .p12"
  openssl pkcs12 -export \
    -inkey "$KEY_FILE" \
    -in "$PEM_FILE" \
    -out "$P12_FILE" \
    -name "SOS Aid Distribution" \
    -passout "pass:$password"

  # Xác minh .p12 mở được bằng đúng mật khẩu vừa đặt — bắt lỗi ngay tại đây thay
  # vì để CI phát hiện sau 15 phút build.
  if ! openssl pkcs12 -in "$P12_FILE" -nokeys -passin "pass:$password" -noout 2>/dev/null; then
    echo "LỖI: không mở lại được .p12 vừa tạo."
    exit 1
  fi
  echo "    Đã xác minh mở lại được."

  echo "==> Xuất giá trị cho GitHub Secrets"
  # base64 một dòng duy nhất: chuỗi nhiều dòng dán vào GitHub Secrets sẽ hỏng.
  local p12_base64
  if base64 -w 0 "$P12_FILE" > /dev/null 2>&1; then
    p12_base64="$(base64 -w 0 "$P12_FILE")"
  else
    p12_base64="$(base64 "$P12_FILE" | tr -d '\n')"
  fi

  {
    echo "IOS_DIST_CERT_PASSWORD"
    echo "$password"
    echo ""
    echo "IOS_DIST_CERT_P12_BASE64"
    echo "$p12_base64"
  } > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"

  cat <<EOF

Xong.

Mở file này và chép 2 giá trị vào
GitHub → Settings → Secrets and variables → Actions:

  $SECRETS_FILE

    IOS_DIST_CERT_PASSWORD    (dòng 2)
    IOS_DIST_CERT_P12_BASE64  (dòng 5, một dòng rất dài — chép trọn vẹn)

Nạp xong thì XOÁ thư mục $WORK_DIR,
hoặc sao lưu vào nơi an toàn. Mất khoá thì phải tạo chứng chỉ mới.
EOF
}

case "${1:-}" in
  init) shift; cmd_init "$@" ;;
  pack) cmd_pack ;;
  *) usage ;;
esac
