"use strict";
(() => {
  const local = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const enabled = !local || new URLSearchParams(location.search).get("mode") === "shared";
  const config = window.TOKI_CONFIG;
  const hooks = {};
  const storageKey = `toki-participant-v2:${config?.boardId}`;
  let client, token, registration, participant = null, refreshing = false;
  const emit = (type, value) => hooks[type]?.(value);
  const error = (message, code) => Object.assign(new Error(message), {code});
  const messages = {
    LINK: "共有URLが無効です。招待された共有URLを開いてください。",
    NAME_TAKEN: "その名前はすでに登録されています。苗字やニックネームなどを加え、別の名前にしてください。",
    NAME_INVALID: "名前は空白以外の文字を使い、40文字以内で入力してください。",
    LIMIT: "参加者が上限の100人に達しています。",
    CONFLICT: "他の人が予定を変更したため保存しませんでした。最新の予定を確認して、もう一度編集してください。",
    INVALID: "予定の形式が正しくありません。最新の予定を再取得してください。",
    NETWORK: "通信を確認できませんでした。接続を確認して再度お試しください。"
  };
  function remember() {
    try { localStorage.setItem(storageKey, JSON.stringify({token, registration})); }
    catch { emit("warning", "このブラウザーでは名前を記憶できません。次回は別の名前で参加する必要があります。"); }
  }
  async function request(action, extra = {}) {
    if (!client || !token) throw error(messages.LINK, "LINK");
    let result;
    try { result = await client.rpc("toki_share", {p_token:token, p_registration:registration, p_action:action, ...extra}); }
    catch { throw error(messages.NETWORK, "NETWORK"); }
    if (result.error) {
      const code = Object.hasOwn(messages, result.error.message) ? result.error.message : "NETWORK";
      throw error(messages[code], code);
    }
    return result.data;
  }
  const fetchBoard = () => request("read");
  function accept(board) {
    const next = Number.isInteger(board.person) ? {person:board.person, name:board.payload.people[board.person]} : null;
    if (participant?.person !== next?.person || participant?.name !== next?.name) { participant = next; emit("participant", next); }
    if (participant) emit("board", board);
    else emit("join", null);
  }
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
    registration = stored.token === token && /^[a-f0-9-]{36}$/.test(stored.registration || "") ? stored.registration : crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "vendor/supabase.js";
      script.onload = resolve; script.onerror = () => reject(error("共有機能を読み込めません。再読み込みしてください。", "LOAD"));
      document.head.append(script);
    });
    client = window.TokiSupabase.createClient(config.url, config.publishableKey, {auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}});
    const board = await fetchBoard();
    remember(); accept(board);
    setInterval(() => { if (!document.hidden && participant) refresh(); }, 5000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }
  async function join(name) {
    const normalized = name.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!normalized || normalized.length > 40) throw error(messages.NAME_INVALID, "NAME_INVALID");
    // Save the registration ID before sending so a lost response can safely be retried.
    remember();
    const board = await request("join", {p_name:normalized});
    accept(board);
    return board;
  }
  const save = (payload, version) => request("save", {p_payload:payload, p_version:version});
  const shareUrl = () => token ? `${config.siteUrl}#share=${token}` : config.siteUrl;
  window.TokiShared = {enabled, initialize, join, save, refresh, fetchBoard, shareUrl};
})();
