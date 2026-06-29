const crypto = require('crypto');
const logger = require('./logger');

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 37, 12, 52, 56, 7,
  0, 57, 39, 55, 59, 13, 40, 1, 38, 24, 54, 26, 21, 16, 25, 11,
  51, 44, 34, 20, 48, 41, 36, 6, 17, 60, 22, 22, 62, 63, 61, 4,
];

let wbiKeys = null;
let wbiFetching = false;
let wbiQueue = [];

function getMixinKey(imgKey, subKey) {
  let mixin = '';
  for (let i = 0; i < 32; i++) mixin += (imgKey + subKey)[MIXIN_KEY_ENC_TAB[i]];
  return mixin;
}

async function fetchWbiKeys(biliFetchFn) {
  if (wbiKeys) return wbiKeys;
  if (wbiFetching) return new Promise(r => wbiQueue.push(r));
  wbiFetching = true;
  try {
    const data = await biliFetchFn('/x/web-interface/nav');
    const img = data.data?.wbi_img;
    if (!img) throw new Error('获取WBI密钥失败');
    const imgKey = img.img_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.png$/, '');
    const subKey = img.sub_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.png$/, '');
    wbiKeys = { imgKey, subKey };
    setTimeout(() => { wbiKeys = null; }, 12 * 60 * 60 * 1000);
    logger.info('WBI 密钥已缓存');
  } finally {
    wbiFetching = false;
    wbiQueue.forEach(r => r());
    wbiQueue = [];
  }
  return wbiKeys;
}

async function wbiSign(params, biliFetchFn) {
  const keys = await fetchWbiKeys(biliFetchFn);
  const mixinKey = getMixinKey(keys.imgKey, keys.subKey);
  const wts = Math.floor(Date.now() / 1000);
  params.wts = wts;
  const sorted = Object.keys(params).sort()
    .map(k => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
  params.w_rid = crypto.createHash('md5').update(sorted + mixinKey).digest('hex');
  return params;
}

function resetKeys() {
  wbiKeys = null;
}

module.exports = { fetchWbiKeys, wbiSign, resetKeys };
