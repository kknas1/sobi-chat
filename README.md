# 소비자분쟁해결 챗봇

공정거래위원회 `소비자분쟁해결기준`과 별표 1~4를 바탕으로 소비자가 사건 내용을 채팅처럼 입력하면,

- 어떤 품목군인지 추정하고
- 어떤 분쟁유형이 맞는지 좁히고
- 부족한 사실을 다시 물어본 뒤
- 예상 환급·배상 기준을 계산하는

`Render Web Service` 배포용 Node 앱입니다.

## 현재 포함된 분야

- 농·수·축산물 / 식료품
- 동물사료
- 도서·음반·정기간행물
- 헬스·피트니스·요가·필라테스·회원권
- 스마트폰

## 동작 방식

기본 구조는 `브라우저 -> Render 서버 -> OpenAI API` 입니다.

- 프론트는 채팅 UI만 담당
- 서버는 사건 상태와 규칙 엔진을 관리
- AI는 품목/분쟁유형/필요값을 추출하고 후속 질문을 만듦
- 최종 금액 계산은 서버의 규칙 엔진이 수행

`OPENAI_API_KEY`가 없으면 서버는 규칙 기반 추정으로만 동작합니다.

## API 계약

프론트엔드는 `/api/chat`에 아래 형태로 POST 합니다.

```json
{
  "message": "헬스장 1년권 120만원 결제했는데 2개월 다니고 환불하고 싶어요",
  "history": [
    { "role": "assistant", "content": "..." }
  ],
  "caseState": {
    "categoryId": null,
    "ruleId": null,
    "values": {}
  }
}
```

응답은 아래처럼 주면 됩니다.

```json
{
  "assistantMessage": "헬스·필라테스 건으로 보입니다...",
  "source": "ai",
  "caseState": {
    "categoryId": "fitness",
    "categoryName": "헬스·피트니스·요가·필라테스·회원권",
    "ruleId": "fitness-consumer-after-start-period",
    "ruleName": "소비자 사유 해지 - 이용개시일 이후(기간형)",
    "values": {
      "usageFee": 1200000,
      "elapsedDays": 60,
      "totalDays": 365
    }
  },
  "result": {
    "amount": 902000,
    "amountLabel": "₩902,000"
  }
}
```

## 로컬 실행

```bash
npm start
```

브라우저에서 `http://127.0.0.1:3000/` 접속.

## Render 배포

1. `New +` -> `Web Service`
2. 이 저장소 연결
3. Build Command: 비워두거나 `npm install`
4. Start Command: `npm start`
5. Environment Variables 추가

필수 환경변수:

- `OPENAI_API_KEY`

선택 환경변수:

- `OPENAI_MODEL`
  예: `gpt-5.4-mini`
