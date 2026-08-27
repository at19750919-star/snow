(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AppointmentDelete = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createDeleteController(options) {
    const pendingIds = new Set();

    async function run(rawId) {
      const id = String(rawId || '').trim();
      if (!id) return { status: 'failed', message: '缺少預約 ID' };
      if (pendingIds.has(id)) return { status: 'pending' };

      pendingIds.add(id);
      options.onBusyChange(id, true);
      try {
        const response = await options.requestDelete(id);
        if (response && response.status === 'success') {
          return {
            status: 'deleted',
            verified: false,
            alreadyDeleted: response.alreadyDeleted === true
          };
        }

        const verified = await options.verifyDeleted(id);
        if (verified === true) {
          return { status: 'deleted', verified: true, alreadyDeleted: false };
        }
        return {
          status: verified === false ? 'failed' : 'uncertain',
          message: String(response && response.message ? response.message : '後端未確認刪除成功')
        };
      } catch (error) {
        const verified = await options.verifyDeleted(id);
        if (verified === true) {
          return { status: 'deleted', verified: true, alreadyDeleted: false };
        }
        return {
          status: verified === false ? 'failed' : 'uncertain',
          message: String(error && error.message ? error.message : error || '連線失敗')
        };
      } finally {
        pendingIds.delete(id);
        options.onBusyChange(id, false);
      }
    }

    return { run, isPending: id => pendingIds.has(String(id || '').trim()) };
  }

  function installDeleteButton(options) {
    const originalLabel = options.button.textContent;
    const controller = createDeleteController({
      requestDelete: options.requestDelete,
      verifyDeleted: options.verifyDeleted,
      onBusyChange: (id, busy) => {
        options.button.disabled = busy;
        options.button.textContent = busy ? '刪除中…' : originalLabel;
      }
    });

    options.button.onclick = async function () {
      const id = String(options.getId() || '').trim();
      if (!id || !options.confirmDelete()) return;
      const result = await controller.run(id);
      if (result.status === 'deleted') options.onDeleted(id, result);
      else if (result.status === 'failed') options.onFailed(result);
      else if (result.status === 'uncertain') options.onUncertain(result);
      return result;
    };
    return controller;
  }

  return { createDeleteController, installDeleteButton };
});
