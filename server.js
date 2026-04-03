const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const DEBUG_VAR = String(process.env.DEBUG_VAR || "").toUpperCase() === "ON";

const bookNormalUseRates = [
  { maxMonths: 1, rate: 20, label: "1개월 미만" },
  { maxMonths: 2, rate: 23, label: "1개월 이상~2개월 미만" },
  { maxMonths: 3, rate: 27, label: "2개월 이상~3개월 미만" },
  { maxMonths: 4, rate: 30, label: "3개월 이상~4개월 미만" },
  { maxMonths: 5, rate: 40, label: "4개월 이상~5개월 미만" },
  { maxMonths: 6, rate: 50, label: "5개월 이상~6개월 미만" },
  { maxMonths: 7, rate: 60, label: "6개월 이상~7개월 미만" },
  { maxMonths: 8, rate: 70, label: "7개월 이상~8개월 미만" },
  { maxMonths: 9, rate: 80, label: "8개월 이상~9개월 미만" },
  { maxMonths: 10, rate: 90, label: "9개월 이상~10개월 미만" }
];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function resolveBookNormalUse(months) {
  const value = Math.max(0, months);
  return (
    bookNormalUseRates.find((item) => value < item.maxMonths) || {
      maxMonths: Infinity,
      rate: 90,
      label: "10개월 이상"
    }
  );
}

const categories = [
  {
    id: "food",
    name: "농·수·축산물 / 식료품",
    keywords: ["식품", "식료품", "음식", "먹거리", "냉동식품", "도시락", "과자", "음료", "빵", "식자재", "유통기한", "소비기한", "이물", "부패", "변질"],
    rules: [
      {
        id: "food-refund",
        name: "함량부족 / 부패·변질 / 소비기한·유통기간 경과 / 이물혼입",
        keywords: ["이물", "부패", "변질", "유통기한", "소비기한", "함량부족", "용량부족", "중량부족", "이물혼입"],
        fields: [{ id: "purchasePrice", label: "구입가", question: "구입가가 얼마였나요?", type: "currency" }],
        calculate(values) {
          const purchasePrice = number(values.purchasePrice);
          return {
            kind: "amount",
            title: "구입가 환급 가능",
            amount: purchasePrice,
            amountLabel: formatCurrency(purchasePrice),
            summary: "기준상 제품교환 또는 구입가 환급입니다. 여기서는 환급으로 계산했습니다.",
            breakdown: [`구입가 ${formatCurrency(purchasePrice)} 전액 환급`],
            references: ["식료품 / 농·수·축산물 분쟁유형 중 함량부족, 부패·변질, 기간 경과, 이물혼입"]
          };
        }
      },
      {
        id: "food-side-effect",
        name: "부작용 또는 용기파손 등으로 인한 상해",
        keywords: ["부작용", "상해", "다침", "병원", "치료비", "용기파손"],
        fields: [
          { id: "treatmentCost", label: "치료비", question: "치료비가 얼마 들었나요?", type: "currency" },
          { id: "extraCost", label: "기타 경비", question: "기타 경비가 있으면 얼마인지 알려주세요. 없으면 0이라고 적어주세요.", type: "currency" },
          { id: "lostIncome", label: "일실소득", question: "일실소득이 있으면 얼마인지 알려주세요. 없으면 0이라고 적어주세요.", type: "currency" }
        ],
        calculate(values) {
          const treatmentCost = number(values.treatmentCost);
          const extraCost = number(values.extraCost);
          const lostIncome = number(values.lostIncome);
          const amount = treatmentCost + extraCost + lostIncome;
          return {
            kind: "amount",
            title: "손해배상 가능",
            amount,
            amountLabel: formatCurrency(amount),
            summary: "기준상 치료비, 경비, 일실소득을 합산해 배상합니다.",
            breakdown: [
              `치료비 ${formatCurrency(treatmentCost)}`,
              `기타 경비 ${formatCurrency(extraCost)}`,
              `일실소득 ${formatCurrency(lostIncome)}`
            ],
            references: ["식료품 / 농·수·축산물 분쟁유형 중 부작용", "일실소득은 입증이 필요한 항목"]
          };
        }
      }
    ]
  },
  {
    id: "fitness",
    name: "헬스·피트니스·요가·필라테스·회원권",
    keywords: ["헬스", "헬스장", "피트니스", "pt", "퍼스널트레이닝", "필라테스", "요가", "회원권", "수업", "강습"],
    rules: [
      {
        id: "fitness-mismatch",
        name: "계약내용 또는 광고내용이 실제와 다른 경우",
        keywords: ["광고와 다르", "설명과 다르", "계약과 다르", "약속과 다르", "홍보와 다르"],
        fields: [{ id: "usageFee", label: "총 이용료", question: "총 결제금액이 얼마였나요?", type: "currency" }],
        calculate(values) {
          const usageFee = number(values.usageFee);
          return {
            kind: "amount",
            title: "전액 환급 가능",
            amount: usageFee,
            amountLabel: formatCurrency(usageFee),
            summary: "시설 이용 및 강습 등에 관한 계약내용 또는 광고내용이 실제와 다른 경우 전액 환급입니다.",
            breakdown: [`총 이용료 ${formatCurrency(usageFee)} 전액 환급`],
            references: ["체육시설업·레저용역업·할인회원권업 1) 계약내용 또는 광고내용이 실제와 다른 경우"]
          };
        }
      },
      {
        id: "fitness-facility-trouble",
        name: "시설 고장·이전·휴업·정원초과로 정상 이용이 곤란한 경우",
        keywords: ["휴업", "폐업", "문닫", "이전", "시설 고장", "기계 고장", "정원초과", "운영중단"],
        fields: [],
        calculate() {
          return {
            kind: "guide",
            title: "환급 또는 대체 이용 기준",
            summary: "문서상 반환금액 환급 또는 동급 시설 이용 대체가 가능합니다.",
            breakdown: [
              "환급을 선택하면 사업자 책임 해지 규칙(이용개시 전/후, 기간형/횟수형)을 따라 계산",
              "동급의 타 시설물로 이용 대체도 가능"
            ],
            references: ["체육시설업·레저용역업·할인회원권업 2) 기기 및 시설의 고장, 이전, 휴업, 정원초과 등"]
          };
        }
      },
      {
        id: "fitness-business-before-start",
        name: "사업자 사유 해지 - 이용개시일 이전",
        keywords: ["사업자 사정", "센터 사정", "사업자 책임", "개시 전", "시작 전", "아직 안 감", "이용 전", "첫 수업 전"],
        fields: [{ id: "usageFee", label: "총 이용료", question: "총 결제금액이 얼마였나요?", type: "currency" }],
        calculate(values) {
          const usageFee = number(values.usageFee);
          const penalty = usageFee * 0.1;
          const amount = usageFee + penalty;
          return {
            kind: "amount",
            title: "이용료 + 위약금 환급",
            amount,
            amountLabel: formatCurrency(amount),
            summary: "사업자 책임으로 이용개시 전에 해지되면 이용료 전액에 위약금 10%를 더해 환급합니다.",
            breakdown: [`총 이용료 ${formatCurrency(usageFee)}`, `위약금 10% ${formatCurrency(penalty)}`],
            references: [
              "체육시설업·레저용역업·할인회원권업 4) 사업자 책임 해지 - 이용개시일 이전",
              "헬스·피트니스업, 요가·필라테스업 위약금 기준: 총 계약대금의 10%"
            ]
          };
        }
      },
      {
        id: "fitness-business-after-start-period",
        name: "사업자 사유 해지 - 이용개시일 이후(기간형)",
        keywords: ["사업자 사정", "센터 사정", "사업자 책임", "개월", "달", "기간", "이용기간", "다니다", "등록"],
        fields: [
          { id: "usageFee", label: "총 이용료", question: "총 결제금액이 얼마였나요?", type: "currency" },
          { id: "elapsedDays", label: "이미 경과한 기간(일수)", question: "이미 지난 기간이 며칠인가요?", type: "integer" },
          { id: "totalDays", label: "계약상 이용기간(일수)", question: "계약상 전체 이용기간은 며칠인가요?", type: "integer" }
        ],
        calculate(values) {
          const usageFee = number(values.usageFee);
          const elapsedDays = number(values.elapsedDays);
          const totalDays = Math.max(1, number(values.totalDays));
          const usedAmount = usageFee * (elapsedDays / totalDays);
          const penalty = usageFee * 0.1;
          const amount = Math.max(0, usageFee - usedAmount) + penalty;
          return {
            kind: "amount",
            title: "잔여 이용료 + 위약금 환급",
            amount,
            amountLabel: formatCurrency(amount),
            summary: "기간형 계약에서 사업자 책임으로 중도해지되는 경우의 기준식입니다.",
            breakdown: [
              `총 이용료 ${formatCurrency(usageFee)}`,
              `경과기간 차감액 ${formatCurrency(usedAmount)} = ${elapsedDays}일 / ${totalDays}일`,
              `위약금 10% ${formatCurrency(penalty)}`
            ],
            references: [
              "체육시설업·레저용역업·할인회원권업 4) 사업자 책임 해지 - 이용개시일 이후(기간형)",
              "헬스·피트니스업, 요가·필라테스업 위약금 기준: 총 계약대금의 10%"
            ]
          };
        }
      },
      {
        id: "fitness-business-after-start-count",
        name: "사업자 사유 해지 - 이용개시일 이후(횟수형)",
        keywords: ["사업자 사정", "센터 사정", "사업자 책임", "회", "횟수", "pt", "필라테스", "수업", "강습"],
        fields: [
          { id: "usageFee", label: "총 이용료", question: "총 결제금액이 얼마였나요?", type: "currency" },
          { id: "usedCount", label: "이미 이용한 횟수", question: "이미 이용한 횟수가 몇 회인가요?", type: "integer" },
          { id: "totalCount", label: "계약상 이용횟수", question: "계약상 전체 이용횟수는 몇 회인가요?", type: "integer" }
        ],
        calculate(values) {
          const usageFee = number(values.usageFee);
          const usedCount = number(values.usedCount);
          const totalCount = Math.max(1, number(values.totalCount));
          const usedAmount = usageFee * (usedCount / totalCount);
          const penalty = usageFee * 0.1;
          const amount = Math.max(0, usageFee - usedAmount) + penalty;
          return {
            kind: "amount",
            title: "잔여 이용료 + 위약금 환급",
            amount,
            amountLabel: formatCurrency(amount),
            summary: "횟수형 강습에서 사업자 책임으로 중도해지되는 경우의 기준식입니다.",
            breakdown: [
              `총 이용료 ${formatCurrency(usageFee)}`,
              `이용횟수 차감액 ${formatCurrency(usedAmount)} = ${usedCount}회 / ${totalCount}회`,
              `위약금 10% ${formatCurrency(penalty)}`
            ],
            references: [
              "체육시설업·레저용역업·할인회원권업 4) 사업자 책임 해지 - 이용개시일 이후(횟수형)",
              "헬스·피트니스업, 요가·필라테스업 위약금 기준: 총 계약대금의 10%"
            ]
          };
        }
      },
      {
        id: "fitness-consumer-before-start",
        name: "소비자 사유 해지 - 이용개시일 이전",
        keywords: ["환불", "해지", "중도해지", "개시 전", "시작 전", "아직 안 감", "이용 전", "개인사정"],
        fields: [{ id: "usageFee", label: "총 이용료", question: "총 결제금액이 얼마였나요?", type: "currency" }],
        calculate(values) {
          const usageFee = number(values.usageFee);
          const penalty = usageFee * 0.1;
          const amount = Math.max(0, usageFee - penalty);
          return {
            kind: "amount",
            title: "위약금 공제 후 환급",
            amount,
            amountLabel: formatCurrency(amount),
            summary: "이용개시 전 소비자 해지 시 총 결제금액의 10%를 공제합니다.",
            breakdown: [`총 이용료 ${formatCurrency(usageFee)}`, `위약금 10% 공제 ${formatCurrency(penalty)}`],
            references: [
              "체육시설업·레저용역업·할인회원권업 5) 소비자 책임 해지 - 이용개시일 이전",
              "헬스·피트니스업, 요가·필라테스업 위약금 기준: 총 계약대금의 10%"
            ]
          };
        }
      },
      {
        id: "fitness-consumer-after-start-period",
        name: "소비자 사유 해지 - 이용개시일 이후(기간형)",
        keywords: ["환불", "해지", "중도해지", "개월", "달", "이사", "개인사정", "못가", "사용중", "다니다"],
        fields: [
          { id: "usageFee", label: "총 이용료", question: "총 결제금액이 얼마였나요?", type: "currency" },
          { id: "elapsedDays", label: "이미 경과한 기간(일수)", question: "이미 지난 기간이 며칠인가요?", type: "integer" },
          { id: "totalDays", label: "계약상 이용기간(일수)", question: "계약상 전체 이용기간은 며칠인가요?", type: "integer" }
        ],
        calculate(values) {
          const usageFee = number(values.usageFee);
          const elapsedDays = number(values.elapsedDays);
          const totalDays = Math.max(1, number(values.totalDays));
          const usedAmount = usageFee * (elapsedDays / totalDays);
          const penalty = usageFee * 0.1;
          const amount = Math.max(0, usageFee - usedAmount - penalty);
          return {
            kind: "amount",
            title: "잔여 이용료에서 위약금 공제 후 환급",
            amount,
            amountLabel: formatCurrency(amount),
            summary: "기간형 헬스·필라테스 계약을 소비자 사정으로 중도해지하는 경우의 기준식입니다.",
            breakdown: [
              `총 이용료 ${formatCurrency(usageFee)}`,
              `경과기간 차감액 ${formatCurrency(usedAmount)} = ${elapsedDays}일 / ${totalDays}일`,
              `위약금 10% 공제 ${formatCurrency(penalty)}`
            ],
            references: [
              "체육시설업·레저용역업·할인회원권업 5) 소비자 책임 해지 - 이용개시일 이후(기간형)",
              "헬스·피트니스업, 요가·필라테스업 위약금 기준: 총 계약대금의 10%"
            ]
          };
        }
      },
      {
        id: "fitness-consumer-after-start-count",
        name: "소비자 사유 해지 - 이용개시일 이후(횟수형)",
        keywords: ["환불", "해지", "중도해지", "회", "횟수", "pt", "필라테스", "요가", "강습", "수업"],
        fields: [
          { id: "usageFee", label: "총 이용료", question: "총 결제금액이 얼마였나요?", type: "currency" },
          { id: "usedCount", label: "이미 이용한 횟수", question: "이미 이용한 횟수가 몇 회인가요?", type: "integer" },
          { id: "totalCount", label: "계약상 이용횟수", question: "계약상 전체 이용횟수는 몇 회인가요?", type: "integer" }
        ],
        calculate(values) {
          const usageFee = number(values.usageFee);
          const usedCount = number(values.usedCount);
          const totalCount = Math.max(1, number(values.totalCount));
          const usedAmount = usageFee * (usedCount / totalCount);
          const penalty = usageFee * 0.1;
          const amount = Math.max(0, usageFee - usedAmount - penalty);
          return {
            kind: "amount",
            title: "잔여 이용료에서 위약금 공제 후 환급",
            amount,
            amountLabel: formatCurrency(amount),
            summary: "횟수형 PT·필라테스 수업을 소비자 사정으로 중도해지하는 경우의 기준식입니다.",
            breakdown: [
              `총 이용료 ${formatCurrency(usageFee)}`,
              `이용횟수 차감액 ${formatCurrency(usedAmount)} = ${usedCount}회 / ${totalCount}회`,
              `위약금 10% 공제 ${formatCurrency(penalty)}`
            ],
            references: [
              "체육시설업·레저용역업·할인회원권업 5) 소비자 책임 해지 - 이용개시일 이후(횟수형)",
              "헬스·피트니스업, 요가·필라테스업 위약금 기준: 총 계약대금의 10%"
            ]
          };
        }
      }
    ]
  },
  {
    id: "smartphone",
    name: "스마트폰",
    keywords: ["스마트폰", "휴대폰", "핸드폰", "아이폰", "갤럭시", "휴대전화", "리퍼폰", "수리", "부품"],
    rules: [
      {
        id: "smartphone-10days",
        name: "구입 후 10일 이내 중대한 성능·기능 하자",
        keywords: ["10일", "열흘", "초기불량", "구입 후 10일", "산 지 10일", "중대한 하자"],
        fields: [{ id: "purchasePrice", label: "구입가", question: "구입가가 얼마였나요?", type: "currency" }],
        calculate(values) {
          const purchasePrice = number(values.purchasePrice);
          return {
            kind: "amount",
            title: "구입가 환급 가능",
            amount: purchasePrice,
            amountLabel: formatCurrency(purchasePrice),
            summary: "구입 후 10일 이내에 중요한 수리를 요하는 하자를 제기한 경우 환급 기준입니다.",
            breakdown: [`구입가 ${formatCurrency(purchasePrice)} 전액 환급`],
            references: ["스마트폰 1) 구입 후 10일 이내 중대한 성능·기능 하자"]
          };
        }
      },
      {
        id: "smartphone-1month",
        name: "구입 후 1개월 이내 중대한 성능·기능 하자",
        keywords: ["1개월", "한 달", "산 지 한 달", "구입 후 1개월"],
        fields: [],
        calculate() {
          return {
            kind: "guide",
            title: "교환 또는 무상수리 기준",
            summary: "구입 후 1개월 이내 문제 제기 시 금액 환급보다 교환 또는 무상수리가 우선 기준입니다.",
            breakdown: ["문서 기준상 처리방식은 제품 교환 또는 무상수리"],
            references: ["스마트폰 2) 구입 후 1개월 이내 중대한 성능·기능 하자"]
          };
        }
      },
      {
        id: "smartphone-repair-impossible",
        name: "품질보증기간 내 수리 불가능 / 교환 불가능",
        keywords: ["수리 불가능", "수리 안 됨", "교환 불가능", "반복 수리", "하자 재발", "품질보증기간 내"],
        fields: [{ id: "purchasePrice", label: "구입가", question: "구입가가 얼마였나요?", type: "currency" }],
        calculate(values) {
          const purchasePrice = number(values.purchasePrice);
          return {
            kind: "amount",
            title: "구입가 환급 가능",
            amount: purchasePrice,
            amountLabel: formatCurrency(purchasePrice),
            summary: "품질보증기간 내 정상사용 하자에 대해 수리 또는 교환이 불가능한 경우 구입가 환급 기준입니다.",
            breakdown: [`구입가 ${formatCurrency(purchasePrice)} 환급`],
            references: ["스마트폰 3) 품질보증기간 이내 하자 - 수리 불가능 시 또는 교환 불가능 시"]
          };
        }
      },
      {
        id: "smartphone-parts-out-warranty",
        name: "품질보증기간 경과 후 부품 미보유로 수리·리퍼 해결 불가",
        keywords: ["부품이 없음", "부품 없음", "부품 미보유", "부품이 없어서", "품질보증기간 경과", "감가상각", "리퍼 불가", "수리가 안 된대", "수리가 안 된다"],
        fields: [
          { id: "purchasePrice", label: "구입가", question: "구입가가 얼마였나요?", type: "currency" },
          { id: "usedMonths", label: "사용 개월 수", question: "현재까지 사용한 개월 수가 몇 개월인가요?", type: "float" },
          { id: "lifeMonths", label: "내용연수(개월)", question: "적용할 내용연수는 몇 개월로 볼까요? 모르면 24개월처럼 입력해주세요.", type: "float" }
        ],
        calculate(values) {
          const purchasePrice = number(values.purchasePrice);
          const usedMonths = Math.max(0, number(values.usedMonths));
          const lifeMonths = Math.max(1, number(values.lifeMonths));
          const depreciation = Math.min(purchasePrice, purchasePrice * (usedMonths / lifeMonths));
          const residual = Math.max(0, purchasePrice - depreciation);
          const bonus = purchasePrice * 0.1;
          const amount = residual + bonus;
          return {
            kind: "amount",
            title: "감가상각 잔여금 + 10% 환급",
            amount,
            amountLabel: formatCurrency(amount),
            summary: "문서상 정액법 감가상각 후 잔여금에 구입가 10%를 더해 환급합니다.",
            breakdown: [
              `구입가 ${formatCurrency(purchasePrice)}`,
              `감가상각비 ${formatCurrency(depreciation)} = (${usedMonths} / ${lifeMonths}) × 구입가`,
              `감가상각 잔여금 ${formatCurrency(residual)}`,
              `구입가 10% 가산 ${formatCurrency(bonus)}`
            ],
            references: ["스마트폰 4) 품질보증기간 경과 후 부품 미보유로 수리 불가", "감가상각방법: 정액법, 내용연수는 별표 IV 기준(월할계산)"]
          };
        }
      }
    ]
  }
];

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function getCategoryById(id) {
  return categories.find((category) => category.id === id) || null;
}

function getRuleById(categoryId, ruleId) {
  const category = getCategoryById(categoryId);
  return category ? category.rules.find((rule) => rule.id === ruleId) || null : null;
}

function scoreKeywords(text, keywords = []) {
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

function inferCategory(text) {
  const ranked = categories
    .map((category) => ({
      category,
      score: scoreKeywords(text, category.keywords) + scoreKeywords(text, category.rules.flatMap((rule) => rule.keywords || [])) * 0.2
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score > 0 ? ranked[0].category : null;
}

function heuristicRuleScore(categoryId, ruleId, text) {
  if (categoryId === "fitness") {
    const beforeStart = /(시작 전|개시 전|이용 전|첫 수업 전|아직 안)/.test(text);
    const businessCause = /(폐업|휴업|사업자 사정|센터 사정|운영중단|이전|정원초과|고장)/.test(text);
    const countType = /(회|횟수|pt|수업|강습)/.test(text);
    const refundIntent = /(환불|해지|중도해지)/.test(text);
    const mismatch = /(광고와 다르|계약과 다르|설명과 다르|약속과 다르)/.test(text);
    if (ruleId === "fitness-mismatch" && mismatch) return 6;
    if (ruleId === "fitness-facility-trouble" && /(고장|휴업|폐업|정원초과|이전)/.test(text)) return 5;
    if (ruleId === "fitness-business-before-start" && businessCause && beforeStart) return 7;
    if (ruleId === "fitness-business-after-start-period" && businessCause && !beforeStart && !countType) return 7;
    if (ruleId === "fitness-business-after-start-count" && businessCause && !beforeStart && countType) return 8;
    if (ruleId === "fitness-consumer-before-start" && refundIntent && beforeStart && !businessCause) return 7;
    if (ruleId === "fitness-consumer-after-start-period" && refundIntent && !beforeStart && !businessCause && !countType) return 7;
    if (ruleId === "fitness-consumer-after-start-count" && refundIntent && !beforeStart && !businessCause && countType) return 8;
  }

  if (categoryId === "smartphone") {
    if (ruleId === "smartphone-10days" && /(10일|열흘|초기불량)/.test(text)) return 8;
    if (ruleId === "smartphone-1month" && /(1개월|한 달)/.test(text)) return 6;
    if (ruleId === "smartphone-parts-out-warranty" && /(부품 없음|부품이 없음|부품 미보유|부품이 없어서|감가상각|수리가 안 된대|수리가 안 된다)/.test(text)) return 8;
    if (ruleId === "smartphone-repair-impossible" && /(수리 불가능|교환 불가능|반복 수리|하자 재발)/.test(text)) return 7;
  }

  if (categoryId === "food") {
    if (ruleId === "food-side-effect" && /(병원|치료비|부작용|상해)/.test(text)) return 6;
    if (ruleId === "food-refund" && /(이물|부패|변질|유통기한|소비기한)/.test(text)) return 6;
  }

  return 0;
}

function inferRule(category, text) {
  const ranked = category.rules
    .map((rule) => ({
      rule,
      score: scoreKeywords(text, rule.keywords || []) + heuristicRuleScore(category.id, rule.id, text)
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score > 0 ? ranked[0].rule : null;
}

function parseKoreanAmount(text) {
  const normalized = String(text).replaceAll(",", "").replace(/\s+/g, "");
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(만원|만|천원|천|원)/g,
    /(\d{4,})/g
  ];
  const matches = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalized)) !== null) {
      const value = Number(match[1] || match[0]);
      const unit = match[2] || "";
      if (!Number.isFinite(value)) continue;
      if (unit === "만원" || unit === "만") matches.push(Math.round(value * 10000));
      else if (unit === "천원" || unit === "천") matches.push(Math.round(value * 1000));
      else matches.push(Math.round(value));
    }
  }

  return matches.length ? matches[0] : null;
}

function parseNumeric(text) {
  const normalized = String(text).replaceAll(",", "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function normalizeYear(value) {
  if (value == null || value === "") return null;
  const year = Number(value);
  if (!Number.isFinite(year)) return null;
  if (year >= 100) return year;
  return 2000 + year;
}

function buildUtcDate(year, month, day = 1) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function diffDays(startDate, endDate) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) return null;
  const ms = endDate.getTime() - startDate.getTime();
  return ms >= 0 ? Math.round(ms / 86400000) : null;
}

function currentDateParts(referenceDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  });
  const parts = formatter.formatToParts(referenceDate);
  const read = (type) => Number(parts.find((item) => item.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day")
  };
}

function parseDateMatch(match, { fallbackYear = null, fallbackDay = 1 } = {}) {
  if (!match) return null;
  const year = normalizeYear(match[1]) ?? fallbackYear;
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : fallbackDay;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function extractStartDateParts(transcript, referenceDate = new Date()) {
  const now = currentDateParts(referenceDate);
  const patterns = [
    /(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?\s*(?:부터\s*)?(?:시작|개시|등록|첫\s*이용|이용\s*시작)/,
    /(?:시작일|개시일|등록일)(?:은|이)?\s*(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/,
    /(?:시작|개시|등록)(?:은|이)?\s*(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/
  ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    const parsed = parseDateMatch(match, { fallbackYear: now.year, fallbackDay: 1 });
    if (parsed) return parsed;
  }

  return null;
}

function extractCurrentDateParts(transcript, startParts = null, referenceDate = new Date()) {
  const now = currentDateParts(referenceDate);
  const resolveYear = (explicitYear, month) => {
    const normalized = normalizeYear(explicitYear);
    if (normalized) return normalized;
    if (startParts?.year != null && Number.isFinite(month)) {
      return month < startParts.month ? startParts.year + 1 : startParts.year;
    }
    return now.year;
  };

  const patterns = [
    /(?:지금|현재|오늘|아직)(?:은|이)?\s*(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/,
    /(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?\s*(?:인데|기준|현재|지금|오늘)/,
    /(?:해지일|환불일|해지|환불)(?:은|이)?\s*(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/
  ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (!match) continue;
    const month = Number(match[2]);
    const year = resolveYear(match[1], month);
    const day = match[3] ? Number(match[3]) : year === now.year && month === now.month ? now.day : 1;
    return { year, month, day };
  }

  if (/(지금|현재|오늘)/.test(transcript)) {
    return now;
  }

  return null;
}

function inferElapsedDaysFromTimeline(transcript, referenceDate = new Date()) {
  const startParts = extractStartDateParts(transcript, referenceDate);
  if (!startParts) return null;

  const endParts = extractCurrentDateParts(transcript, startParts, referenceDate) || currentDateParts(referenceDate);
  const startDate = buildUtcDate(startParts.year, startParts.month, startParts.day);
  const endDate = buildUtcDate(endParts.year, endParts.month, endParts.day);
  return diffDays(startDate, endDate);
}

function parseDamageState(text) {
  if (text.includes("몹시")) return "poor";
  if (text.includes("다소")) return "fair";
  if (text.includes("양호")) return "good";
  return null;
}

function extractNearbyValue(text, alias, type) {
  const normalized = text.replaceAll(",", "");
  const patterns = [
    new RegExp(`${alias}[^\\d]{0,12}(\\d+(?:\\.\\d+)?)\\s*(만원|만|천원|천|원|개월|달|일|회|년)?`),
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(만원|만|천원|천|원|개월|달|일|회|년)?[^\\n]{0,12}${alias}`)
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const raw = `${match[1]}${match[2] || ""}`;
    if (type === "currency") return parseKoreanAmount(raw);
    if (type === "integer") return Math.round(Number(match[1]));
    if (type === "float") return Number(match[1]);
  }
  return null;
}

function fieldAliases(fieldId) {
  return {
    purchasePrice: ["구입가", "결제금액", "가격", "금액", "구매", "샀", "주고 샀"],
    usageFee: ["결제금액", "총 결제", "이용료", "등록비", "회원권", "계약대금"],
    elapsedDays: ["경과", "지난", "이용", "다닌", "사용"],
    totalDays: ["계약", "전체", "총 기간", "이용기간", "1년권", "개월권"],
    usedCount: ["사용", "이용", "들은", "수강", "출석"],
    totalCount: ["전체", "총", "계약", "수업", "횟수"],
    usedMonths: ["개월", "달", "사용"],
    lifeMonths: ["내용연수", "기준 개월", "개월"],
    treatmentCost: ["치료비", "병원비", "진료비"],
    extraCost: ["경비", "교통비", "기타비용"],
    lostIncome: ["일실소득", "휴업손해"]
  }[fieldId] || [];
}

function extractMoneyFromTranscript(transcript, aliases) {
  for (const alias of aliases) {
    const nearby = extractNearbyValue(transcript, alias, "currency");
    if (nearby != null) return nearby;
  }
  return parseKoreanAmount(transcript);
}

function extractCountFromTranscript(transcript, mode) {
  const patterns =
    mode === "used"
      ? [
          /(\d+)\s*회\s*(이용|사용|수강|들었|듣고|썼)/,
          /(\d+)\s*회차?\s*(이용|사용|수강)/
        ]
      : [
          /(\d+)\s*회\s*(권|결제|등록|수업|이용권|패키지)?/,
          /총\s*(\d+)\s*회/
        ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractMonthsFromTranscript(transcript, mode) {
  const patterns =
    mode === "used"
      ? [
          /(\d+(?:\.\d+)?)\s*(개월|달)\s*(썼|사용|이용|다니|지난)/,
          /사용\s*(\d+(?:\.\d+)?)\s*(개월|달)/
        ]
      : [
          /내용연수[는은]?\s*(\d+(?:\.\d+)?)\s*(개월|달)?/,
          /기준\s*(\d+(?:\.\d+)?)\s*(개월|달)/
        ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractDaysFromTranscript(transcript, mode) {
  if (mode === "elapsed") {
    const dayMatch = transcript.match(/(\d+)\s*일\s*(사용|이용|지남|지났|경과)/);
    if (dayMatch) return Number(dayMatch[1]);

    const monthMatch = transcript.match(/(\d+(?:\.\d+)?)\s*(개월|달)\s*(다니|이용|사용|썼|지난)/);
    if (monthMatch) return Math.round(Number(monthMatch[1]) * 30);
  } else {
    const yearMatch = transcript.match(/(\d+(?:\.\d+)?)\s*년\s*(?:권|회원권|계약|등록)/) || transcript.match(/(\d+(?:\.\d+)?)\s*년권/);
    if (yearMatch) return Math.round(Number(yearMatch[1]) * 365);

    const monthMatch = transcript.match(/(\d+(?:\.\d+)?)\s*(개월|달)\s*(권|등록|계약)?/);
    if (monthMatch) return Math.round(Number(monthMatch[1]) * 30);

    const dayMatch = transcript.match(/총\s*(\d+)\s*일/);
    if (dayMatch) return Number(dayMatch[1]);
  }

  return null;
}

function extractFieldValueFromTranscript(transcript, field) {
  if (field.type === "damage-state") return parseDamageState(transcript);

  if (field.id === "purchasePrice" || field.id === "usageFee" || field.id === "remainingFee" || field.id === "treatmentCost" || field.id === "extraCost" || field.id === "lostIncome") {
    return extractMoneyFromTranscript(transcript, fieldAliases(field.id));
  }

  if (field.id === "usedCount") return extractCountFromTranscript(transcript, "used");
  if (field.id === "totalCount") return extractCountFromTranscript(transcript, "total");
  if (field.id === "elapsedDays") return extractDaysFromTranscript(transcript, "elapsed");
  if (field.id === "totalDays") return extractDaysFromTranscript(transcript, "total");
  if (field.id === "usedMonths") return extractMonthsFromTranscript(transcript, "used");
  if (field.id === "lifeMonths") return extractMonthsFromTranscript(transcript, "life");

  const aliases = fieldAliases(field.id);
  for (const alias of aliases) {
    const nearby = extractNearbyValue(transcript, alias, field.type);
    if (nearby != null) return nearby;
  }
  return null;
}

function inferFitnessDuration(values, transcript) {
  if (values.totalDays == null) {
    const years = transcript.match(/(\d+(?:\.\d+)?)\s*년\s*(?:권|회원권|계약|등록)/) || transcript.match(/(\d+(?:\.\d+)?)\s*년권/);
    if (years) values.totalDays = Math.round(Number(years[1]) * 365);
  }
  if (values.totalDays == null) {
    const months = transcript.match(/(\d+(?:\.\d+)?)\s*(개월|달)\s*(권|등록|계약)?/);
    if (months) values.totalDays = Math.round(Number(months[1]) * 30);
  }
  if (values.elapsedDays == null) {
    const elapsed = transcript.match(/(\d+(?:\.\d+)?)\s*(개월|달)\s*(다니|이용|사용|썼|지남)/);
    if (elapsed) values.elapsedDays = Math.round(Number(elapsed[1]) * 30);
  }
  if (values.elapsedDays == null) {
    const inferred = inferElapsedDaysFromTimeline(transcript);
    if (inferred != null) values.elapsedDays = inferred;
  }
}

function inferCountValues(values, transcript) {
  if (values.totalCount == null) {
    const total = transcript.match(/(\d+)\s*회\s*(권|결제|등록|수업|이용)?/);
    if (total) values.totalCount = Number(total[1]);
  }
  if (values.usedCount == null) {
    const used = transcript.match(/(\d+)\s*회\s*(이용|사용|수강|들었|듣고|썼)/);
    if (used) values.usedCount = Number(used[1]);
  }
}

function applyFallbackExtraction(category, rule, transcript, currentValues) {
  const values = { ...(currentValues || {}) };

  for (const field of rule.fields) {
    if (values[field.id] != null && values[field.id] !== "") continue;
    const extracted = extractFieldValueFromTranscript(transcript, field);
    if (extracted != null) values[field.id] = extracted;
  }

  if (category.id === "fitness" && rule.id.includes("period")) {
    inferFitnessDuration(values, transcript);
  }
  if (category.id === "fitness" && rule.id.includes("count")) {
    inferCountValues(values, transcript);
  }

  if (category.id === "smartphone" && rule.id === "smartphone-parts-out-warranty") {
    if (values.usedMonths == null) {
      const used = transcript.match(/(\d+(?:\.\d+)?)\s*(개월|달)\s*(썼|사용|이용)/);
      if (used) values.usedMonths = Number(used[1]);
    }
    if (values.lifeMonths == null) {
      const life = transcript.match(/내용연수[는은]?\s*(\d+(?:\.\d+)?)\s*(개월|달)?/);
      if (life) values.lifeMonths = Number(life[1]);
    }
  }

  return values;
}

function getMissingField(rule, values) {
  return rule.fields.find((field) => values[field.id] == null || values[field.id] === "");
}

function buildUserTranscript(conversation = []) {
  return conversation
    .filter((item) => item?.role === "user" && typeof item.content === "string")
    .map((item) => item.content.trim())
    .filter(Boolean)
    .join("\n");
}

function inferFitnessRuleFromTranscript(transcript, currentRuleId = null) {
  const businessCause = /(폐업|휴업|사업자 사정|센터 사정|운영중단|이전|정원초과|고장)/.test(transcript);
  const countType = /(회|횟수|pt|수업|강습)/.test(transcript);
  const refundIntent = /(환불|해지|중도해지)/.test(transcript);
  const beforeStart = /(시작 전|개시 전|이용 전|첫 수업 전|아직 안|아직 전)/.test(transcript);
  const afterStartByWords = /(개시일 이후|시작 후|이용개시 후|다닌|다니다|이용했|사용했|수강했|출석했|이미 지난|경과)/.test(transcript);
  const inferredElapsedDays = inferElapsedDaysFromTimeline(transcript);
  const afterStart = afterStartByWords || (Number.isFinite(inferredElapsedDays) && inferredElapsedDays > 0);

  if (!businessCause && !refundIntent) return currentRuleId;

  if (beforeStart && !afterStart) {
    return businessCause ? "fitness-business-before-start" : "fitness-consumer-before-start";
  }

  if (afterStart && !beforeStart) {
    if (businessCause) {
      return countType ? "fitness-business-after-start-count" : "fitness-business-after-start-period";
    }
    return countType ? "fitness-consumer-after-start-count" : "fitness-consumer-after-start-period";
  }

  return currentRuleId;
}

function buildMissingFieldQuestion(rule, field, transcript) {
  if (field.id === "elapsedDays") {
    if (/(년|월|일|시작|개시|지금|현재|오늘)/.test(transcript)) {
      return "이용개시일과 환불 요청 시점을 정확한 날짜로 알려주세요. 예: 2026년 1월 4일 시작, 2026년 4월 3일 해지";
    }
    return "언제부터 이용했고 지금이 언제인지 알려주세요. 예: 2026년 1월 시작, 오늘 해지";
  }

  if (field.id === "totalDays") {
    return "계약 기간을 알려주세요. 예: 3개월권, 6개월권, 1년권, 총 180일";
  }

  return rule.fields.find((item) => item.id === field.id)?.question || field.question;
}

function buildRuleClarifier(categoryId) {
  if (categoryId === "fitness") {
    return "헬스·필라테스 건으로 보입니다. 사업자 사정인가요, 소비자 개인사정인가요? 그리고 기간형 계약인지 횟수형 수업인지도 알려주세요.";
  }
  if (categoryId === "smartphone") {
    return "스마트폰 건으로 보입니다. 구입 후 10일 이내 초기불량인지, 품질보증기간 내 수리불가인지, 아니면 품질보증기간이 지난 뒤 부품이 없어 수리가 안 되는지 알려주세요.";
  }
  if (categoryId === "food") {
    return "식품 건으로 보입니다. 단순 환불 사유인지, 병원치료가 필요한 부작용이나 상해인지 알려주세요.";
  }
  return "상황을 조금만 더 자세히 말씀해 주세요.";
}

function buildResultMessage(category, rule, result) {
  return [
    `${category.name} / ${rule.name} 기준으로 판단했습니다.`,
    result.kind === "amount" ? `예상 금액은 ${result.amountLabel}입니다.` : result.summary,
    "계산 근거와 규정 포인트를 함께 확인해 주세요."
  ].join("\n");
}

function safeParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeConversation(history, message) {
  const conversation = Array.isArray(history)
    ? history
        .filter((item) => item && typeof item.content === "string" && item.content.trim())
        .map((item) => ({
          role: item.role === "assistant" ? "assistant" : "user",
          content: item.content.trim()
        }))
    : [];

  if (message) {
    conversation.push({ role: "user", content: message });
  }

  return conversation.slice(-12);
}

async function callOpenAIChat({ conversation, caseState }) {
  if (!OPENAI_API_KEY) return null;

  const catalog = categories.map((category) => ({
    id: category.id,
    name: category.name,
    rules: category.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      fields: rule.fields.map((field) => ({
        id: field.id,
        label: field.label,
        question: field.question,
        type: field.type
      }))
    }))
  }));

  const system = [
    "너는 한국 소비자분쟁 상담 보조 AI다.",
    "반드시 JSON만 반환한다.",
    "역할은 사건에서 품목군, 분쟁유형, 필요한 값, 다음 질문을 구조화하는 것이다.",
    "최종 금액 계산은 서버 규칙 엔진이 수행하므로 계산식을 만들지 말고 필요한 값만 채워라.",
    "새로운 사건이 시작되었다고 판단되면 resetCase를 true로 반환하고, 이전 사건 값은 이어받지 마라.",
    "최신 user 메시지가 직전 assistant 질문에 대한 단답형 답변인지, 아니면 새 사건 설명인지 구분하라.",
    "categoryId와 ruleId는 제공된 catalog의 id만 사용한다.",
    "values는 필요한 값만 채운다.",
    "헬스·피트니스 기간형에서는 '26년 1월 시작', '지금 4월', '1년권', '2개월 다님' 같은 표현을 보고 elapsedDays 또는 totalDays를 최대한 추출하라.",
    "사용자가 시작 시점과 현재 시점을 이미 말했으면 '며칠인지 알려달라'고 다시 묻지 마라.",
    "assistantMessage는 한국어 한두 문장으로 다음 질문 또는 정리 내용을 작성한다.",
    "불확실하면 null을 사용하고 추측하지 마라.",
    "반환 JSON 형식: {\"resetCase\": boolean, \"categoryId\": string|null, \"ruleId\": string|null, \"values\": object, \"assistantMessage\": string}"
  ].join(" ");

  const user = JSON.stringify({
    conversation,
    caseState,
    catalog
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = safeParseJson(content);

  console.log("[openai] raw_content:", content);
  console.log("[openai] parsed_json:", JSON.stringify(parsed));

  return parsed;
}

async function handleChat(body) {
  const message = String(body.message || "").trim();
  const history = Array.isArray(body.history) ? body.history : [];
  const caseState = body.caseState && typeof body.caseState === "object" ? body.caseState : {};
  const conversation = normalizeConversation(history, message);
  const transcript = buildUserTranscript(conversation);

  let nextState = {
    categoryId: caseState.categoryId || null,
    ruleId: caseState.ruleId || null,
    values: caseState.values && typeof caseState.values === "object" ? { ...caseState.values } : {},
    lastQuestion: ""
  };

  let aiData = null;
  let source = OPENAI_API_KEY ? "ai" : "no_api_key";

  const withDisplay = (state) => {
    const category = getCategoryById(state.categoryId);
    const rule = getRuleById(state.categoryId, state.ruleId);
    return {
      ...state,
      categoryName: category ? category.name : null,
      ruleName: rule ? rule.name : null
    };
  };

  if (!OPENAI_API_KEY) {
    nextState.lastQuestion = "서버에 OpenAI API 키가 설정되지 않았습니다.";
    return {
      assistantMessage: nextState.lastQuestion,
      caseState: withDisplay(nextState),
      result: null,
      source
    };
  }

  try {
    aiData = await callOpenAIChat({ conversation, caseState: nextState });
  } catch (error) {
    source = "ai_error";
    nextState.lastQuestion = `AI 호출 실패: ${error.message}`;
    return {
      assistantMessage: nextState.lastQuestion,
      caseState: withDisplay(nextState),
      result: null,
      source
    };
  }

  if (!aiData || typeof aiData !== "object") {
    source = "ai_error";
    nextState.lastQuestion = "AI 응답을 해석하지 못했습니다.";
    return {
      assistantMessage: nextState.lastQuestion,
      caseState: withDisplay(nextState),
      result: null,
      source
    };
  }

  if (aiData.resetCase) {
    nextState = {
      categoryId: null,
      ruleId: null,
      values: {},
      lastQuestion: ""
    };
  }

  if (aiData && getCategoryById(aiData.categoryId)) {
    nextState.categoryId = aiData.categoryId;
  }

  if (aiData && aiData.ruleId && getRuleById(nextState.categoryId, aiData.ruleId)) {
    nextState.ruleId = aiData.ruleId;
  }

  if (nextState.categoryId === "fitness") {
    const inferredRuleId = inferFitnessRuleFromTranscript(transcript, nextState.ruleId);
    if (inferredRuleId && getRuleById(nextState.categoryId, inferredRuleId)) {
      nextState.ruleId = inferredRuleId;
    }
  }

  if (aiData && aiData.values && typeof aiData.values === "object") {
    nextState.values = { ...nextState.values, ...aiData.values };
  }

  const category = getCategoryById(nextState.categoryId);
  if (!category) {
    nextState.lastQuestion = aiData?.assistantMessage || "어느 분야인지 조금 더 구체적으로 알려주세요.";
    return {
      assistantMessage: nextState.lastQuestion,
      caseState: withDisplay(nextState),
      result: null,
      source
    };
  }

  const rule = getRuleById(nextState.categoryId, nextState.ruleId);
  if (!rule) {
    nextState.lastQuestion = aiData?.assistantMessage || "분쟁 유형을 판단하기 위한 정보가 더 필요합니다.";
    return {
      assistantMessage: nextState.lastQuestion,
      caseState: withDisplay(nextState),
      result: null,
      source
    };
  }

  nextState.values = applyFallbackExtraction(category, rule, transcript, nextState.values);

  const missingField = getMissingField(rule, nextState.values);
  if (missingField) {
    nextState.lastQuestion = buildMissingFieldQuestion(rule, missingField, transcript);
    return {
      assistantMessage: nextState.lastQuestion,
      caseState: withDisplay(nextState),
      result: null,
      source
    };
  }

  const result = rule.calculate(nextState.values);
  nextState.lastQuestion = "필요한 사실이 모였습니다.";

  return {
    assistantMessage: buildResultMessage(category, rule, result),
    caseState: withDisplay(nextState),
    result: {
      ...result,
      categoryName: category.name,
      ruleName: rule.name
    },
    source
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(process.cwd(), decodeURIComponent(filePath.split("?")[0]));

  if (!filePath.startsWith(process.cwd())) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentType =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8"
      }[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/api/config")) {
    sendJson(res, 200, {
      debugEnabled: DEBUG_VAR
    });
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/health")) {
    sendJson(res, 200, {
      ok: true,
      model: OPENAI_MODEL,
      hasOpenAIKey: Boolean(OPENAI_API_KEY),
      debugEnabled: DEBUG_VAR
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
      }
    });
    req.on("end", async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const payload = await handleChat(body);
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, 500, {
          error: "server_error",
          message: error.message
        });
      }
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
