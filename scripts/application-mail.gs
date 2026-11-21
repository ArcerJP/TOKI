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
    const count = Math.min(20, MailApp.getRemainingDailyQuota());
    for (let index = 0; index < count; index++) {
      const job = rpc('claim');
      if (!job) break;
      const body = [
        job.organization + 'への参加申請が届きました。',
        '',
        '氏名：' + job.name,
        'Googleメールアドレス：' + job.email,
        '',
        'TOKIで申請を確認',
        TOKI_SITE,
        '管理者アカウントで組織を開き、「組織・アカウント」から申請を確認してください。'
      ].join('\n');
      MailApp.sendEmail({to:job.recipient,subject:'【TOKI】組織への参加申請',body,name:'TOKI'});
      properties.setProperty(TOKI_PENDING_ACK, JSON.stringify({p_id:job.id,p_lease:job.lease}));
      confirmDelivery();
    }
  } finally {
    lock.releaseLock();
  }
}
