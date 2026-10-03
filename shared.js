"use strict";
(() => {
  const local = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const enabled = !local || new URLSearchParams(location.search).get("mode") === "shared";
  let client, session, channel, refreshTimer, authGeneration = 0;
  const config = window.TOKI_CONFIG;
  const hooks = {};
  function emit(type, value) { hooks[type]?.(value); }
  function error(message, code) { return Object.assign(new Error(message), {code}); }
  async function fetchBoard() {
    if (!session) throw error("ログインしてください。", "AUTH");
    const {data, error: failure} = await client.from("toki_boards").select("payload,version").eq("id", config.boardId).maybeSingle();
    if (failure) throw error("共有データを取得できません。接続を確認してください。", "NETWORK");
    if (!data) throw error("このアカウントはメンバー未登録です。管理者に登録を依頼してください。", "MEMBER");
    return data;
  }
  async function subscribe() {
    if (channel) { await client.removeChannel(channel); channel = null; }
    if (!session) return;
    channel = client.channel("toki-board")
      .on("postgres_changes", {event:"UPDATE", schema:"public", table:"toki_boards", filter:`id=eq.${config.boardId}`}, () => refresh())
      .subscribe(status => emit("connection", status === "SUBSCRIBED" ? "接続中" : "再接続中"));
  }
  async function refresh() {
    if (!session) return;
    const generation = authGeneration;
    try { const board = await fetchBoard(); if (generation === authGeneration && session) emit("board", board); }
    catch (failure) { if (generation === authGeneration) emit("error", failure); }
  }
  async function initialize(callbacks) {
    Object.assign(hooks, callbacks);
    if (!enabled) return;
    if (!config?.url || !config?.publishableKey) throw error("共有先が設定されていません。", "CONFIG");
    // Bundled locally; no third-party script is fetched at login time.
    await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "vendor/supabase.js";
      script.onload = resolve; script.onerror = () => reject(error("ログイン機能を読み込めません。再読み込みしてください。", "LOAD"));
      document.head.append(script);
    });
    client = window.TokiSupabase.createClient(config.url, config.publishableKey);
    const initial = await client.auth.getSession();
    if (initial.error) throw error("ログイン状態を確認できません。再読み込みしてください。", "AUTH");
    session = initial.data.session;
    emit("auth", session?.user ?? null);
    client.auth.onAuthStateChange((event, next) => {
      const previousUser = session?.user?.id; session = next;
      if (previousUser !== next?.user?.id || event === "SIGNED_OUT") {
        authGeneration++; emit("auth", next?.user ?? null);
        setTimeout(() => { subscribe(); refresh(); }, 0);
      }
    });
    await subscribe();
    if (session) await refresh();
    refreshTimer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }
  async function signIn(email, password) {
    if (!client) throw error("ログイン機能を準備中です。少し待ってからお試しください。", "LOAD");
    const {error: failure} = await client.auth.signInWithPassword({email, password});
    if (failure) throw error("ログインできません。登録済みのメールアドレスとパスワードを確認してください。", "AUTH");
  }
  async function signOut() {
    if (!client) return;
    const {error: failure} = await client.auth.signOut({scope:"local"});
    if (failure) throw error("ログアウトできませんでした。接続を確認して再度お試しください。", "AUTH");
  }
  async function save(payload, version) {
    if (!session) throw error("ログインし直してください。", "AUTH");
    const generation = authGeneration;
    const {data, error: failure} = await client.from("toki_boards").update({payload}).eq("id", config.boardId).eq("version", version).select("payload,version").maybeSingle();
    if (generation !== authGeneration || !session) throw error("ログイン状態が変わりました。ログインし直してください。", "AUTH");
    if (failure) throw error("保存を確認できませんでした。最新の予定を再取得して確認してください。", "NETWORK");
    if (!data) throw error("他の人が予定を変更したため保存しませんでした。最新の予定を確認して、もう一度編集してください。", "CONFLICT");
    return data;
  }
  window.TokiShared = {enabled, initialize, signIn, signOut, save, refresh, fetchBoard};
})();
