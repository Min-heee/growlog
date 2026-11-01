// 도움받을 곳 안내. 점수와 상관없이 모든 화면의 머리글에서 바로 열린다.
import { CHECKED_ON, EMERGENCY, LATER, ONLINE, PHONES, YOUTH } from '../contacts.js';

const phone = ({ tel, show, label, hint }) => `<a class="contact" href="tel:${tel}">
  <strong>${show}</strong>
  <span class="grow"><span class="contact-label">${label}</span><span class="contact-hint">${hint}</span></span>
  <span class="chev" aria-hidden="true">›</span>
</a>`;

export const label = () => '도움받을 곳';

export function render(state) {
  const phones = state.profile.age === 'u18' ? [PHONES[0], YOUTH, ...PHONES.slice(1)] : PHONES;
  return `
    <header class="page-head">
      <h1>많이 힘들 때</h1>
    </header>
    <section class="card">
      <p class="lead flush">혼자 버티지 않아도 괜찮아요. 지금 전화해도 돼요.</p>
      <div class="contacts">${phones.map(phone).join('')}</div>
      <p class="danger-line">지금 위험하다면 바로 전화하세요.</p>
      <div class="contacts">${EMERGENCY.map(phone).join('')}</div>
    </section>
    <section class="card">
      <h2>전화가 어렵다면</h2>
      <p class="sub flush"><a href="${ONLINE.href}" target="_blank" rel="noopener noreferrer">${ONLINE.label}</a>. ${ONLINE.hint}</p>
    </section>
    <section class="card">
      <h2>급하지 않지만 이야기하고 싶다면</h2>
      <p class="sub flush">${LATER.join(', ')}에서 상담을 받을 수 있어요.</p>
    </section>
    <p class="disclaimer">이 앱은 기록을 요약할 뿐, 위급한 상황을 살피지 않아요. 연락처는 ${CHECKED_ON}에 확인했어요.</p>`;
}
