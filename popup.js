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
    const datetimeInput = document.getElementById('datetime-input');

    if (convertBtn) {
      convertBtn.addEventListener('click', () => this.convert());
    }

    if (timestampInput) {
      // 输入时自动转换
      timestampInput.addEventListener('input', () => {
        this.convert();
      });
    }

    if (datetimeInput) {
      // 输入时自动转换
      datetimeInput.addEventListener('input', () => {
        this.convertReverse();
      });

      // 延迟检查，确保 popup-init.js 已完成默认值设置
      setTimeout(() => {
        if (datetimeInput.value) {
          this.convertReverse();
        }
      }, 0);
    }

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

  convertReverse() {
    const datetimeInput = document.getElementById('datetime-input');
    const resultGroup = document.getElementById('reverse-result-group');
    const resultValue = document.getElementById('reverse-result-value');
    const resultType = document.getElementById('reverse-result-type');

    if (!datetimeInput || !resultGroup || !resultValue || !resultType) {
      return;
    }

    const value = datetimeInput.value;

    if (!value) {
      resultGroup.style.display = 'none';
      return;
    }

    // 解析 datetime-local 的值（格式 YYYY-MM-DDTHH:mm:ss）
    // 这个值不带时区，需要将其视为东八区时间
    const [datePart, timePart] = value.split('T');
    if (!datePart || !timePart) {
      resultValue.textContent = '无效的日期时间';
      resultType.textContent = '请检查输入';
      resultGroup.style.display = 'block';
      return;
    }

    // 将东八区时间转换为 UTC 时间戳
    // 东八区时间 = UTC + 8 小时，所以 UTC = 东八区 - 8 小时
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes, seconds] = timePart.split(':').map(Number);

    // 创建时间对象，表示东八区时间
    // 然后减去 8 小时，得到 UTC 时间
    const east8Date = new Date(year, month - 1, day, hours, minutes, seconds || 0);
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
