"use strict";
(() => {
  const local = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const enabled = !local || new URLSearchParams(location.search).get("mode") === "shared";
  const config = window.TOKI_CONFIG;
  const hooks = {};
  const storageKey = `toki-participant-v2:${config?.boardId}`;
  let client, token, refreshing = false;
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
  async function request(action, extra = {}) {
    if (!client || !token) throw error(messages.LINK, "LINK");
    let result;
    try { result = await client.rpc("toki_share", {p_token:token, p_action:action, ...extra}); }
    catch { throw error(messages.NETWORK, "NETWORK"); }
    if (result.error) {
      const code = Object.hasOwn(messages, result.error.message) ? result.error.message : "NETWORK";
      throw error(messages[code], code);
    }
    return result.data;
  }
  const fetchBoard = () => request("read");
  const accept = board => emit("board", board);
  async function refresh() {
    if (!token || refreshing) return;
    refreshing = true;
    try { accept(await fetchBoard()); emit("connection", "接続中"); }
    catch (failure) { emit("error", failure); }
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
    const board = await fetchBoard();
    remember(); accept(board);
    setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }
  const save = (payload, version) => request("save_grouped", {p_payload:payload, p_version:version});
  const shareUrl = () => token ? `${config.siteUrl}#share=${token}` : config.siteUrl;
  window.TokiShared = {enabled, initialize, save, refresh, fetchBoard, shareUrl};
})();
