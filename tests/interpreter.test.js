// 말끝 통역: 끝말을 제대로 찾고, 문장에서 끝말만 떼어내는지 확인한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { findTrigger, joinResults, joinText, parseTriggers } from '../interpreter/trigger.js';

test('끝말로 끝나면 끝말 앞의 말만 남긴다', () => {
  assert.deepEqual(findTrigger('오늘 저녁에 같이 밥 먹을래요 번역', ['번역']), { before: '오늘 저녁에 같이 밥 먹을래요', word: '번역' });
  assert.equal(findTrigger('어디로 가면 돼요? 번역.', ['번역']).before, '어디로 가면 돼요?');
  assert.equal(findTrigger('Where is the station, translate', ['translate']).before, 'Where is the station');
});

test('끝말이 끝에 없으면 번역하지 않는다', () => {
  assert.equal(findTrigger('번역 앱이 너무 느려요', ['번역']), null);
  assert.equal(findTrigger('', ['번역']), null);
  assert.equal(findTrigger('번역가', ['번역']), null);
});

test('인식기가 띄어쓰기나 문장부호를 다르게 써도 찾는다', () => {
  assert.equal(findTrigger('감사합니다 번 역', ['번역']).before, '감사합니다');
  assert.equal(findTrigger('감사합니다번역', ['번역']).before, '감사합니다');
  assert.equal(findTrigger('Thank you. Translate!', ['translate']).before, 'Thank you.');
});

test('라틴 글자는 대소문자와 악센트를 무시하고, 단어 중간에서는 찾지 않는다', () => {
  assert.equal(findTrigger('Wo ist der Bahnhof Übersetzen', ['ubersetzen']).before, 'Wo ist der Bahnhof');
  assert.equal(findTrigger('Xin chào dịch', ['dich']).before, 'Xin chào');
  assert.equal(findTrigger('that was a mistranslate', ['translate']), null);
});

test('띄어 쓰지 않는 언어도 찾는다', () => {
  assert.equal(findTrigger('駅はどこですか翻訳', parseTriggers('翻訳, ほんやく')).before, '駅はどこですか');
  assert.equal(findTrigger('駅はどこですかほんやく', parseTriggers('翻訳, ほんやく')).before, '駅はどこですか');
});

test('끝말만 말하면 번역할 말이 없다', () => {
  assert.deepEqual(findTrigger('번역', ['번역']), { before: '', word: '번역' });
});

test('끝말 목록은 쉼표로 나누고 긴 것부터 맞춘다', () => {
  assert.deepEqual(parseTriggers(' 번역, 번역해 ,, '), ['번역해', '번역']);
  assert.deepEqual(parseTriggers('over, Over'), ['Over']);
  assert.deepEqual(parseTriggers(''), []);
  assert.equal(findTrigger('네 알겠습니다 통번역', parseTriggers('번역, 통번역')).before, '네 알겠습니다');
});

test('인식 결과 조각을 이어 붙인다', () => {
  assert.equal(joinResults(['안녕하세요', ' 반가워요'], 'ko'), '안녕하세요 반가워요');
  assert.equal(joinResults(['こんにちは', '元気ですか'], 'ja'), 'こんにちは元気ですか');
  assert.equal(joinText(['', '  hello ', null, 'world'], 'en'), 'hello world');
});

test('앞 결과를 품은 결과가 다시 와도 겹치지 않는다', () => {
  assert.equal(joinResults(['hello', 'hello world', 'hello world how are you'], 'en'), 'hello world how are you');
  assert.equal(joinResults(['hello', 'Hello, world.', 'nice to meet you'], 'en'), 'Hello, world. nice to meet you');
});
