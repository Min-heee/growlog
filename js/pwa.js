// 앱 설치와 오프라인 실행: 서비스 워커 등록, 설치 안내, 저장 공간 보호
import { refresh, toast } from './ui.js';
import { isNativeApp } from './util.js';

let installPrompt = null;
let justInstalled = false;

export const isStandalone = () => isNativeApp() || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// iPadOS는 데스크톱 Safari처럼 자신을 알리므로 터치 지점 수로 구분한다
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 'installed'(앱으로 실행 중) | 'done'(방금 설치함) | 'ready'(설치 버튼을 띄울 수 있음) | 'ios' | 'manual' */
export function installState() {
  if (isStandalone()) return 'installed';
  if (justInstalled) return 'done';
  if (installPrompt) return 'ready';
  return isIOS() ? 'ios' : 'manual';
}

// 설치 안내는 설정 화면에만 있다. 다른 화면을 다시 그리면 입력 중인 칸이 풀린다.
function refreshSettings() {
  if (location.hash === '#/settings') refresh({ background: true });
}

/** 브라우저의 설치 창을 띄운다. 사용자가 설치하면 true */
export async function promptInstall() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  justInstalled = outcome === 'accepted';
  refreshSettings();
  return justInstalled;
}

export function initPWA() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    refreshSettings();
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    justInstalled = true;
    refreshSettings();
  });
  // HTTPS나 localhost가 아니면 serviceWorker가 없다. 그래도 앱은 그대로 돈다.
  navigator.serviceWorker?.register('sw.js').catch(() => {});
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'updated') toast('새 버전이 준비됐어요', { label: '새로고침', onClick: () => location.reload() });
  });
  // 기록이 이 기기에만 있으니, 저장 공간이 부족해도 브라우저가 지우지 않도록 요청한다
  navigator.storage?.persist?.().catch(() => {});
}
