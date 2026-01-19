class TimestampConverter {
  constructor() {
    this.domain = '';
    this.init();
  }

  init() {
    // DOM 加载后立即更新时间戳，不等待任何异步操作
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.updateCurrentTimestamps();
      });
    } else {
      this.updateCurrentTimestamps();
    }

    // 立即绑定事件
    this.bindEvents();

    // 启动定时器
    setInterval(() => this.updateCurrentTimestamps(), 1000);

    // 异步加载设置，不阻塞界面显示
    Promise.all([
      this.getCurrentDomain(),
      this.loadSettings()
    ]).catch(err => {
      console.error('初始化失败:', err);
    });
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
      timestampInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.convert();
        }
      });
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
    return formatter.format(date);
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

  updateCurrentTimestamps() {
    const now = Date.now();

    const secondElement = document.getElementById('current-second');
    const millisecondElement = document.getElementById('current-millisecond');

    if (secondElement) secondElement.textContent = Math.floor(now / 1000);
    if (millisecondElement) millisecondElement.textContent = now;
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
}

new TimestampConverter();
