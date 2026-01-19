class UnixTimestampConverter {
  constructor() {
    this.autoScanEnabled = false;
    this.currentDomain = '';
    this.autoTooltips = new Map();
    this.isScanning = false;
    this.debounceTimer = null;
    this.pendingScan = false;
    this.scanQueueTimer = null;
    this.lastScanTime = 0;
    this.minScanInterval = 1000; // 最小扫描间隔 1 秒
    this.init();
  }

  async init() {
    this.currentDomain = window.location.hostname;
    await this.loadDomainSettings();
    this.bindEvents();

    // 监听来自 popup 的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'TOGGLE_AUTO_SCAN') {
        this.autoScanEnabled = message.enabled;
        if (this.autoScanEnabled) {
          this.startAutoScan();
        } else {
          this.stopAutoScan();
        }
      }
      sendResponse({ success: true });
    });

    // 如果自动扫描已启用，执行扫描
    if (this.autoScanEnabled) {
      this.startAutoScan();
    }
  }

  async loadDomainSettings() {
    try {
      const data = await chrome.storage.local.get('domainSettings');
      const settings = data.domainSettings || {};
      this.autoScanEnabled = settings[this.currentDomain] || false;
    } catch (err) {
      console.error('加载域名设置失败:', err);
    }
  }

  startAutoScan() {
    if (!this.observer) {
      this.observer = new MutationObserver((mutations) => {
        // 只在添加/删除节点时触发
        const hasNodeChanges = mutations.some(m =>
          m.addedNodes.length > 0 || m.removedNodes.length > 0
        );

        if (hasNodeChanges) {
          this.queueAutoScan();
        }
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    this.autoScanPage();
  }

  stopAutoScan() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.clearAutoTooltips();
    this.clearTimers();
  }

  clearTimers() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.scanQueueTimer) {
      clearTimeout(this.scanQueueTimer);
      this.scanQueueTimer = null;
    }
  }

  queueAutoScan() {
    // 清除之前的定时器
    if (this.scanQueueTimer) {
      clearTimeout(this.scanQueueTimer);
    }

    // 设置新的定时器，确保至少等待最小间隔
    const timeSinceLastScan = Date.now() - this.lastScanTime;
    const waitTime = Math.max(this.minScanInterval - timeSinceLastScan, 100);

    this.scanQueueTimer = setTimeout(() => {
      this.autoScanPage();
    }, waitTime);
  }

  debounceAutoScan() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.autoScanPage();
    }, 500);
  }

  bindEvents() {
    document.addEventListener('mouseup', this.handleSelection.bind(this));
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') {
        this.handleSelection();
      }
    });
  }

  handleSelection() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (!selectedText) {
      return;
    }

    const timestamp = this.parseTimestamp(selectedText);
    if (timestamp !== null) {
      const readableTime = this.convertToReadableTime(timestamp);
      this.showTooltip(readableTime);
    }
  }

  autoScanPage() {
    // 防止重复扫描
    if (this.isScanning) {
      this.pendingScan = true;
      return;
    }

    // 检查扫描间隔
    const timeSinceLastScan = Date.now() - this.lastScanTime;
    if (timeSinceLastScan < this.minScanInterval) {
      // 距离上次扫描太近，延后执行
      this.queueAutoScan();
      return;
    }

    this.isScanning = true;
    this.lastScanTime = Date.now();

    // 使用 setTimeout 让出主线程，避免阻塞
    setTimeout(() => {
      try {
        // 只扫描可见区域附近的内容
        const textNodes = this.findVisibleTextNodes();
        const timestampRegex = /\b\d{10,19}\b/g;

        let scannedCount = 0;
        const maxPerScan = 100; // 每次最多扫描 100 个节点

        textNodes.some(node => {
          if (scannedCount >= maxPerScan) return true;

          const text = node.textContent;
          const matches = text.matchAll(timestampRegex);

          for (const match of matches) {
            const timestampStr = match[0];
            const timestamp = this.parseTimestamp(timestampStr);

            if (timestamp !== null) {
              const readableTime = this.convertToReadableTime(timestamp);
              this.showAutoTooltip(node, match, readableTime);
            }
          }

          scannedCount++;
          return false;
        });

        // 如果还有未扫描的节点，稍后继续
        if (textNodes.length > maxPerScan && this.pendingScan) {
          this.queueAutoScan();
        }
      } catch (err) {
        console.error('扫描失败:', err);
      } finally {
        this.isScanning = false;
        this.pendingScan = false;
      }
    }, 0);
  }

  findVisibleTextNodes() {
    const textNodes = [];
    const viewportHeight = window.innerHeight;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // 跳过已处理的节点和空节点
          const parent = node.parentNode;
          if (parent.tagName === 'SCRIPT' ||
              parent.tagName === 'STYLE' ||
              parent.tagName === 'NOSCRIPT' ||
              parent.classList?.contains('unix-timestamp-tooltip')) {
            return NodeFilter.FILTER_REJECT;
          }

          const text = node.textContent.trim();
          if (!text) {
            return NodeFilter.FILTER_REJECT;
          }

          // 检查是否包含数字
          if (!/\d{10,19}/.test(text)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    let count = 0;
    const maxTotal = 500; // 总共最多收集 500 个节点

    while ((node = walker.nextNode()) && count < maxTotal) {
      textNodes.push(node);
      count++;
    }

    return textNodes;
  }

  showAutoTooltip(textNode, match, text) {
    const range = document.createRange();
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;

    try {
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);

      const rect = range.getBoundingClientRect();
      const timestampKey = `${textNode.textContent}-${startOffset}-${endOffset}`;

      // 如果已经存在该位置的提示，跳过
      if (this.autoTooltips.has(timestampKey)) {
        return;
      }

      const tooltip = document.createElement('div');
      tooltip.className = 'unix-timestamp-tooltip unix-timestamp-tooltip-auto';
      tooltip.textContent = text;

      document.body.appendChild(tooltip);

      const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollY = window.pageYOffset || document.documentElement.scrollTop;

      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;

      let left = rect.left + scrollX + (rect.width - tooltipWidth) / 2;
      let top = rect.top + scrollY - tooltipHeight - 5;

      if (left < 10) left = 10;
      if (left + tooltipWidth > window.innerWidth - 10) {
        left = window.innerWidth - tooltipWidth - 10;
      }
      if (top < 10) {
        top = rect.bottom + scrollY + 5;
      }

      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';

      // 保存提示信息
      this.autoTooltips.set(timestampKey, tooltip);

      // 自动提示只在页面显示，不自动消失
    } catch (err) {
      // 忽略错误，继续处理其他节点
    }
  }

  clearAutoTooltips() {
    this.autoTooltips.forEach(tooltip => {
      if (tooltip && tooltip.parentNode) {
        tooltip.remove();
      }
    });
    this.autoTooltips.clear();
  }

  parseTimestamp(text) {
    const num = parseInt(text, 10);
    if (isNaN(num) || num < 0) {
      return null;
    }

    const currentYear = new Date().getFullYear();
    const now = Date.now();

    if (num < 1000000000000) {
      const date = new Date(num * 1000);
      if (date.getFullYear() >= 1970 && date.getFullYear() <= currentYear + 10) {
        return num * 1000;
      }
    }

    if (num >= 1000000000000 && num < 1000000000000000) {
      const date = new Date(num);
      if (date.getFullYear() >= 1970 && date.getFullYear() <= currentYear + 10) {
        return num;
      }
    }

    if (num >= 1000000000000000 && num < 1000000000000000000) {
      const date = new Date(num / 1000);
      if (date.getFullYear() >= 1970 && date.getFullYear() <= currentYear + 10) {
        return num / 1000;
      }
    }

    if (num >= 1000000000000000000 && num < 1000000000000000000000) {
      const date = new Date(num / 1000000);
      if (date.getFullYear() >= 1970 && date.getFullYear() <= currentYear + 10) {
        return num / 1000000;
      }
    }

    return null;
  }

  convertToReadableTime(timestamp) {
    const date = new Date(timestamp);

    const timeZone = 'Asia/Shanghai';
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: timeZone
    };

    const formatter = new Intl.DateTimeFormat('zh-CN', options);
    return formatter.format(date);
  }

  showTooltip(text) {
    this.removeExistingTooltip();

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const tooltip = document.createElement('div');
    tooltip.className = 'unix-timestamp-tooltip';
    tooltip.textContent = text;

    document.body.appendChild(tooltip);

    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;

    let left = rect.left + scrollX + (rect.width - tooltipWidth) / 2;
    let top = rect.top + scrollY - tooltipHeight - 5;

    if (left < 10) left = 10;
    if (left + tooltipWidth > window.innerWidth - 10) {
      left = window.innerWidth - tooltipWidth - 10;
    }
    if (top < 10) {
      top = rect.bottom + scrollY + 5;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    this.tooltip = tooltip;
    this.tooltipTimer = setTimeout(() => {
      this.removeExistingTooltip();
    }, 3000);
  }

  removeExistingTooltip() {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
    if (this.tooltipTimer) {
      clearTimeout(this.tooltipTimer);
      this.tooltipTimer = null;
    }
  }
}

new UnixTimestampConverter();
