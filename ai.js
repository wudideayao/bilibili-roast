const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const logger = require('./logger');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || (function() {
  try {
    var raw = fs.readFileSync('/opt/deepseek_key', 'utf8').trim();
    var parts = raw.split(':');
    if (parts.length !== 2) return '';
    var decKey = crypto.createHash('sha256').update('bilibili-roast-ds-key-v1').digest();
    var decipher = crypto.createDecipheriv('aes-256-cbc', decKey, Buffer.from(parts[0], 'hex'));
    var dec = decipher.update(parts[1], 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch (e) { return ''; }
})();

async function generateDeepSeekRoast(data) {
  if (!DEEPSEEK_KEY) {
    logger.warn('DeepSeek API Key 未配置，跳过 AI 锐评');
    return null;
  }

  const prompt = '根据以下B站UP主数据写一段毒舌点评（30-60字）：\n'
    + '名称：' + data.name + '\n粉丝：' + data.fans
    + '\n总播放：' + data.totalViews + '\n总点赞：' + data.totalLikes
    + '\n视频数：' + data.videoCount + '\n等级：Lv.' + data.level
    + '\n简介：' + (data.sign || '无')
    + '\n' + (data.videos && data.videos.length > 0
      ? '最近视频：' + data.videos.slice(0, 3).map(v => v.title).join('、')
      : '');

  return new Promise(function(r) {
    var body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是B站锐评机器人。每次回复风格都不同，犀利幽默。直接输出点评，不要前缀，不要Emoji。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.95, max_tokens: 200,
    });
    var opts = {
      hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_KEY },
    };
    var req = https.request(opts, function(res) {
      var d = ''; res.on('data', function(c) { d += c; });
      res.on('end', function() {
        try {
          var content = JSON.parse(d).choices?.[0]?.message?.content?.trim() || null;
          if (content) logger.info('AI 锐评生成成功');
          else logger.warn('AI 锐评返回为空');
          r(content);
        } catch(e) {
          logger.error('AI 锐评解析失败: ' + e.message);
          r(null);
        }
      });
    });
    req.on('error', function(e) {
      logger.error('AI 锐评请求失败: ' + e.message);
      r(null);
    });
    req.write(body); req.end();
  });
}

module.exports = { generateDeepSeekRoast };
