'use strict';
chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.target !== 'offscreen') return;
    if (msg.type === 'CLIP_WRITE') {
        const text = msg.text || '';
        // Bevorzugt die Clipboard-API; Fallback über execCommand.
        Promise.resolve()
            .then(() => navigator.clipboard.writeText(text))
            .catch(() => {
                const ta = document.getElementById('t');
                ta.value = text || ' ';
                ta.select();
                try { document.execCommand('copy'); } catch (e) { /* ignore */ }
                ta.value = '';
            });
    }
});