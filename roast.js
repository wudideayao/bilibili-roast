// ========== 毒舌锐评引擎（服务端版） ==========

function fmt(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

function generateRoast(data) {
  const { name, fans, totalViews, totalLikes, level, sign, following, videoCount } = data;

  const likeViewRatio = totalViews > 0 ? totalLikes / totalViews : 0;
  const fanViewRatio = fans > 0 ? totalViews / fans : 0;
  let grade, title, roasts, details, tags;

  if (fans >= 1000000) {
    grade = 'S'; title = '百大UP主 👑';
    roasts = [
      '百大UP主「' + name + '」是吧？建议把"B站是我家"刻在脑门上。',
      '粉丝' + fmt(fans) + '，平均每个视频够开一场线下见面会了。',
      '你的视频我看过，确实牛逼——但下次能不能别再标题党了？',
    ];
    details = ['粉丝' + fmt(fans) + '、总播放' + fmt(totalViews) + '，数据碾压99%的UP主。但越是顶流，翻车的时候摔得越惨。', '内容质量有目共睹，建议少接点商单，多做点好内容。'];
    tags = ['👑 百大', '🔥 顶流', '💰 不缺钱'];
  } else if (fans >= 100000) {
    grade = 'A'; title = '知名UP主 ✨';
    roasts = [
      '「' + name + '」——在B站也算个名人了，虽然出了B站没人认识你。',
      '粉丝' + fmt(fans) + '，按B站人均粉丝算法，你相当于一个小县城的人口。',
      '你的视频质量还行，就是更新频率像极了甲方催稿前的你。',
    ];
    details = [fmt(fans) + '粉丝，在B站属于中上层。但' + (level < 6 ? '等级才Lv.'+level+'，混了这么久还没满级' : '等级Lv.'+level+'，老玩家了') + '，懂我意思吧？'];
    tags = ['📈 小有名气', '🎬 质量还行', '⏰ 爱更不更'];
  } else if (fans >= 10000) {
    grade = 'B'; title = '万粉UP主 😏';
    roasts = [
      fmt(fans) + '粉丝，勉强够在B站要个认证了——虽然也没啥用。',
      '「' + name + '」—— 一万个人关注了你，但其中至少有2000是僵尸粉。',
      '粉丝' + fmt(fans) + '，播放' + fmt(totalViews) + '，数据还行但离起飞总差一口气。',
    ];
    details = [fmt(fans) + '粉丝·' + fmt(totalViews) + '播放。数据还行，但离起飞总差那么一口气。', '建议学学别人的标题怎么起的——你现在的标题跟论文题目似的。'];
    tags = ['🌱 万粉', '📊 有数据', '🚀 差一口气'];
  } else if (fans >= 1000) {
    grade = 'C'; title = '千粉小UP 🥬';
    roasts = [
      fmt(fans) + '粉，恭喜你已经超越了B站80%的注册用户——另外20%是注册完就没登录过的。',
      '等级Lv.' + level + '，粉丝' + fmt(fans) + '——你这个号像极了我的健身卡，办了但没完全用。',
      '总播放' + fmt(totalViews) + '，' + fmt(fans) + '个粉丝，建议先定个小目标。',
    ];
    details = [fmt(fans) + '粉丝，在B站算刚起步。' + (sign.length > 20 ? '简介写了一大串但没什么人看' : '简介比你的播放量还短') + '。', '建议先定个小目标：让粉丝数超过你关注的人数（' + fmt(following) + '）。'];
    tags = ['🌱 千粉', '💪 还在努力', '📺 小UP主'];
  } else if (fans >= 100) {
    grade = 'D'; title = '百粉透明 💀';
    roasts = [
      fmt(fans) + '粉，说好听点叫"小而美"，说难听点就是没人看。',
      '「' + name + '」你的视频播放量加起来，还没你B站首页推荐的一个零头多。',
      fmt(fans) + '个粉丝——B站的推荐算法可能真的不认识你。',
    ];
    details = ['数据惨淡但别灰心——谁还不是从0开始的呢？建议检查一下标题、封面、内容三个核心要素。', level === 0 ? '注册了这么久还是Lv.0，你到底是来发视频的还是来看视频的？' : '等级Lv.'+level+'，还有很长的路要走。'];
    tags = ['👻 透明人', '📉 数据惨淡', '💀 算法不认识'];
  } else {
    grade = 'F'; title = '建议注销 🔥';
    roasts = [
      fmt(fans) + '个粉丝——你管这叫UP主？',
      '「' + name + '」你的账号像被遗弃的QQ空间，注册了就再也没管过。',
      'B站服务器为你浪费了存储空间，建议你交点电费。',
    ];
    details = ['要么刚注册，要么放弃治疗了。不管是哪种，这个锐评就是你账号的全部高光时刻。'];
    tags = ['🗑️ 空账号', '💤 已弃坑', '🤷 来都来了'];
  }

  var extraDetails = [];
  if (fanViewRatio > 0 && fanViewRatio < 5 && fans > 100) extraDetails.push('总播放' + fmt(totalViews) + '，连粉丝数的' + Math.round(fanViewRatio) + '倍都不到——你的粉丝自己都不看你的视频。');
  if (likeViewRatio > 0 && likeViewRatio < 0.02) extraDetails.push('点赞率' + (likeViewRatio*100).toFixed(1) + '%，观众连点个赞都懒得动手指。');
  if (level >= 5 && fans < 1000) extraDetails.push('等级Lv.' + level + '才' + fmt(fans) + '粉——你是在B站养老吗？');
  if (following > 1000) extraDetails.push('关注了' + fmt(following) + '个人，你这是逛B站还是逛菜市场？');
  if (sign.indexOf('商务') !== -1 || sign.indexOf('合作') !== -1 || sign.indexOf('微信') !== -1) extraDetails.push('简介放了联系方式，一看就是想恰饭的。');
  if (sign.indexOf('学生') !== -1 || sign.indexOf('大学生') !== -1) extraDetails.push('学生UP主，懂了——时间多但不想更。');
  if (videoCount > 0 && videoCount < 5) extraDetails.push('才发了' + videoCount + '个视频，你搁这玩呢？');
  if (videoCount > 200) extraDetails.push('发了' + videoCount + '个视频，粉丝才' + fmt(fans) + '——高产似那啥，质量堪忧。');

  if (extraDetails.length > 0) {
    details.push(extraDetails[Math.floor(Math.random() * extraDetails.length)]);
  }

  var extraTags = [];
  if (level >= 6) extraTags.push('🏆 Lv.6大佬');
  if (fans > following) extraTags.push('📈 粉丝>关注');
  if (likeViewRatio > 0.05) extraTags.push('👍 点赞率高');
  if (sign.length > 100) extraTags.push('📝 小作文简介');
  if (sign === '' || sign === '这个人很懒，什么都没写') extraTags.push('😴 懒人简介');

  return {
    grade: grade, title: title,
    roast: roasts[Math.floor(Math.random() * roasts.length)],
    detail: details[Math.floor(Math.random() * details.length)],
    tags: tags.concat(extraTags).slice(0, 6),
  };
}

module.exports = { generateRoast, fmt };
