const test = require("node:test");
const assert = require("node:assert/strict");

function mockFetchWith(aiPayload) {
  return async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(aiPayload)
          }
        }
      ]
    })
  });
}

function loadServerWith(aiPayload) {
  process.env.OPENAI_API_KEY = "test-key";
  const modulePath = require.resolve("../server");
  delete require.cache[modulePath];
  global.fetch = mockFetchWith(aiPayload);
  return require("../server");
}

test("fee alone should not finalize a fitness refund calculation", async () => {
  const server = loadServerWith({
    resetCase: false,
    categoryId: "fitness",
    ruleId: "fitness-consumer-before-start",
    values: { usageFee: 2000000 },
    assistantMessage: "총 결제금액이 얼마였나요?"
  });

  const response = await server.handleChat({
    message: "200만원",
    history: [{ role: "user", content: "헬스장 환불" }],
    caseState: {
      categoryId: null,
      ruleId: null,
      values: {}
    }
  });

  assert.equal(response.result, null);
  assert.equal(response.caseState.categoryId, "fitness");
  assert.equal(response.caseState.ruleId, null);
  assert.equal(response.caseState.values.usageFee, 2000000);
  assert.match(response.assistantMessage, /사업자 사정|소비자 개인사정/);
  assert.match(response.assistantMessage, /이용 시작 전|이미 시작 후/);
});

test("explicit before-start fitness refund can still calculate", async () => {
  const server = loadServerWith({
    resetCase: false,
    categoryId: "fitness",
    ruleId: "fitness-consumer-before-start",
    values: { usageFee: 2000000 },
    assistantMessage: "..."
  });

  const response = await server.handleChat({
    message: "소비자 개인사정이고 아직 시작 전이에요",
    history: [{ role: "user", content: "헬스장 환불 200만원" }],
    caseState: {
      categoryId: "fitness",
      ruleId: null,
      values: { usageFee: 2000000 }
    }
  });

  assert.ok(response.result);
  assert.equal(response.caseState.ruleId, "fitness-consumer-before-start");
  assert.equal(response.result.amount, 1800000);
});

test("after-start period refund overrides a wrong AI rule once dates are explicit", async () => {
  const server = loadServerWith({
    resetCase: false,
    categoryId: "fitness",
    ruleId: "fitness-consumer-before-start",
    values: {},
    assistantMessage: "..."
  });

  const response = await server.handleChat({
    message: "소비자 개인사정이고 이미 시작했고 1년권이에요. 2026년 1월 4일 시작, 2026년 4월 3일 해지예요.",
    history: [
      { role: "user", content: "헬스장 환불" },
      { role: "user", content: "200만원" }
    ],
    caseState: {
      categoryId: "fitness",
      ruleId: null,
      values: { usageFee: 2000000 }
    }
  });

  assert.ok(response.result);
  assert.equal(response.caseState.ruleId, "fitness-consumer-after-start-period");
  assert.equal(response.caseState.values.totalDays, 365);
  assert.equal(response.caseState.values.elapsedDays, 89);
  assert.equal(response.result.amountLabel, "₩1,312,329");
});
