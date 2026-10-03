"use strict";
(() => {
  const local = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const enabled = !local || new URLSearchParams(location.search).get("mode") === "shared";
  const config = window.TOKI_CONFIG;
  const hooks = {};
  const storageKey = `toki-participant-v2:${config?.boardId}`;
  const offlineKey = `toki-offline-v1:${config?.boardId}`;
  let client, token, refreshing = false, online = false, fetchedAt = null;
  const emit = (type, value) => hooks[type]?.(value);
  const error = (message, code) => Object.assign(new Error(message), {code});
  const messages = {
    LINK: "共有URLが無効です。招待された共有URLを開いてください。",
    NAME_TAKEN: "その名前はすでに登録されています。苗字やニックネームなどを加え、別の名前にしてください。",
    NAME_INVALID: "名前は空白以外の文字を使い、40文字以内で入力してください。",
    LIMIT: "参加者が上限の100人に達しています。",
    CONFLICT: "他の人が予定を変更したため保存しませんでした。最新の予定を確認して、もう一度編集してください。",
    UPDATE_REQUIRED: "最新版に更新されています。ページを再読み込みしてください。",
    INVALID: "予定の形式が正しくありません。最新の予定を再取得してください。",
    NETWORK: "通信を確認できませんでした。接続を確認して再度お試しください。"
  };
  function remember() {
    try { localStorage.setItem(storageKey, JSON.stringify({token})); }
    catch { emit("warning", "このブラウザーでは共有URLを記憶できません。次回も共有URLから開いてください。"); }
  }
  const validBoard = board => Number.isSafeInteger(board?.version) && board.version >= 0 && window.TokiModel.valid(board.payload);
  function connection(value) {
    online = value;
    emit('state', {online, fetchedAt});
  }
  function cacheBoard(board) {
    if (!validBoard(board)) throw error(messages.INVALID, 'INVALID');
    // A slow poll must not replace a newer successful save in the offline snapshot.
    const previous = cachedBoard();
    if (previous && previous.version > board.version) return;
    fetchedAt = Date.now();
    try { localStorage.setItem(offlineKey, JSON.stringify({token, board, fetchedAt})); }
    catch { emit('warning', '端末に予定を保存できないため、次回オフラインで閲覧できません。'); }
  }
  function cachedBoard() {
    try {
      const cached = JSON.parse(localStorage.getItem(offlineKey));
      if (cached?.token === token && Number.isFinite(cached.fetchedAt) && validBoard(cached.board)) {
        fetchedAt = cached.fetchedAt;
        return cached.board;
      }
    } catch {}
    return null;
  }
  function forgetCachedBoard() {
    try { if (JSON.parse(localStorage.getItem(offlineKey))?.token === token) localStorage.removeItem(offlineKey); } catch {}
    fetchedAt = null;
  }
  async function request(action, extra = {}) {
    if (!client || !token) throw error(messages.LINK, "LINK");
    if (navigator.onLine === false) throw error(messages.NETWORK, 'NETWORK');
    let result;
    try { result = await client.rpc("toki_share", {p_token:token, p_action:action, ...extra}); }
    catch { throw error(messages.NETWORK, "NETWORK"); }
    if (result.error) {
      const code = Object.hasOwn(messages, result.error.message) ? result.error.message : "NETWORK";
      throw error(messages[code], code);
    }
    return result.data;
  }
  const fetchBoard = () => request("read_availability");
  function accept(board) {
    cacheBoard(board); remember(); emit('board', board); connection(true);
  }
  function failed(failure) {
    if (failure.code === 'LINK') forgetCachedBoard();
    connection(false); emit('error', failure);
  }
  async function refresh() {
    if (!token || refreshing) return;
    refreshing = true;
    try { accept(await fetchBoard()); }
    catch (failure) { failed(failure); }
    finally { refreshing = false; }
  }
  async function initialize(callbacks) {
    Object.assign(hooks, callbacks);
    if (!enabled) return;
    if (!config?.url || !config?.publishableKey) throw error("共有先が設定されていません。", "CONFIG");
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch {}
    const fragment = new URLSearchParams(location.hash.slice(1));
    token = fragment.has("share") ? fragment.get("share") : stored.token;
    if (!/^[a-f0-9]{64}$/.test(token || "")) throw error(messages.LINK, "LINK");
    await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "vendor/supabase.js";
      script.onload = resolve; script.onerror = () => reject(error("共有機能を読み込めません。再読み込みしてください。", "LOAD"));
      document.head.append(script);
    });
    client = window.TokiSupabase.createClient(config.url, config.publishableKey, {auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}});
    setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    window.addEventListener("online", refresh);
    window.addEventListener('offline', () => connection(false));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    try { accept(await fetchBoard()); }
    catch (failure) {
      // A cache is usable only for this exact sharing token, and only on a network failure.
      const cached = failure.code === 'NETWORK' ? cachedBoard() : null;
      if (cached) emit('board', cached);
      failed(failure);
      if (!cached) throw failure;
    }
  }
  async function save(payload, version) {
    if (!online) throw error('オフラインでは閲覧のみです。接続が戻るまでお待ちください。', 'NETWORK');
    try {
      const board = await request(payload.schemaVersion===4?'save_availability':'save_calendar', {p_payload:payload, p_version:version});
      cacheBoard(board); connection(true); return board;
    } catch (failure) {
      if (failure.code !== 'CONFLICT') failed(failure);
      throw failure;
    }
  }
  const shareUrl = () => token ? `${config.siteUrl}#share=${token}` : config.siteUrl;
  window.TokiShared = {enabled, initialize, save, refresh, fetchBoard, shareUrl, get online(){return online;}};
})();
