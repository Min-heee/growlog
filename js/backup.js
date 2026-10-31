// 백업 파일 내보내기. 설정 화면과 오류 복구 화면이 함께 쓴다.
import { getState } from './store.js';
import { todayKey } from './dates.js';
import { toast } from './ui.js';

function download(file) {
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('백업 파일을 내려받았어요');
}

export async function exportData() {
  const file = new File([JSON.stringify(getState(), null, 2)], `growlog-backup-${todayKey()}.json`, { type: 'application/json' });
  // 폰에서는 공유 창으로 파일 앱이나 메신저에 바로 보낼 수 있게 한다
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '그로우로그 백업' });
      toast('백업 파일을 보냈어요');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // 사용자가 공유 창을 닫은 경우
      // 안드로이드 Chrome은 canShare가 true여도 JSON 공유를 거부한다. 내려받기로 넘어간다.
    }
  }
  download(file);
}
