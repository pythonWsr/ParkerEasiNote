/* ============================================================
   英汉字典（离线精选词库 + 双向检索 + AI 兜底）
   ============================================================ */
(function(){
  var S = window.EN10Subjects;
  var esc = S._esc;

  /* word|phonetic|meaning —— 覆盖课堂高频词与日常基础词 */
  var RAW = [
    /* 学习与学校 */
    'school|skuːl|n. 学校','classroom|ˈklɑːsruːm|n. 教室','teacher|ˈtiːtʃə|n. 教师','student|ˈstjuːdnt|n. 学生',
    'pupil|ˈpjuːpl|n. 小学生；瞳孔','lesson|ˈlesn|n. 课；教训','class|klɑːs|n. 班级；课','subject|ˈsʌbdʒɪkt|n. 科目；主题',
    'homework|ˈhəʊmwɜːk|n. 家庭作业','exam|ɪɡˈzæm|n. 考试','test|test|n./v. 测验','grade|ɡreɪd|n. 年级；分数',
    'book|bʊk|n. 书','notebook|ˈnəʊtbʊk|n. 笔记本','pen|pen|n. 钢笔','pencil|ˈpensl|n. 铅笔','eraser|ɪˈreɪzə|n. 橡皮',
    'ruler|ˈruːlə|n. 尺子','bag|bæɡ|n. 包','desk|desk|n. 书桌','chair|tʃeə|n. 椅子','blackboard|ˈblækbɔːd|n. 黑板',
    'library|ˈlaɪbrəri|n. 图书馆','playground|ˈpleɪɡraʊnd|n. 操场','office|ˈɒfɪs|n. 办公室','bell|bel|n. 铃；钟',
    'dictionary|ˈdɪkʃənri|n. 字典','paper|ˈpeɪpə|n. 纸；论文','question|ˈkwestʃən|n. 问题','answer|ˈɑːnsə|n./v. 回答',
    'example|ɪɡˈzɑːmpl|n. 例子','exercise|ˈeksəsaɪz|n. 练习','knowledge|ˈnɒlɪdʒ|n. 知识','study|ˈstʌdi|v./n. 学习',
    'read|riːd|v. 阅读','write|raɪt|v. 写','listen|ˈlɪsn|v. 听','speak|spiːk|v. 说','learn|lɜːn|v. 学习',
    'teach|tiːtʃ|v. 教','think|θɪŋk|v. 想；认为','remember|rɪˈmembə|v. 记得','forget|fəˈɡet|v. 忘记',
    'understand|ˌʌndəˈstænd|v. 理解','explain|ɪkˈspleɪn|v. 解释','practice|ˈpræktɪs|n./v. 练习','review|rɪˈvjuː|v. 复习',
    /* 学科 */
    'Chinese|ˌtʃaɪˈniːz|n. 语文；中文','English|ˈɪŋɡlɪʃ|n. 英语','math|mæθ|n. 数学','science|ˈsaɪəns|n. 科学',
    'physics|ˈfɪzɪks|n. 物理','chemistry|ˈkemɪstri|n. 化学','biology|baɪˈɒlədʒi|n. 生物','history|ˈhɪstri|n. 历史',
    'geography|dʒiˈɒɡrəfi|n. 地理','music|ˈmjuːzɪk|n. 音乐','art|ɑːt|n. 美术；艺术','PE|ˌpiː ˈiː|n. 体育',
    /* 人与家庭 */
    'friend|frend|n. 朋友','family|ˈfæməli|n. 家庭','father|ˈfɑːðə|n. 父亲','mother|ˈmʌðə|n. 母亲',
    'brother|ˈbrʌðə|n. 兄弟','sister|ˈsɪstə|n. 姐妹','grandfather|ˈɡrænfɑːðə|n. 祖父','grandmother|ˈɡrænmʌðə|n. 祖母',
    'boy|bɔɪ|n. 男孩','girl|ɡɜːl|n. 女孩','man|mæn|n. 男人','woman|ˈwʊmən|n. 女人','child|tʃaɪld|n. 孩子',
    'people|ˈpiːpl|n. 人们','doctor|ˈdɒktə|n. 医生','nurse|nɜːs|n. 护士','farmer|ˈfɑːmə|n. 农民','worker|ˈwɜːkə|n. 工人',
    /* 时间 */
    'time|taɪm|n. 时间','day|deɪ|n. 天','week|wiːk|n. 周','month|mʌnθ|n. 月','year|jɪə|n. 年',
    'today|təˈdeɪ|n./adv. 今天','tomorrow|təˈmɒrəʊ|n./adv. 明天','yesterday|ˈjestədeɪ|n./adv. 昨天',
    'morning|ˈmɔːnɪŋ|n. 早上','afternoon|ˌɑːftəˈnuːn|n. 下午','evening|ˈiːvnɪŋ|n. 傍晚','night|naɪt|n. 夜晚',
    'Monday|ˈmʌndeɪ|n. 星期一','Tuesday|ˈtjuːzdeɪ|n. 星期二','Wednesday|ˈwenzdeɪ|n. 星期三','Thursday|ˈθɜːzdeɪ|n. 星期四',
    'Friday|ˈfraɪdeɪ|n. 星期五','Saturday|ˈsætədeɪ|n. 星期六','Sunday|ˈsʌndeɪ|n. 星期日',
    'spring|sprɪŋ|n. 春天','summer|ˈsʌmə|n. 夏天','autumn|ˈɔːtəm|n. 秋天','winter|ˈwɪntə|n. 冬天',
    'hour|ˈaʊə|n. 小时','minute|ˈmɪnɪt|n. 分钟','second|ˈsekənd|n. 秒；第二',
    /* 天气与自然 */
    'weather|ˈweðə|n. 天气','sunny|ˈsʌni|adj. 晴朗的','rain|reɪn|n./v. 雨；下雨','rainy|ˈreɪni|adj. 下雨的',
    'snow|snəʊ|n./v. 雪；下雪','wind|wɪnd|n. 风','cloud|klaʊd|n. 云','cloudy|ˈklaʊdi|adj. 多云的',
    'sun|sʌn|n. 太阳','moon|muːn|n. 月亮','star|stɑː|n. 星星','sky|skaɪ|n. 天空','earth|ɜːθ|n. 地球；土壤',
    'mountain|ˈmaʊntən|n. 山','river|ˈrɪvə|n. 河流','lake|leɪk|n. 湖','sea|siː|n. 海','forest|ˈfɒrɪst|n. 森林',
    'tree|triː|n. 树','flower|ˈflaʊə|n. 花','grass|ɡrɑːs|n. 草','leaf|liːf|n. 叶子','water|ˈwɔːtə|n. 水',
    /* 颜色与数字 */
    'red|red|adj. 红色的','blue|bluː|adj. 蓝色的','green|ɡriːn|adj. 绿色的','yellow|ˈjeləʊ|adj. 黄色的',
    'black|blæk|adj. 黑色的','white|waɪt|adj. 白色的','orange|ˈɒrɪndʒ|n. 橙子；橙色','purple|ˈpɜːpl|adj. 紫色的',
    'brown|braʊn|adj. 棕色的','pink|pɪŋk|adj. 粉色的','one|wʌn|num. 一','two|tuː|num. 二','three|θriː|num. 三',
    'four|fɔː|num. 四','five|faɪv|num. 五','six|sɪks|num. 六','seven|ˈsevn|num. 七','eight|eɪt|num. 八',
    'nine|naɪn|num. 九','ten|ten|num. 十','hundred|ˈhʌndrəd|num. 百','thousand|ˈθaʊznd|num. 千',
    /* 动物 */
    'animal|ˈænɪml|n. 动物','cat|kæt|n. 猫','dog|dɒɡ|n. 狗','bird|bɜːd|n. 鸟','fish|fɪʃ|n. 鱼',
    'horse|hɔːs|n. 马','cow|kaʊ|n. 奶牛','sheep|ʃiːp|n. 羊','pig|pɪɡ|n. 猪','rabbit|ˈræbɪt|n. 兔子',
    'tiger|ˈtaɪɡə|n. 老虎','lion|ˈlaɪən|n. 狮子','monkey|ˈmʌŋki|n. 猴子','elephant|ˈelɪfənt|n. 大象','panda|ˈpændə|n. 熊猫',
    /* 食物 */
    'food|fuːd|n. 食物','rice|raɪs|n. 米饭','bread|bred|n. 面包','noodle|ˈnuːdl|n. 面条','egg|eɡ|n. 蛋',
    'milk|mɪlk|n. 牛奶','apple|ˈæpl|n. 苹果','banana|bəˈnɑːnə|n. 香蕉','pear|peə|n. 梨','grape|ɡreɪp|n. 葡萄',
    'meat|miːt|n. 肉','vegetable|ˈvedʒtəbl|n. 蔬菜','fruit|fruːt|n. 水果','breakfast|ˈbrekfəst|n. 早餐',
    'lunch|lʌntʃ|n. 午餐','dinner|ˈdɪnə|n. 晚餐','tea|tiː|n. 茶','juice|dʒuːs|n. 果汁','cake|keɪk|n. 蛋糕',
    /* 身体 */
    'head|hed|n. 头','hair|heə|n. 头发','face|feɪs|n. 脸','eye|aɪ|n. 眼睛','ear|ɪə|n. 耳朵','nose|nəʊz|n. 鼻子',
    'mouth|maʊθ|n. 嘴','hand|hænd|n. 手','foot|fʊt|n. 脚','leg|leɡ|n. 腿','arm|ɑːm|n. 手臂','heart|hɑːt|n. 心脏',
    /* 动作 */
    'go|ɡəʊ|v. 去','come|kʌm|v. 来','run|rʌn|v. 跑','walk|wɔːk|v. 走','jump|dʒʌmp|v. 跳','swim|swɪm|v. 游泳',
    'sing|sɪŋ|v. 唱歌','dance|dɑːns|v. 跳舞','draw|drɔː|v. 画','play|pleɪ|v. 玩；演奏','eat|iːt|v. 吃','drink|drɪŋk|v. 喝',
    'sleep|sliːp|v. 睡觉','wake|weɪk|v. 醒来','open|ˈəʊpən|v. 打开','close|kləʊz|v. 关闭','give|ɡɪv|v. 给',
    'take|teɪk|v. 拿；带','make|meɪk|v. 制作','find|faɪnd|v. 找到','help|help|v./n. 帮助','use|juːz|v. 使用',
    'start|stɑːt|v. 开始','finish|ˈfɪnɪʃ|v. 完成','try|traɪ|v. 尝试','work|wɜːk|v./n. 工作','like|laɪk|v. 喜欢',
    'love|lʌv|v./n. 爱','want|wɒnt|v. 想要','need|niːd|v. 需要','know|nəʊ|v. 知道','see|siː|v. 看见',
    'look|lʊk|v. 看','watch|wɒtʃ|v. 观看','hear|hɪə|v. 听见','say|seɪ|v. 说','tell|tel|v. 告诉','ask|ɑːsk|v. 问',
    /* 形容词与副词 */
    'good|ɡʊd|adj. 好的','bad|bæd|adj. 坏的','big|bɪɡ|adj. 大的','small|smɔːl|adj. 小的','long|lɒŋ|adj. 长的',
    'short|ʃɔːt|adj. 短的；矮的','tall|tɔːl|adj. 高的','new|njuː|adj. 新的','old|əʊld|adj. 老的；旧的',
    'happy|ˈhæpi|adj. 快乐的','sad|sæd|adj. 悲伤的','angry|ˈæŋɡri|adj. 生气的','tired|ˈtaɪəd|adj. 疲倦的',
    'busy|ˈbɪzi|adj. 忙碌的','easy|ˈiːzi|adj. 容易的','difficult|ˈdɪfɪkəlt|adj. 困难的','important|ɪmˈpɔːtnt|adj. 重要的',
    'beautiful|ˈbjuːtɪfl|adj. 美丽的','careful|ˈkeəfl|adj. 小心的','quick|kwɪk|adj. 快的','slow|sləʊ|adj. 慢的',
    'hot|hɒt|adj. 热的','cold|kəʊld|adj. 冷的','warm|wɔːm|adj. 温暖的','clean|kliːn|adj. 干净的','dirty|ˈdɜːti|adj. 脏的',
    'always|ˈɔːlweɪz|adv. 总是','often|ˈɒfn|adv. 经常','sometimes|ˈsʌmtaɪmz|adv. 有时','never|ˈnevə|adv. 从不',
    'again|əˈɡen|adv. 再一次','together|təˈɡeðə|adv. 一起','quickly|ˈkwɪkli|adv. 快速地','slowly|ˈsləʊli|adv. 缓慢地',
    /* 课堂用语 */
    'lesson plan|ˈlesn plæn|n. 教案','homework|ˈhəʊmwɜːk|n. 作业','group|ɡruːp|n. 小组','team|tiːm|n. 团队',
    'discuss|dɪˈskʌs|v. 讨论','present|prɪˈzent|v. 展示；n. 礼物','sentence|ˈsentəns|n. 句子','word|wɜːd|n. 单词',
    'grammar|ˈɡræmə|n. 语法','pronunciation|prəˌnʌnsiˈeɪʃn|n. 发音','meaning|ˈmiːnɪŋ|n. 意思','translate|trænzˈleɪt|v. 翻译',
    'spell|spel|v. 拼写','repeat|rɪˈpiːt|v. 重复','correct|kəˈrekt|adj. 正确的','wrong|rɒŋ|adj. 错误的',
    'ready|ˈredi|adj. 准备好的','begin|bɪˈɡɪn|v. 开始','stop|stɒp|v. 停止','continue|kənˈtɪnjuː|v. 继续',
    'notice|ˈnəʊtɪs|n./v. 注意','remember|rɪˈmembə|v. 记住','review|rɪˈvjuː|v. 复习','improve|ɪmˈpruːv|v. 提高',
    /* 其他高频 */
    'question|ˈkwestʃən|n. 问题','problem|ˈprɒbləm|n. 难题','idea|aɪˈdɪə|n. 主意','reason|ˈriːzn|n. 原因',
    'result|rɪˈzʌlt|n. 结果','change|tʃeɪndʒ|v./n. 改变','grow|ɡrəʊ|v. 生长','build|bɪld|v. 建造','carry|ˈkæri|v. 携带',
    'country|ˈkʌntri|n. 国家','city|ˈsɪti|n. 城市','village|ˈvɪlɪdʒ|n. 村庄','road|rəʊd|n. 路','home|həʊm|n. 家',
    'room|ruːm|n. 房间','door|dɔː|n. 门','window|ˈwɪndəʊ|n. 窗户','wall|wɔːl|n. 墙','floor|flɔː|n. 地板；楼层',
    'money|ˈmʌni|n. 钱','shop|ʃɒp|n. 商店','hospital|ˈhɒspɪtl|n. 医院','park|pɑːk|n. 公园','station|ˈsteɪʃn|n. 车站',
    'bus|bʌs|n. 公共汽车','car|kɑː|n. 汽车','train|treɪn|n. 火车','plane|pleɪn|n. 飞机','bike|baɪk|n. 自行车'
  ];

  var DICT = RAW.map(function(line){
    var p = line.split('|');
    return { w:p[0], ph:p[1] || '', m:p[2] || '' };
  });
  var byLower = {};
  DICT.forEach(function(d){ byLower[d.w.toLowerCase()] = d; });

  function search(q){
    q = String(q || '').trim().toLowerCase();
    if(!q) return [];
    var exact = [], start = [], contain = [], cn = [];
    DICT.forEach(function(d){
      var w = d.w.toLowerCase();
      if(w === q) exact.push(d);
      else if(w.indexOf(q) === 0) start.push(d);
      else if(w.indexOf(q) > -1) contain.push(d);
      else if(d.m.indexOf(q) > -1) cn.push(d);
    });
    return exact.concat(start, contain, cn).slice(0, 30);
  }

  S.dict = function(){
    S._open({
      title:'英汉字典',
      sub:'离线精选词库 ' + DICT.length + ' 词 · 中英双向 · 可朗读',
      icon:'dict',
      body:
        '<div style="display:flex;flex-direction:column;gap:12px;height:100%">' +
          '<div style="display:flex;gap:8px">' +
            '<input class="field" id="dc-input" placeholder="输入英文单词或中文，如 apple / 苹果" autocomplete="off">' +
            '<button class="s-btn primary" id="dc-go" style="flex:0 0 auto"><i class="fas fa-magnifying-glass"></i>查询</button>' +
          '</div>' +
          '<div class="chips" id="dc-hot"></div>' +
          '<div class="dict-results" id="dc-list" style="flex:1;min-height:0;overflow:auto"></div>' +
        '</div>',
      hint:'词库完全离线；没收录的词可以点「问 AI」，用已配置的接口查。',
      onMount:function(api){
        var input = api.pane.querySelector('#dc-input');
        var list = api.pane.querySelector('#dc-list');
        var hot = api.pane.querySelector('#dc-hot');
        var HOT = ['apple','school','teacher','beautiful','because','practice','environment','knowledge'];
        hot.innerHTML = HOT.map(function(w){ return '<button class="chip" data-w="' + w + '">' + w + '</button>'; }).join('');
        hot.querySelectorAll('.chip').forEach(function(b){
          b.onclick = function(){ input.value = b.dataset.w; run(); };
        });
        function run(){
          var q = input.value;
          var res = search(q);
          if(!res.length){
            list.innerHTML = '<div class="panel-empty" style="height:auto;padding:40px 0">没有找到「' + esc(q) + '」<br>' +
              '<button class="s-btn" id="dc-ai" style="margin-top:12px"><i class="fas fa-wand-magic-sparkles"></i>用 AI 查这个词</button></div>';
            var ai = list.querySelector('#dc-ai');
            if(ai) ai.onclick = function(){
              api.close();
              EN10.openAIChat();
              setTimeout(function(){
                var ta = document.querySelector('.ai-chat textarea');
                if(ta){ ta.value = '请解释英语单词「' + q + '」：音标、词性、中文释义，并给两个例句。'; ta.focus(); }
              }, 360);
            };
            return;
          }
          list.innerHTML = res.map(function(d){
            return '<div class="dict-item"><h4>' + esc(d.w) +
              (d.ph ? '<em>/' + esc(d.ph) + '/</em>' : '') +
              '<button class="bib-mini" data-say="' + esc(d.w) + '" style="margin-left:auto"><i class="fas fa-volume-high"></i></button></h4>' +
              '<p>' + esc(d.m) + '</p></div>';
          }).join('');
          list.querySelectorAll('[data-say]').forEach(function(b){
            b.onclick = function(){ S._speak(b.dataset.say, 'en-US', .82); };
          });
        }
        input.addEventListener('input', function(){ if(input.value.length >= 2) run(); });
        input.addEventListener('keydown', function(e){ if(e.key === 'Enter') run(); });
        api.pane.querySelector('#dc-go').onclick = run;
        input.value = 'apple';
        run();
        setTimeout(function(){ input.focus(); input.select(); }, 260);
      }
    });
  };
})();
