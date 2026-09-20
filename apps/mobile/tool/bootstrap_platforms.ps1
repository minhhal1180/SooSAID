# Bản PowerShell của bootstrap_platforms.sh, dành cho máy Windows.
#
# Trên Windows chỉ sinh và kiểm tra được phần Android; thư mục ios/ vẫn được tạo
# để commit cấu hình, nhưng BIÊN DỊCH iOS bắt buộc phải chạy trên macOS.
#
# Dùng:
#   cd apps\mobile
#   .\tool\bootstrap_platforms.ps1

$ErrorActionPreference = 'Stop'

$bundleId = if ($env:BUNDLE_ID) { $env:BUNDLE_ID } else { 'vn.sosaid.mobile' }
$org = $bundleId.Substring(0, $bundleId.LastIndexOf('.'))

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$templateDir = Join-Path $scriptDir 'platform'

Set-Location $projectDir

Write-Output "==> Sinh thu muc nen tang (bundle id: $bundleId)"
flutter create --platforms=ios,android --org $org --project-name sos_aid_mobile .
if ($LASTEXITCODE -ne 0) { throw "flutter create that bai" }

# `flutter create` sinh test mau tham chieu lop `MyApp` - lop do khong ton tai
# trong du an nay (app ten `SosAidApp`), de lai se lam analyze/test that bai.
if (Test-Path 'test\widget_test.dart') { Remove-Item 'test\widget_test.dart' -Force }

Write-Output '==> Ap cau hinh iOS'
Copy-Item (Join-Path $templateDir 'ios\Info.plist') 'ios\Runner\Info.plist' -Force
Copy-Item (Join-Path $templateDir 'ios\Podfile') 'ios\Podfile' -Force

# `flutter create --org vn.sosaid --project-name sos_aid_mobile` KHONG sinh
# bundle id `vn.sosaid.mobile`: no camelCase ten project thanh
# `vn.sosaid.sosAidMobile`. Bundle id lech voi App ID da dang ky thi provisioning
# profile khong khop va ban nop TestFlight bi tu choi. Da gap that o CI.
$pbxproj = 'ios\Runner.xcodeproj\project.pbxproj'
$pbx = Get-Content $pbxproj -Raw
# Luot 1: target RunnerTests, phai giu hau to .RunnerTests.
$pbx = [regex]::Replace($pbx,
    'PRODUCT_BUNDLE_IDENTIFIER = [^;]*\.RunnerTests;',
    "PRODUCT_BUNDLE_IDENTIFIER = $bundleId.RunnerTests;")
# Luot 2: moi target con lai. Lookahead phu dinh bo qua cac dong luot 1 vua sua.
$pbx = [regex]::Replace($pbx,
    'PRODUCT_BUNDLE_IDENTIFIER = (?!' + [regex]::Escape($bundleId) + ')[^;]*;',
    "PRODUCT_BUNDLE_IDENTIFIER = $bundleId;")
Set-Content $pbxproj $pbx -Encoding utf8

if ($pbx -notmatch [regex]::Escape("PRODUCT_BUNDLE_IDENTIFIER = $bundleId;")) {
    throw "Khong dat duoc bundle id thanh $bundleId trong $pbxproj"
}
Write-Output "    Bundle id: $bundleId"

if ($env:APPLE_TEAM_ID) {
    $exportOptions = Get-Content (Join-Path $templateDir 'ios\ExportOptions.plist') -Raw
    $exportOptions = $exportOptions.Replace('${APPLE_TEAM_ID}', $env:APPLE_TEAM_ID)
    # -Encoding utf8 tuong minh: Set-Content mac dinh dung codepage ANSI.
    Set-Content 'ios\ExportOptions.plist' $exportOptions -Encoding utf8
    Write-Output "    ExportOptions.plist da sinh voi Team ID $($env:APPLE_TEAM_ID)"
} else {
    Write-Output '    BO QUA ExportOptions.plist (chua dat APPLE_TEAM_ID)'
}

Write-Output '==> Ap cau hinh Android'
Copy-Item (Join-Path $templateDir 'android\AndroidManifest.xml') `
          'android\app\src\main\AndroidManifest.xml' -Force

$gradleFile = $null
foreach ($candidate in @('android\app\build.gradle.kts', 'android\app\build.gradle')) {
    if (Test-Path $candidate) { $gradleFile = $candidate; break }
}

if ($gradleFile) {
    $gradle = Get-Content $gradleFile -Raw
    $gradle = [regex]::Replace($gradle, 'minSdk(Version)?\s*=?\s*(flutter\.minSdkVersion|\d+)', 'minSdk = 23')
    # Cung ly do nhu bundle id iOS. (`namespace` giu nguyen - doi no doi phai di
    # chuyen ca cay thu muc Kotlin.)
    $gradle = [regex]::Replace($gradle, 'applicationId( *=)? *"[^"]*"', "applicationId = `"$bundleId`"")
    Set-Content $gradleFile $gradle -Encoding utf8
    Write-Output "    Dat minSdk = 23 va applicationId = $bundleId trong $gradleFile"
}

Write-Output '==> Cai dependency'
flutter pub get
if ($LASTEXITCODE -ne 0) { throw "flutter pub get that bai" }

Write-Output ''
Write-Output 'Hoan tat. Buoc tiep theo:'
Write-Output '  flutter analyze'
Write-Output '  flutter test'
Write-Output '  Build iOS: day len GitHub va chay workflow mobile-ios (can macOS runner)'
