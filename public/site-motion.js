(function () {
    'use strict';

    function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function isPlainMoneyText(el) {
        return el.childNodes.length === 1 && el.firstChild.nodeType === Node.TEXT_NODE;
    }

    function buildTickerInnerHTML(raw) {
        var chars = raw.split('');
        var visual = chars
            .map(function (ch) {
                return (
                    '<span class="motion-ticker-col"><span class="motion-ticker-digit">' +
                    escapeHtml(ch) +
                    '</span></span>'
                );
            })
            .join('');
        return (
            '<span class="motion-ticker-sr">' +
            escapeHtml(raw) +
            '</span><span class="motion-ticker-visual" aria-hidden="true">' +
            visual +
            '</span>'
        );
    }

    function rebuildTicker(el) {
        if (!el || !el.classList.contains('motion-ticker-mount')) return;
        if (!isPlainMoneyText(el)) {
            if (el.querySelector('.motion-ticker-visual')) return;
        }
        var raw = (el.textContent || '').trim();
        if (!/^\$[\d,.]+$/.test(raw)) return;

        var mo = el.__motionTickerMO;
        if (mo) mo.disconnect();
        el.innerHTML = buildTickerInnerHTML(raw);
        if (mo) mo.observe(el, { childList: true, characterData: true, subtree: true });
    }

    function initTickers() {
        if (prefersReducedMotion()) return;

        document.querySelectorAll('.motion-ticker-mount').forEach(function (el) {
            if (!el.id) return;
            var mo = new MutationObserver(function () {
                rebuildTicker(el);
            });
            el.__motionTickerMO = mo;
            mo.observe(el, { childList: true, characterData: true, subtree: true });
            rebuildTicker(el);
        });
    }

    function initMagnetic() {
        if (prefersReducedMotion()) return;

        document.querySelectorAll('[data-magnetic]').forEach(function (el) {
            var raw = el.getAttribute('data-magnetic');
            var strength = raw === '' || raw == null ? 0.32 : parseFloat(raw);
            if (isNaN(strength)) strength = 0.32;

            el.addEventListener(
                'mousemove',
                function (e) {
                    var r = el.getBoundingClientRect();
                    var x = (e.clientX - r.left) / r.width - 0.5;
                    var y = (e.clientY - r.top) / r.height - 0.5;
                    el.style.transform =
                        'translate(' + x * 18 * strength + 'px,' + y * 12 * strength + 'px)';
                },
                { passive: true }
            );

            el.addEventListener('mouseleave', function () {
                el.style.transform = '';
            });
        });
    }

    function boot() {
        initTickers();
        initMagnetic();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
