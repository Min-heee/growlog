// 말끝 통역의 순수 함수: 끝말 찾기와 음성 인식 결과 합치기. 브라우저 기능을 쓰지 않아 node --test로 검사한다.

const SEPARATOR = /[\s\p{P}\p{S}]/u; // 공백, 문장부호, 기호는 비교에서 뺀다
const SPACED = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u; // 띄어 쓰는 글자. 단어 중간에서 끝말을 찾지 않는다
const NO_SPACE = new Set(['ja', 'zh-CN', 'th']); // 인식 결과를 이어 붙일 때 띄어 쓰지 않는 언어

/** 비교용 글자. 라틴·그리스·키릴 글자는 대소문자와 악센트를 무시한다 (dich = dịch, Ubersetzen = übersetzen) */
function fold(ch) {
  return SPACED.test(ch) ? ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() : ch.toLowerCase();
}

/** 문장부호를 뺀 글자 목록. 원래 문장에서의 위치(i)를 함께 둔다 */
function units(text) {
  const out = [];
  let i = 0;
  for (const ch of text) {
    if (!SEPARATOR.test(ch)) out.push({ f: fold(ch), i });
    i += ch.length;
  }
  return out;
}

const key = (word) => units(word.normalize('NFC')).map((u) => u.f).join('');

/** "번역, 번역해" → ['번역해', '번역']. 다른 끝말을 품은 긴 끝말이 먼저 오도록 긴 것부터 */
export function parseTriggers(input) {
  const words = String(input ?? '')
    .split(/[,，、;]/)
    .map((w) => w.trim())
    .filter((w) => key(w));
  const unique = [...new Map(words.map((w) => [key(w), w])).values()];
  return unique.sort((a, b) => key(b).length - key(a).length);
}

/**
 * text가 끝말 중 하나로 끝나면 { before, word }, 아니면 null.
 * before는 끝말 앞의 말(번역할 문장), word는 맞은 끝말이다.
 */
export function findTrigger(text, triggers) {
  const source = String(text ?? '').normalize('NFC');
  const list = units(source);
  for (const word of triggers) {
    const target = key(word);
    if (!target) continue;
    let tail = '';
    let k = list.length;
    while (k > 0 && tail.length < target.length) tail = list[--k].f + tail;
    if (tail !== target) continue;
    const start = list[k].i;
    // translate가 mistranslate의 끝에서 잡히지 않게, 띄어 쓰는 글자는 단어 첫머리여야 한다
    if (SPACED.test([...word.trim()][0]) && /[\p{L}\p{N}]$/u.test(source.slice(0, start))) continue;
    return { before: source.slice(0, start).replace(/[\s,，、;:\-–—]+$/u, '').trim(), word };
  }
  return null;
}

/** 조각들을 한 문장으로. 일본어·중국어·태국어는 띄어 쓰지 않는다 */
export function joinText(parts, lang) {
  return parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(NO_SPACE.has(lang) ? '' : ' ');
}

const squash = (s) => s.replace(/[\s\p{P}]/gu, '').toLowerCase();

/**
 * 한 번 듣는 동안 받은 인식 결과들(transcript 문자열)을 한 문장으로 합친다.
 * 일부 안드로이드 Chrome은 앞 결과를 그대로 품은 결과를 새 결과로 다시 주므로, 그럴 때는 겹치지 않게 앞 것을 바꿔 끼운다.
 */
export function joinResults(transcripts, lang) {
  const parts = [];
  for (const raw of transcripts) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const prev = parts.at(-1);
    if (prev !== undefined && squash(text).startsWith(squash(prev))) parts[parts.length - 1] = text;
    else parts.push(text);
  }
  return joinText(parts, lang);
}
