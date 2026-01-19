class UnixTimestampConverter {
  constructor() {
    this.autoScanEnabled = false;
    this.currentDomain = '';
    this.autoTooltips = new Map();
    this.isScanning = false;
    this.debounceTimer = null;
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
          this.debounceAutoScan();
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
      return;
    }

    this.isScanning = true;

    // 使用 requestAnimationFrame 分片处理
    requestAnimationFrame(() => {
      try {
        // 查找页面中的时间戳（限制扫描数量）
        const textNodes = this.findTextNodes(document.body, 1000);
        const timestampRegex = /\b\d{10,19}\b/g;

        textNodes.forEach(node => {
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
        });
      } finally {
        this.isScanning = false;
      }
    });
  }

  findTextNodes(element, maxNodes = 1000) {
    const textNodes = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // 跳过已处理的节点和空节点
          if (node.parentNode.tagName === 'SCRIPT' ||
              node.parentNode.tagName === 'STYLE' ||
              node.parentNode.tagName === 'NOSCRIPT' ||
              !node.textContent.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          // 检查是否包含数字
          if (!/\d{10,19}/.test(node.textContent)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode()) && textNodes.length < maxNodes) {
      textNodes.push(node);
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
      console.error('创建自动提示失败:', err);
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
