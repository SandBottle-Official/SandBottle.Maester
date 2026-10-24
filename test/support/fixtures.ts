export const Fixtures = {
  客戶訂閱: '客戶訂閱',
  門市權限: '門市權限',
  計畫: [
    { title: '測試基礎建設', tests: ['ConfigureServices', 'Scenario'] },
    { title: 'GrantPromotionalSubscription（R10～R12）', tests: ['R10_從未有過此類訂閱_建立試用', 'R11_已有試用_拒絕', 'R12_已有正式訂閱_拒絕'] },
  ],
};

export type PlannedTask = { title: string; tests: string[] };
