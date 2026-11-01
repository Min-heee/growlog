#!/bin/zsh
# 아이폰 앱을 빌드해 TestFlight에 올린다. 인증서와 프로파일은 애플이 자동으로 관리한다.
# ios/release.env에 ASC_KEY_ID와 ASC_ISSUER_ID가 있어야 한다 (git에 올리지 않는다).
# 사용법: scripts/ios_release.sh
set -euo pipefail
cd "$(dirname "$0")/../ios"
source ./release.env

AUTH=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
  -authenticationKeyID "$ASC_KEY_ID"
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"
)
BUILD=$(date +%y%m%d%H%M) # 올릴 때마다 앞의 번호보다 커야 한다

xcodegen generate
rm -rf build/GrowLog.xcarchive
xcodebuild archive -project GrowLog.xcodeproj -scheme GrowLog -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/GrowLog.xcarchive \
  CURRENT_PROJECT_VERSION="$BUILD" "${AUTH[@]}"
xcodebuild -exportArchive -archivePath build/GrowLog.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export "${AUTH[@]}"
echo "빌드 $BUILD 업로드 완료"
