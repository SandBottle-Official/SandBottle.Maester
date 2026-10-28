import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Fixtures } from './support/fixtures.ts';
import { scenario } from './support/scenario.ts';
import type { AdaptationOut } from '../src/core/types.ts';

const 命名 = { topic: '測試命名', maester: 'R10_從未有過此類訂閱_建立試用', user: '從未有過此類訂閱時建立試用', why: '規則編號放 describe，名稱只留業務句' };

function adaptations(S: ReturnType<typeof scenario>): AdaptationOut[] {
  const db = S.db();
  try { return db.adaptations(); } finally { db.close(); }
}

describe('照使用者的寫法調整', () => {
  test('記下調整_連同功能與測試與臨時動議', () => {
    const S = scenario();
    const { feature, tests } = S.inTdd();
    const council = [{ who: 'Uncle Bob', text: '名稱讀起來像規格就好' }];
    S.ok(['adapt'], { ...命名, stage: 'green', test: tests[0].id, council });
    assert.deepEqual(adaptations(S).map(a => [a.topic, a.feature, a.test, a.stage, a.council]), [['測試命名', feature, tests[0].id, 'green', council]]);
  });

  test('同主題再調整_保留歷史_show只印最新', () => {
    const S = scenario();
    S.inTdd();
    S.ok(['adapt'], 命名);
    S.ok(['adapt'], { ...命名, maester: 命名.user, user: '已有試用就拒絕', why: '動詞放前面' });
    assert.equal(adaptations(S).length, 2);
    const text = S.ok(['show']);
    assert.match(text, /- 測試命名：已有試用就拒絕（原本：從未有過此類訂閱時建立試用；因為 動詞放前面）/);
    assert.doesNotMatch(text, /原本：R10_/);
  });

  test('跟著repo_換功能也還在', () => {
    const S = scenario();
    S.inTdd();
    S.ok(['adapt'], 命名);
    S.start(Fixtures.門市權限);
    assert.match(S.ok(['show']), /## 使用者的寫法/);
  });

  test('缺原本或使用者的寫法_拒絕', () => {
    const S = scenario();
    S.start();
    S.rejected(['adapt'], { topic: '測試命名', maester: 'x' }, /需要 topic、maester/);
    S.rejected(['adapt'], { ...命名, council: [{ who: 'Fowler' }] }, /council 要是/);
  });
});

describe('網頁上的你的寫法', () => {
  test('view帶出全部調整', () => {
    const S = scenario();
    S.inTdd();
    S.ok(['adapt'], 命名);
    assert.deepEqual(S.view().adaptations.map((a: AdaptationOut) => a.user), [命名.user]);
  });
});
