class TimestampConverter {
  constructor() {
    this.domain = '';
    this.init();
  }

  init() {
    // 立即绑定事件，不等待
    this.bindEvents();

    // 所有异步操作延迟执行，不阻塞页面显示
    setTimeout(() => {
      Promise.all([
        this.getCurrentDomain(),
        this.loadSettings()
      ]).catch(err => {
        console.error('初始化失败:', err);
      });
    }, 0);
  }

  async getCurrentDomain() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        this.domain = url.hostname;
        const domainElement = document.getElementById('current-domain');
        const domainInfo = document.getElementById('domain-info');
        if (domainElement) domainElement.textContent = this.domain;
        if (domainInfo) domainInfo.style.display = 'block';
      }
    } catch (err) {
      console.error('获取域名失败:', err);
    }
  }

  async loadSettings() {
    try {
      const data = await chrome.storage.local.get('domainSettings');
      const settings = data.domainSettings || {};
      const isEnabled = settings[this.domain] || false;

      const toggle = document.getElementById('auto-scan-toggle');
      if (toggle) toggle.checked = isEnabled;

      // 通知 content script 当前页面的设置
      this.notifyContentScript(isEnabled);
    } catch (err) {
      console.error('加载设置失败:', err);
    }
  }

  async saveSettings(isEnabled) {
    try {
      const data = await chrome.storage.local.get('domainSettings');
      const settings = data.domainSettings || {};

      settings[this.domain] = isEnabled;

      await chrome.storage.local.set({ domainSettings: settings });

      // 通知 content script 更新设置
      this.notifyContentScript(isEnabled);
    } catch (err) {
      console.error('保存设置失败:', err);
    }
  }

  async notifyContentScript(isEnabled) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'TOGGLE_AUTO_SCAN',
          enabled: isEnabled
        }).catch(() => {
          // content script 可能还未加载
        });
      }
    } catch (err) {
      console.error('通知 content script 失败:', err);
    }
  }

  bindEvents() {
    const convertBtn = document.getElementById('convert-btn');
    const timestampInput = document.getElementById('timestamp-input');
    const autoScanToggle = document.getElementById('auto-scan-toggle');

    if (convertBtn) {
      convertBtn.addEventListener('click', () => this.convert());
    }

    if (timestampInput) {
      // 输入时自动转换
      timestampInput.addEventListener('input', () => {
        this.convert();
      });
    }

    // 绑定日期时间输入框事件
    const yearInput = document.getElementById('year-input');
    const monthInput = document.getElementById('month-input');
    const dayInput = document.getElementById('day-input');
    const hourInput = document.getElementById('hour-input');
    const minuteInput = document.getElementById('minute-input');
    const secondInput = document.getElementById('second-input');

    const inputs = [yearInput, monthInput, dayInput, hourInput, minuteInput, secondInput];
    const nextInputs = [monthInput, dayInput, hourInput, minuteInput, secondInput, null];

    inputs.forEach((input, index) => {
      if (!input) return;

      // 输入时自动转换
      input.addEventListener('input', (e) => {
        // 输入满最大长度后自动跳转到下一个输入框
        if (e.target.value.length >= e.target.maxLength && nextInputs[index]) {
          nextInputs[index].focus();
        }
        this.convertReverse();
      });

      // 处理退格键：如果当前输入框为空，则跳转到上一个输入框
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
          e.preventDefault();
          inputs[index - 1].focus();
        }
      });

      // 处理粘贴事件
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text) return;
        this.parseAndFillDateTime(text);
      });
    });

    // 延迟检查，确保 popup-init.js 已完成默认值设置
    setTimeout(() => {
      if (yearInput && yearInput.value) {
        this.convertReverse();
      }
    }, 0);

    if (autoScanToggle) {
      autoScanToggle.addEventListener('change', (e) => {
        this.saveSettings(e.target.checked);
      });
    }

    // 复制按钮
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => this.copyToClipboard(btn));
    });
  }

  parseTimestamp(text) {
    const num = parseInt(text, 10);
    if (isNaN(num) || num < 0) {
      return null;
    }

    const currentYear = new Date().getFullYear();

    if (num < 1000000000000) {
      const date = new Date(num * 1000);
      if (date.getFullYear() >= 1970 && date.getFullYear() <= currentYear + 10) {
        return { timestamp: num * 1000, type: '秒级时间戳' };
      }
    }

    if (num >= 1000000000000 && num < 1000000000000000) {
      const date = new Date(num);
      if (date.getFullYear() >= 1970 && date.getFullYear() <= currentYear + 10) {
        return { timestamp: num, type: '毫秒级时间戳' };
      }
    }

    if (num >= 1000000000000000 && num < 1000000000000000000) {
      const date = new Date(num / 1000);
      if (date.getFullYear() >= 1970 && date.getFullYear() <= currentYear + 10) {
        return { timestamp: num / 1000, type: '微秒级时间戳' };
      }
    }

    if (num >= 1000000000000000000 && num < 1000000000000000000000) {
      const date = new Date(num / 1000000);
      if (date.getFullYear() >= 1970 && date.getFullYear() <= currentYear + 10) {
        return { timestamp: num / 1000000, type: '纳秒级时间戳' };
      }
    }

    return null;
  }

  convertToEast8Time(timestamp) {
    const date = new Date(timestamp);

    // 使用 Intl.DateTimeFormat 获取东八区时间
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai'
    });

    // 获取各部分并重新组合，确保使用 - 分隔符
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    const hour = parts.find(p => p.type === 'hour')?.value;
    const minute = parts.find(p => p.type === 'minute')?.value;
    const second = parts.find(p => p.type === 'second')?.value;

    // 手动格式化，确保日期部分使用 - 分隔符
    // 使用空字符串拼接，避免减法运算
    const dateStr = String(year) + '-' + String(month) + '-' + String(day);
    const timeStr = String(hour) + ':' + String(minute) + ':' + String(second);
    return dateStr + ' ' + timeStr;
  }

  convert() {
    const input = document.getElementById('timestamp-input');
    const resultGroup = document.getElementById('result-group');
    const resultValue = document.getElementById('result-value');
    const resultType = document.getElementById('result-type');

    if (!input || !resultGroup || !resultValue || !resultType) {
      return;
    }

    const text = input.value.trim();

    if (!text) {
      resultGroup.style.display = 'none';
      return;
    }

    const result = this.parseTimestamp(text);

    if (result) {
      const readableTime = this.convertToEast8Time(result.timestamp);
      resultValue.textContent = readableTime;
      resultType.textContent = result.type;
      resultGroup.style.display = 'block';
    } else {
      resultValue.textContent = '无效的时间戳';
      resultType.textContent = '请检查输入';
      resultGroup.style.display = 'block';
    }
  }

  copyToClipboard(btn) {
    const targetId = btn.getAttribute('data-target');
    const element = document.getElementById(targetId);
    if (!element) return;

    const text = element.textContent;

    navigator.clipboard.writeText(text).then(() => {
      const originalText = btn.textContent;
      btn.textContent = '已复制';
      btn.style.background = '#28a745';

      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '#667eea';
      }, 1500);
    }).catch(err => {
      console.error('复制失败:', err);
    });
  }

  parseAndFillDateTime(text) {
    // 支持多种格式的时间字符串
    // 2024-01-01 12:00:00
    // 2024/01/01 12:00:00
    // 20240101120000
    // 2024-01-01
    // 2024/01/01
    // 12:00:00
    let date = null;
    let time = null;

    // 尝试匹配各种格式
    const patterns = [
      /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/,  // 2024-01-01 12:00:00
      /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})/,        // 2024-01-01 12:00
      /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/,                                 // 2024-01-01
      /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,                          // 20240101120000
      /(\d{1,2}):(\d{1,2}):(\d{1,2})/,                                       // 12:00:00
      /(\d{1,2}):(\d{1,2})/                                                   // 12:00
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        if (pattern === patterns[0]) {  // YYYY-MM-DD HH:MM:SS
          date = { year: match[1], month: match[2], day: match[3] };
          time = { hour: match[4], minute: match[5], second: match[6] };
        } else if (pattern === patterns[1]) {  // YYYY-MM-DD HH:MM
          date = { year: match[1], month: match[2], day: match[3] };
          time = { hour: match[4], minute: match[5], second: '00' };
        } else if (pattern === patterns[2]) {  // YYYY-MM-DD
          date = { year: match[1], month: match[2], day: match[3] };
        } else if (pattern === patterns[3]) {  // YYYYMMDDHHMMSS
          date = { year: match[1], month: match[2], day: match[3] };
          time = { hour: match[4], minute: match[5], second: match[6] };
        } else if (pattern === patterns[4]) {  // HH:MM:SS
          time = { hour: match[1], minute: match[2], second: match[3] };
        } else if (pattern === patterns[5]) {  // HH:MM
          time = { hour: match[1], minute: match[2], second: '00' };
        }
        break;
      }
    }

    // 如果没有匹配到完整格式，尝试其他常见格式
    if (!date && !time) {
      // 尝试使用 Date 解析
      const parsedDate = new Date(text);
      if (!isNaN(parsedDate.getTime())) {
        date = {
          year: String(parsedDate.getFullYear()),
          month: String(parsedDate.getMonth() + 1).padStart(2, '0'),
          day: String(parsedDate.getDate()).padStart(2, '0')
        };
        time = {
          hour: String(parsedDate.getHours()).padStart(2, '0'),
          minute: String(parsedDate.getMinutes()).padStart(2, '0'),
          second: String(parsedDate.getSeconds()).padStart(2, '0')
        };
      }
    }

    // 填充到输入框
    if (date) {
      const yearInput = document.getElementById('year-input');
      const monthInput = document.getElementById('month-input');
      const dayInput = document.getElementById('day-input');

      if (yearInput) yearInput.value = date.year;
      if (monthInput) monthInput.value = date.month;
      if (dayInput) dayInput.value = date.day;
    }

    if (time) {
      const hourInput = document.getElementById('hour-input');
      const minuteInput = document.getElementById('minute-input');
      const secondInput = document.getElementById('second-input');

      if (hourInput) hourInput.value = time.hour;
      if (minuteInput) minuteInput.value = time.minute;
      if (secondInput) secondInput.value = time.second;
    }

    // 触发转换
    this.convertReverse();
  }

  convertReverse() {
    const yearInput = document.getElementById('year-input');
    const monthInput = document.getElementById('month-input');
    const dayInput = document.getElementById('day-input');
    const hourInput = document.getElementById('hour-input');
    const minuteInput = document.getElementById('minute-input');
    const secondInput = document.getElementById('second-input');
    const resultGroup = document.getElementById('reverse-result-group');
    const resultValue = document.getElementById('reverse-result-value');
    const resultType = document.getElementById('reverse-result-type');

    if (!yearInput || !monthInput || !dayInput || !hourInput || !minuteInput || !secondInput || !resultGroup || !resultValue || !resultType) {
      return;
    }

    const year = yearInput.value.trim();
    const month = monthInput.value.trim();
    const day = dayInput.value.trim();
    const hours = hourInput.value.trim();
    const minutes = minuteInput.value.trim();
    const seconds = secondInput.value.trim();

    // 检查是否所有输入框都有值
    if (!year || !month || !day || !hours || !minutes || !seconds) {
      resultGroup.style.display = 'none';
      return;
    }

    // 将东八区时间转换为 UTC 时间戳
    // 东八区时间 = UTC + 8 小时，所以 UTC = 东八区 - 8 小时
    const east8Date = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
    const utcTimestamp = east8Date.getTime() - 8 * 3600 * 1000;

    if (isNaN(utcTimestamp)) {
      resultValue.textContent = '无效的日期时间';
      resultType.textContent = '请检查输入';
      resultGroup.style.display = 'block';
      return;
    }

    // 转换为 Unix 秒级时间戳
    const timestamp = Math.floor(utcTimestamp / 1000);
    resultValue.textContent = timestamp;
    resultType.textContent = '秒级时间戳';
    resultGroup.style.display = 'block';
  }
}

new TimestampConverter();
