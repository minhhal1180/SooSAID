#!/usr/bin/env python3
"""Sinh bộ icon PWA cho bản web của S.O.S Aid.

Vì sao là script chứ không phải ảnh commit sẵn: icon nhị phân trong repo không
review được và không ai biết sửa lại thế nào. Script thì đọc được, sửa được, và
chạy lại cho kết quả y hệt.

    cd apps/mobile
    python tool/make_web_icons.py

Thiết kế: chữ "SOS" trắng trên nền đỏ #D32F2F (đúng seedColor của app trong
lib/main.dart), kèm một đường nhịp tim phía dưới.

KHÔNG dùng biểu tượng chữ thập: chữ thập đỏ trên nền trắng là biểu tượng được
Công ước Genève bảo hộ, và chữ thập trắng trên nền đỏ là quốc kỳ Thuỵ Sĩ — cũng
được bảo hộ. Dùng nhầm là rắc rối pháp lý thật, không phải chuyện thẩm mỹ.
"""

from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont

BRAND = (211, 47, 47)  # #D32F2F – seedColor trong lib/main.dart
WHITE = (255, 255, 255)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")

# Ứng viên font đậm, thử theo thứ tự. Không có cái nào thì lùi về font mặc định
# của PIL (xấu hơn nhưng vẫn sinh được icon, không làm hỏng build).
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]


def load_font(size: int) -> ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    print("Canh bao: khong tim thay font dam, dung font mac dinh cua PIL.")
    return ImageFont.load_default()


def draw_icon(size: int, safe_ratio: float) -> Image.Image:
    """Vẽ một icon vuông đầy nền.

    `safe_ratio` là phần cạnh mà nội dung được phép chiếm. Icon `maskable` bị
    trình duyệt/hệ điều hành cắt thành hình tròn hoặc bo góc mạnh, nên nội dung
    phải nằm gọn trong vùng an toàn (~80% cạnh) để không bị cắt cụt.

    Nền LUÔN tràn viền: iOS tự bo góc ảnh apple-touch-icon, nếu ta bo sẵn thì
    sẽ thành góc bo hai lần, nhìn như icon bị lỗi.
    """
    img = Image.new("RGB", (size, size), BRAND)
    draw = ImageDraw.Draw(img)

    content = size * safe_ratio
    cx = size / 2

    # Hai khối nằm ở hai độ cao cố định theo tỉ lệ cạnh ảnh. Tách rời như vậy
    # để đỉnh nhịp tim không bao giờ chồng lên chân chữ — lỗi này chỉ lộ ra khi
    # nhìn ảnh đã render, không lộ ra khi đọc code.
    text_center_y = size * 0.40
    pulse_base_y = size * 0.70

    # --- Chữ SOS ---------------------------------------------------------
    font = load_font(int(content * 0.34))
    text = "SOS"
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text(
        (cx - (right - left) / 2 - left, text_center_y - (bottom - top) / 2 - top),
        text,
        font=font,
        fill=WHITE,
    )

    # --- Đường nhịp tim --------------------------------------------------
    # Toạ độ theo tỉ lệ cạnh vùng an toàn, nên tự co giãn theo mọi kích thước.
    base_y = pulse_base_y
    amp = content * 0.11
    x0 = cx - content / 2
    step = content / 12

    points = [
        (x0 + step * 0, base_y),
        (x0 + step * 3, base_y),
        (x0 + step * 4, base_y - amp * 0.35),
        (x0 + step * 5, base_y + amp),
        (x0 + step * 6, base_y - amp * 1.6),
        (x0 + step * 7, base_y + amp * 0.5),
        (x0 + step * 8, base_y),
        (x0 + step * 12, base_y),
    ]
    width = max(2, int(size * 0.035))
    draw.line(points, fill=WHITE, width=width, joint="curve")

    return img


def main() -> int:
    out = os.path.normpath(OUT_DIR)
    icons_dir = os.path.join(out, "icons")
    os.makedirs(icons_dir, exist_ok=True)

    targets = [
        # (đường dẫn, kích thước, tỉ lệ vùng an toàn)
        (os.path.join(icons_dir, "Icon-192.png"), 192, 0.82),
        (os.path.join(icons_dir, "Icon-512.png"), 512, 0.82),
        # Maskable: nội dung nhỏ hơn để chịu được việc bị cắt tròn.
        (os.path.join(icons_dir, "Icon-maskable-192.png"), 192, 0.60),
        (os.path.join(icons_dir, "Icon-maskable-512.png"), 512, 0.60),
        # iOS lấy đúng 180x180 cho icon màn hình chính.
        (os.path.join(icons_dir, "apple-touch-icon-180.png"), 180, 0.82),
        (os.path.join(out, "favicon.png"), 64, 0.90),
    ]

    for path, size, safe in targets:
        draw_icon(size, safe).save(path, "PNG", optimize=True)
        print(f"  {os.path.relpath(path, out)}  {size}x{size}")

    print(f"Da sinh {len(targets)} icon vao {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
