// ====== 股票数据抓取（由GitHub Actions自动运行）======
const fs = require('fs');
const { Buffer } = require('buffer');

// 从 GBK 编码的 JS 变量字符串中解析数据
function parseSinaData(text) {
  const results = {};
  const regex = /hq_str_(\w+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const code = match[1];
    const raw = match[2];
    // GBK转UTF8
    let decoded;
    try {
      const buf = Buffer.from(raw, 'binary');
      decoded = new TextDecoder('gbk').decode(buf);
    } catch(e) {
      decoded = raw;
    }
    const fields = decoded.split(',');
    results[code] = {
      name: fields[0],
      open: parseFloat(fields[1]) || 0,
      yesterday: parseFloat(fields[2]) || 0,
      price: parseFloat(fields[3]) || 0,
      high: parseFloat(fields[4]) || 0,
      low: parseFloat(fields[5]) || 0,
      volume: parseInt(fields[8]) || 0,
      amount: parseFloat(fields[9]) || 0,
      date: fields[30] || '',
      time: fields[31] || ''
    };
  }
  return results;
}

// 计算涨跌幅
function calcChange(price, yesterday) {
  if (!yesterday || yesterday === 0) return 0;
  return ((price - yesterday) / yesterday * 100);
}

// 获取指数数据
async function fetchIndices() {
  const codes = 'sh000001,sz399001,sz399006,sh000688';
  const url = `https://hq.sinajs.cn/list=${codes}`;
  const resp = await fetch(url, {
    headers: { 'Referer': 'https://finance.sina.com.cn' }
  });
  const text = await resp.text();
  const raw = parseSinaData(text);

  return Object.entries(raw).map(([code, d]) => ({
    code: code,
    name: d.name,
    price: d.price,
    change: calcChange(d.price, d.yesterday),
    changeAmount: d.price - d.yesterday,
    open: d.open,
    high: d.high,
    low: d.low,
    volume: d.volume,
    amount: d.amount,
    time: d.date + ' ' + d.time
  }));
}

// 获取个股排行榜
async function fetchStockRanking(sortType = 'asc', node = 'hs_a', count = 10) {
  try {
    const url = `http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=${count}&sort=changepercent&asc=${sortType}&node=${node}&symbol=&_s_r_a=auto`;
    const resp = await fetch(url, {
      headers: { 'Referer': 'https://stock.finance.sina.com.cn' }
    });
    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    return data.slice(0, count).map(s => ({
      code: s.symbol,
      name: s.name,
      price: parseFloat(s.trade) || 0,
      change: parseFloat(s.changepercent) || 0,
      changeAmount: parseFloat(s.pricechange) || 0,
      open: parseFloat(s.open) || 0,
      high: parseFloat(s.high) || 0,
      low: parseFloat(s.low) || 0,
      volume: parseInt(s.volume) || 0,
      turnover: parseFloat(s.amount) || 0
    }));
  } catch(e) {
    console.error('排行榜获取失败:', e.message);
    return [];
  }
}

// 获取行业板块
async function fetchSectors() {
  try {
    // 用新浪行业板块API
    const nodes = [
      { code: 'hangye', name: '行业板块' }
    ];
    let results = [];

    for (const n of nodes) {
      const url = `http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=10&sort=changepercent&asc=0&node=${n.code}&symbol=&_s_r_a=auto`;
      const resp = await fetch(url, {
        headers: { 'Referer': 'https://stock.finance.sina.com.cn' }
      });
      const data = await resp.json();
      if (Array.isArray(data)) {
        results = data.slice(0, 10).map(s => ({
          code: s.symbol,
          name: s.name,
          price: parseFloat(s.trade) || 0,
          change: parseFloat(s.changepercent) || 0,
          changeAmount: parseFloat(s.pricechange) || 0
        }));
      }
    }
    return results;
  } catch(e) {
    console.error('板块获取失败:', e.message);
    return [];
  }
}

// 获取股市新闻
async function fetchStockNews() {
  try {
    const url = 'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&k=&num=15&page=1';
    const resp = await fetch(url);
    const json = await resp.json();
    const data = (json.result && json.result.data) || [];
    return data.map(item => ({
      title: item.title || '',
      intro: (item.intro || item.summary || '').replace(/<[^>]*>/g, '').substring(0, 100),
      url: item.wapurl || item.url || '',
      time: item.ctime || item.mtime || ''
    }));
  } catch(e) {
    console.error('股市新闻获取失败:', e.message);
    return [];
  }
}

// 主函数
(async () => {
  console.log('开始抓取股票数据...');

  console.log('  抓取主要指数...');
  const indices = await fetchIndices();

  console.log('  抓取涨幅榜...');
  const gainers = await fetchStockRanking(0, 'hs_a', 10);

  console.log('  抓取跌幅榜...');
  const losers = await fetchStockRanking(1, 'hs_a', 10);

  console.log('  抓取行业板块...');
  const sectors = await fetchSectors();

  console.log('  抓取股市新闻...');
  const news = await fetchStockNews();

  const data = {
    updated: new Date().toISOString(),
    indices: indices,
    sectors: sectors,
    gainers: gainers,
    losers: losers,
    news: news
  };

  fs.writeFileSync('stock.json', JSON.stringify(data, null, 2), 'utf-8');

  const total = indices.length + sectors.length + gainers.length + losers.length + news.length;
  console.log('抓取完成！共 ' + total + ' 条数据');
  console.log('  指数:', indices.length, '| 板块:', sectors.length,
              '| 涨幅榜:', gainers.length, '| 跌幅榜:', losers.length,
              '| 新闻:', news.length);
})();
