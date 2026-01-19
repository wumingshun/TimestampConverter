class TimestampConverter {
  constructor() {
    this.domain = '';
    this.init();
  }

  async init() {
    await this.getCurrentDomain();
    await this.loadSettings();
    this.bindEvents();
    this.updateCurrentTimestamps();
    setInterval(() => this.updateCurrentTimestamps(), 1000);
  }

  async getCurrentDomain() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        this.domain = url.hostname;
        document.getElementById('current-domain').textContent = this.domain;
        document.getElementById('domain-info').style.display = 'block';
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
      toggle.checked = isEnabled;

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

    convertBtn.addEventListener('click', () => this.convert());
    timestampInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.convert();
      }
    });

    // 自动扫描开关
    autoScanToggle.addEventListener('change', (e) => {
      this.saveSettings(e.target.checked);
    });

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

    document.getElementById('current-second').textContent = Math.floor(now / 1000);
    document.getElementById('current-millisecond').textContent = now;
  }

  copyToClipboard(btn) {
    const targetId = btn.getAttribute('data-target');
    const element = document.getElementById(targetId);
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
