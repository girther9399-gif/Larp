(function () {
    'use strict';

    function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function initStagger() {
        if (prefersReducedMotion()) {
            document.querySelectorAll('.motion-stagger-onload').forEach(function (el) {
                el.classList.add('motion-stagger-active');
            });
            return;
        }

        var nodes = document.querySelectorAll('.motion-stagger-onload');
        if (!nodes.length || !('IntersectionObserver' in window)) {
            nodes.forEach(function (el) {
                el.classList.add('motion-stagger-active');
            });
            return;
        }

        var io = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('motion-stagger-active');
                        io.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.08, rootMargin: '0px 0px -6% 0px' }
        );

        nodes.forEach(function (el) {
            io.observe(el);
        });
    }

    function initSpotlights() {
        if (prefersReducedMotion()) return;

        document.querySelectorAll('.motion-spotlight').forEach(function (card) {
            if (card.querySelector('.motion-spotlight-glow')) return;

            var style = window.getComputedStyle(card);
            if (style.position === 'static') {
                card.style.position = 'relative';
            }

            var glow = document.createElement('span');
            glow.className = 'motion-spotlight-glow';
            glow.setAttribute('aria-hidden', 'true');
            card.insertBefore(glow, card.firstChild);

            card.addEventListener('mousemove', function (e) {
                var r = card.getBoundingClientRect();
                glow.style.left = e.clientX - r.left + 'px';
                glow.style.top = e.clientY - r.top + 'px';
            });

            card.addEventListener('mouseleave', function () {
                glow.style.left = '50%';
                glow.style.top = '50%';
            });
        });
    }

    function boot() {
        initStagger();
        initSpotlights();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
