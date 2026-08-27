const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = __dirname;
const controllerPath = path.join(projectRoot, 'appointment-delete.js');
const gasPath = path.join(projectRoot, '.gas-line-fix', '程式碼.js');

function loadController() {
  assert.equal(fs.existsSync(controllerPath), true, 'appointment-delete.js 尚未建立');
  delete require.cache[require.resolve(controllerPath)];
  return require(controllerPath);
}

function loadGasDelete(overrides = {}) {
  const source = fs.readFileSync(gasPath, 'utf8');
  const start = source.indexOf('function doDelete(data, sheet)');
  const end = source.indexOf('/** =========================', start);
  assert.notEqual(start, -1, '找不到 doDelete');
  assert.notEqual(end, -1, '找不到 doDelete 結尾');
  const context = {
    getRowById: () => null,
    getArchiveSheet_: () => null,
    clearEventsCache: () => {},
    auditLog_: () => {},
    ...overrides
  };
  vm.runInNewContext(source.slice(start, end), context);
  return context.doDelete;
}

test('同一筆刪除尚未完成時不會送出第二個請求', async () => {
  const { createDeleteController } = loadController();
  let resolveRequest;
  let requestCount = 0;
  const busyStates = [];
  const controller = createDeleteController({
    requestDelete: () => {
      requestCount += 1;
      return new Promise(resolve => { resolveRequest = resolve; });
    },
    verifyDeleted: async () => false,
    onBusyChange: (id, busy) => busyStates.push([id, busy])
  });

  const first = controller.run('16891');
  const second = await controller.run('16891');
  assert.equal(requestCount, 1);
  assert.deepEqual(second, { status: 'pending' });

  resolveRequest({ status: 'success' });
  assert.deepEqual(await first, { status: 'deleted', verified: false, alreadyDeleted: false });
  assert.deepEqual(busyStates, [['16891', true], ['16891', false]]);
});

test('回覆中斷但重新查詢已找不到 ID 時視為刪除成功', async () => {
  const { createDeleteController } = loadController();
  const controller = createDeleteController({
    requestDelete: async () => { throw new Error('Failed to fetch'); },
    verifyDeleted: async id => id === '16969',
    onBusyChange: () => {}
  });

  assert.deepEqual(await controller.run('16969'), {
    status: 'deleted', verified: true, alreadyDeleted: false
  });
});

test('刪除按鈕等待期間會停用並顯示處理中', async () => {
  const { installDeleteButton } = loadController();
  let resolveRequest;
  let deletedCount = 0;
  const button = { disabled: false, textContent: '刪除預約', onclick: null };
  installDeleteButton({
    button,
    getId: () => '16473',
    confirmDelete: () => true,
    requestDelete: () => new Promise(resolve => { resolveRequest = resolve; }),
    verifyDeleted: async () => false,
    onDeleted: () => { deletedCount += 1; },
    onFailed: () => assert.fail('不應失敗'),
    onUncertain: () => assert.fail('不應無法確認')
  });

  const running = button.onclick();
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, '刪除中…');
  resolveRequest({ status: 'success' });
  await running;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '刪除預約');
  assert.equal(deletedCount, 1);
});

test('後端重複刪除不存在的 ID 時回覆已完成而不是拋錯', () => {
  const doDelete = loadGasDelete();
  const result = doDelete({ id: '16891' }, {});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'success', alreadyDeleted: true
  });
});

test('主頁使用刪除控制器並檢查後端結果', () => {
  loadController();
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  assert.match(html, /appointment-delete\.js\?v=1/);
  assert.match(html, /installDeleteButton/);
  assert.doesNotMatch(html, /deleteBtn\.onclick\s*=\s*async function/);

  const preview = fs.readFileSync(path.join(projectRoot, 'preview', 'index.html'), 'utf8');
  assert.match(preview, /\.\.\/appointment-delete\.js\?v=1/);
  assert.match(preview, /installDeleteButton/);
  assert.doesNotMatch(preview, /deleteBtn\.onclick\s*=\s*async function/);
});
