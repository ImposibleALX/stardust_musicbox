/*!
 * networkFeedback.js — Network status HUD and offline resilience
 * Designed for mobile and desktop environments in Stardust Music Box
 */
(function (root) {
  'use strict';

  let bannerEl = null;
  let dismissTimer = null;

  function ensureStyles() {
    if (document.getElementById('networkFeedbackStyles')) return;
    const style = document.createElement('style');
    style.id = 'networkFeedbackStyles';
    style.textContent = `
      #networkFeedbackBanner {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translate(-50%, -120%);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 18px;
        font-family: 'Orbitron', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 0.9rem;
        font-weight: 600;
        letter-spacing: 0.05em;
        color: #fff;
        background: rgba(15, 15, 26, 0.94);
        border: 1.5px solid #333;
        border-radius: 30px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        pointer-events: auto;
        transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease, box-shadow 0.35s ease;
        opacity: 0;
        max-width: min(92vw, 480px);
        text-align: center;
      }
      #networkFeedbackBanner.visible {
        transform: translate(-50%, 0);
        opacity: 1;
      }
      #networkFeedbackBanner.warning {
        border-color: #ffaa00;
        color: #ffdd88;
        box-shadow: 0 0 16px rgba(255, 170, 0, 0.35), 0 4px 20px rgba(0, 0, 0, 0.8);
      }
      #networkFeedbackBanner.success {
        border-color: #00ddbb;
        color: #aaffea;
        box-shadow: 0 0 16px rgba(0, 221, 187, 0.35), 0 4px 20px rgba(0, 0, 0, 0.8);
      }
      #networkFeedbackBanner.info {
        border-color: #66ccff;
        color: #cceeff;
        box-shadow: 0 0 16px rgba(102, 204, 255, 0.35), 0 4px 20px rgba(0, 0, 0, 0.8);
      }
      #networkFeedbackBanner .banner-indicator {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: currentColor;
        box-shadow: 0 0 8px currentColor;
        flex-shrink: 0;
        animation: pulseIndicator 1.4s infinite alternate ease-in-out;
      }
      #networkFeedbackBanner .banner-text {
        flex: 1;
        line-height: 1.3;
      }
      @keyframes pulseIndicator {
        0% { transform: scale(0.85); opacity: 0.7; }
        100% { transform: scale(1.2); opacity: 1; }
      }
      @media (max-width: 480px) {
        #networkFeedbackBanner {
          top: 8px;
          padding: 8px 14px;
          font-size: 0.82rem;
          gap: 8px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getBanner() {
    if (bannerEl) return bannerEl;
    if (typeof document === 'undefined' || !document.body) return null;
    ensureStyles();
    bannerEl = document.createElement('div');
    bannerEl.id = 'networkFeedbackBanner';
    bannerEl.setAttribute('role', 'status');
    bannerEl.setAttribute('aria-live', 'polite');

    const indicatorSpan = document.createElement('span');
    indicatorSpan.className = 'banner-indicator';
    if (indicatorSpan.classList && typeof indicatorSpan.classList.add === 'function') {
      indicatorSpan.classList.add('banner-indicator');
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'banner-text';
    if (textSpan.classList && typeof textSpan.classList.add === 'function') {
      textSpan.classList.add('banner-text');
    }

    if (typeof bannerEl.appendChild === 'function') {
      bannerEl.appendChild(indicatorSpan);
      bannerEl.appendChild(textSpan);
    }
    bannerEl._indicatorEl = indicatorSpan;
    bannerEl._textEl = textSpan;

    if (typeof document.body.appendChild === 'function') {
      document.body.appendChild(bannerEl);
    }
    return bannerEl;
  }

  function showNetworkNotice(message, type = 'info', durationMs = 0) {
    if (typeof document === 'undefined') return;
    const banner = getBanner();
    if (!banner) return;

    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }

    const textEl = banner._textEl || (typeof banner.querySelector === 'function' ? banner.querySelector('.banner-text') : null);

    banner.className = `visible ${type}`;
    if (banner.classList && typeof banner.classList.add === 'function') {
      banner.classList.add('visible');
      banner.classList.add(type);
    }
    if (textEl) textEl.textContent = message;

    if (durationMs > 0) {
      dismissTimer = setTimeout(() => {
        hideNetworkNotice();
      }, durationMs);
    }
  }

  function hideNetworkNotice() {
    if (!bannerEl) return;
    bannerEl.className = '';
    if (bannerEl.classList && typeof bannerEl.classList.remove === 'function') {
      bannerEl.classList.remove('visible');
    }
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  function isOnline() {
    return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true;
  }

  // Global network event auto-initialization
  if (typeof window !== 'undefined') {
    window.showNetworkNotice = showNetworkNotice;
    window.hideNetworkNotice = hideNetworkNotice;
    window.isOnline = isOnline;

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        showNetworkNotice('Connection restored', 'success', 2500);
      });

      window.addEventListener('offline', () => {
        showNetworkNotice('No internet connection — Offline mode', 'warning', 0);
      });
    }

    // Initial check in case started while offline
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', () => {
          if (!isOnline()) {
            showNetworkNotice('No internet connection — Offline mode', 'warning', 0);
          }
        });
      } else if (!isOnline()) {
        showNetworkNotice('No internet connection — Offline mode', 'warning', 0);
      }
    }
  }

  const exported = {
    show: showNetworkNotice,
    hide: hideNetworkNotice,
    isOnline
  };
  if (root) root.NetworkFeedback = exported;
  if (typeof globalThis !== 'undefined') globalThis.NetworkFeedback = exported;
  if (typeof module === 'object' && module.exports) module.exports = exported;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this)));
