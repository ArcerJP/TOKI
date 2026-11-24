// Paste this file into a standalone Apps Script owned by the TOKI sender.
// Set TOKI_SUPABASE_URL and TOKI_PUBLISHABLE_KEY in Script Properties.
const TOKI_SITE = 'https://arcerjp.github.io/TOKI/';
const TOKI_WORKER_KEY = 'TOKI_MAIL_WORKER_KEY';
const TOKI_PENDING_ACK = 'TOKI_MAIL_PENDING_ACK';

function setupTokiApplicationMail() {
  const properties = PropertiesService.getScriptProperties();
  getTokiMailConfig(properties);
  let key = properties.getProperty(TOKI_WORKER_KEY);
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    properties.setProperty(TOKI_WORKER_KEY, key);
  }
  MailApp.getRemainingDailyQuota();
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8);
  console.log('TOKI worker SHA-256: ' + hash.map(byte => (byte & 255).toString(16).padStart(2, '0')).join(''));
}

function startTokiApplicationMail() {
  const properties = PropertiesService.getScriptProperties();
  getTokiMailConfig(properties);
  if (!properties.getProperty(TOKI_WORKER_KEY)) throw new Error('Run setupTokiApplicationMail first.');
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'sendTokiApplications')) {
    ScriptApp.newTrigger('sendTokiApplications').timeBased().everyMinutes(5).create();
  }
  sendTokiApplications();
}

function getTokiMailConfig(properties) {
  const url = (properties.getProperty('TOKI_SUPABASE_URL') || '').replace(/\/$/, '');
  const publishableKey = properties.getProperty('TOKI_PUBLISHABLE_KEY');
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !publishableKey?.startsWith('sb_publishable_')) {
    throw new Error('Set the project URL and publishable key in Script Properties.');
  }
  return {url, publishableKey};
}

function formatTokiMail(job) {
  const organization = job.organization;
  const actionUrl = job.company && job.related
    ? TOKI_SITE + '?organization=' + encodeURIComponent(job.company) + '&review=' + encodeURIComponent(job.related)
    : TOKI_SITE;
  switch (job.kind) {
    case 'promotion':
      return {subject:'【TOKI】新しい管理者',lines:[
        organization + 'の管理者に ' + job.label + ' が追加されました。',
        '就任から7日間、対象の管理操作は翌朝のまとめ通知からレビューできます。',TOKI_SITE]};
    case 'demotion':
      return {subject:'【TOKI】管理者権限の変更を確認',lines:[
        organization + 'で管理者から一般メンバーに変更されました。',
        '以下からGoogleでログインし、変更を確認してください。変更から7日以内は同じアカウントで管理者に復帰できます。',actionUrl]};
    case 'review':
      return {subject:'【TOKI】新任管理者の操作まとめ',lines:[
        organization + 'の ' + job.day + ' の変更一覧です。'+(job.label?' 操作者：'+job.label:''),
        ...(job.items || []).map(item=>'・'+item),
        'このメールの通知から24時間以内に、TOKIでこの日の変更を一括拒否できます。拒否がなければ反映します。',actionUrl]};
    case 'rename':
      return {subject:'【TOKI】名前の変更依頼',lines:[
        organization + 'で名前の変更依頼が届きました。',job.old_name + ' → ' + job.new_name,
        '以下で対象の組織を開き、「承認」で反映できます。',actionUrl]};
    default:
      return {subject:'【TOKI】組織への参加申請',lines:[
        organization + 'への参加申請が届きました。','', '氏名：' + job.name,
        'Googleメールアドレス：' + job.email,'','TOKIで申請を確認',TOKI_SITE,
        '管理者アカウントで組織を開き、「アカウント」から申請を確認してください。']};
  }
}

function sendTokiApplications() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const config = getTokiMailConfig(properties);
    const key = properties.getProperty(TOKI_WORKER_KEY);
    const rpc = (action, extra = {}) => {
      const response = UrlFetchApp.fetch(config.url + '/rest/v1/rpc/toki_application_mail', {
        method:'post', contentType:'application/json', headers:{apikey:config.publishableKey},
        payload:JSON.stringify({p_key:key,p_action:action,...extra}), muteHttpExceptions:true
      });
      if (response.getResponseCode() !== 200) throw new Error('TOKI mail request returned HTTP ' + response.getResponseCode());
      return JSON.parse(response.getContentText());
    };
    const confirmDelivery = () => {
      const pending = properties.getProperty(TOKI_PENDING_ACK);
      if (!pending) return;
      rpc('ack', JSON.parse(pending));
      properties.deleteProperty(TOKI_PENDING_ACK);
    };
    confirmDelivery();
    rpc('sweep');
    const count = Math.min(20, MailApp.getRemainingDailyQuota());
    for (let index = 0; index < count; index++) {
      const job = rpc('claim_v2');
      if (!job) break;
      const mail = formatTokiMail(job);
      MailApp.sendEmail({to:job.recipient,subject:mail.subject,body:mail.lines.join('\n'),name:'TOKI'});
      properties.setProperty(TOKI_PENDING_ACK, JSON.stringify({p_id:job.id,p_lease:job.lease}));
      confirmDelivery();
    }
  } finally {
    lock.releaseLock();
  }
}
